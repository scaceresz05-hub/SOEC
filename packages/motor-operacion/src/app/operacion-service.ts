/**
 * @soec/motor-operacion · aplicación · SERVICIO de operación gobernada (M7).
 *
 * Conecta la cadena: LecturaCreativa(M6) → Orden → Scheduler → Cola(lease) → Ejecutor simulado (gobernado
 * por presupuesto M4-D) → Evidencia → reconciliación. Reglas duras:
 *  - Ninguna ejecución ocurre sin RE-VALIDAR contra M6 (aprobación+vigencia) justo antes del efecto: no se
 *    confía en objetos del llamador ni en copias antiguas.
 *  - Efectos EXACTAMENTE UNA VEZ por `claveEfecto` (idempotencia); entrega AL MENOS UNA VEZ por lease.
 *  - Presupuesto ANTES del efecto (unidades lógicas, SIMULADO/ESTIMADO, nunca REAL).
 *  - Transiciones sólo por la máquina de estados; nada de atajos. Historia inmutable (append-only).
 * Todo SIMULADO; `AUTONOMOUS_REAL` bloqueado.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { ConcurrencyError } from '@soec/contracts';
import type { LecturaCreativa } from '@soec/motor-creativo';
import { type PoliticaPresupuesto, type PoliticaRetry, type ClaseErrorAdaptador, estimarConservador, evaluarPresupuesto, decidirRetry, RETRY_DESHABILITADO } from '@soec/adaptadores';
import { PausaService, type Alcance } from '@soec/control';
import {
  EVENTOS_ORDEN,
  type DatosOrden,
  type EstadoOrden,
  type OrdenState,
  type RefVersionada,
  esTerminal,
  ordenStreamId,
  reconstruirOrden,
  transicionValida,
} from '../dominio/orden';
import { EVENTOS_TRABAJO, type TrabajoState, reclamable, trabajoStreamId, reconstruirTrabajo } from '../dominio/cola';
import { claveEfecto, huellaEfecto, trabajoId as trabajoIdDe } from '../dominio/idempotencia';
import { EVENTOS_RESERVA, type ReservaState, comprometeReserva, reservaId as reservaIdDe, reservaStreamId, reconstruirReserva } from '../dominio/reserva';
import { EVENTOS_COMPENSACION, compensacionId as compensacionIdDe, compensacionStreamId, reconstruirCompensacion } from '../dominio/compensacion';
import { EVIDENCIA_OPERACIONAL_VERSION, type EvidenciaOperacional, blindarEvidencia } from '../dominio/evidencia';
import { ComandoOperacionInvalidoError, OperacionPausadaError, OrdenNoEncontradaError, TransicionInvalidaError, TrabajoNoReclamableError } from '../dominio/errors';
import type { PuertoEjecucionSimulada } from '../contratos';

const EVENTOS_INDICE = { registrada: 'orden-indice.registrada' } as const;
const EVENTOS_EFECTO = { aplicado: 'efecto.aplicado' } as const;
const EVENTOS_CONSUMO = { registrado: 'consumo.registrado' } as const;

const EVENTOS_RES_INDICE = { registrada: 'reserva-indice.registrada' } as const;
function indiceStreamId(org: string): string { return `orden-indice:${org}`; }
function efectoStreamId(org: string, clave: string): string { return `efecto:${org}:${clave}`; }
function consumoStreamId(org: string): string { return `consumo-op:${org}`; }
function reservaIndiceStreamId(org: string): string { return `reserva-indice:${org}`; }

/** Entrada para crear una orden desde un artefacto aprobado de M6. */
export interface EntradaOrden {
  readonly capacidad: string;
  readonly pieza: RefVersionada;
  readonly variante: RefVersionada | null;
  readonly programaId: string;
  readonly entradaCalendarioId: string;
  readonly contextoId: string;
  readonly segmento: string;
  readonly canalLogico: string;
  readonly instantePlanificado: string;
  readonly zonaHoraria: string;
  readonly politicaVersion: string;
  readonly aprobacionRef: string;
}

export interface OpcionesOperacion {
  readonly presupuesto?: PoliticaPresupuesto;
  readonly unidadesPorEjecucion?: number;
  readonly maxIntentos?: number;
  readonly leaseTtlMs?: number;
  /** Ventana de expiración: si el instante planificado quedó más atrás que esto respecto de `ahora`. */
  readonly ventanaExpiracionMs?: number;
  /**
   * Política de reintento CANÓNICA (`@soec/adaptadores`). Si se omite, se deriva de `maxIntentos` (backoff
   * fijo, base 0). Reutiliza `decidirRetry`; NUNCA una política paralela.
   */
  readonly politicaRetry?: PoliticaRetry;
}

/** Clases de error de adaptador reintentables cuando la política se deriva de `maxIntentos`. */
const REINTENTABLES_POR_DEFECTO: readonly ClaseErrorAdaptador[] = ['TIMEOUT', 'NO_DISPONIBLE', 'LIMITE'];

export class OperacionService {
  private readonly pausa: PausaService;
  constructor(
    private readonly store: EventStore,
    private readonly creativa: LecturaCreativa,
    private readonly ejecutor: PuertoEjecucionSimulada,
    private readonly opciones: OpcionesOperacion = {},
  ) {
    this.pausa = new PausaService(store);
  }

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }

  /**
   * Política de reintento efectiva: la explícita (`politicaRetry`) o una DERIVADA de `maxIntentos`
   * (backoff fijo, base 0) para compatibilidad. Reutiliza el contrato canónico de @soec/adaptadores; no
   * define una política paralela.
   */
  private politicaRetryEfectiva(): PoliticaRetry {
    if (this.opciones.politicaRetry) return this.opciones.politicaRetry;
    const maxIntentos = this.opciones.maxIntentos ?? 1;
    if (maxIntentos <= 1) return RETRY_DESHABILITADO;
    return { habilitado: true, maxIntentos, erroresReintentables: REINTENTABLES_POR_DEFECTO, backoff: 'FIJO', baseMs: 0, jitter: false, version: 'derivada-maxIntentos' };
  }

  /** Alcances de PAUSA relevantes para una orden: organización, programa y capacidad. */
  private alcancesDe(org: string, d: DatosOrden): readonly Alcance[] {
    return [
      { tipo: 'organizacion', valor: org },
      { tipo: 'programa', valor: d.calendario.programaId },
      { tipo: 'capacidad', valor: d.capacidad },
    ];
  }

  /** Gate de PAUSA: impide programar/encolar/reclamar/ejecutar/reconciliar-hacia-ejecución si hay pausa. */
  private async exigirNoPausado(ctx: RequestContext, d: DatosOrden): Promise<void> {
    if (await this.pausa.estaPausado(ctx, this.alcancesDe(this.org(ctx), d))) {
      throw new OperacionPausadaError('operación pausada por el gobierno de PAUSA (@soec/control)');
    }
  }

  async cargarOrden(ctx: RequestContext, ordenId: string): Promise<OrdenState> {
    const org = this.org(ctx);
    return reconstruirOrden(org, ordenId, await this.store.readStream(ctx, ordenStreamId(org, ordenId)));
  }

  private appendOrden(ctx: RequestContext, ordenId: string, version: number, type: string, payload: unknown, a: Attribution, o: string) {
    const input: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, ordenStreamId(this.org(ctx), ordenId), version, [input]);
  }

  /** Transiciona recargando SIEMPRE el estado fresco (evita conflictos de versión entre appends). */
  private async transicionar(ctx: RequestContext, ordenId: string, hacia: EstadoOrden, motivo: string, a: Attribution, o: string): Promise<void> {
    const st = await this.cargarOrden(ctx, ordenId);
    if (!transicionValida(st.estado, hacia)) throw new TransicionInvalidaError(`transición inválida ${st.estado}→${hacia}`);
    await this.appendOrden(ctx, ordenId, st.version, EVENTOS_ORDEN.transicionada, { estado: hacia, motivo }, a, o);
  }

  /** Append de un evento no-transición a la orden, recargando la versión fresca. */
  private async appendOrdenFresco(ctx: RequestContext, ordenId: string, type: string, payload: unknown, a: Attribution, o: string): Promise<void> {
    const st = await this.cargarOrden(ctx, ordenId);
    await this.appendOrden(ctx, ordenId, st.version, type, payload, a, o);
  }

  // ── Validación AUTORITATIVA contra M6 (se re-consulta; nunca se confía en el llamador) ──────────────
  private async pruebaVigencia(ctx: RequestContext, d: { pieza: RefVersionada; variante: RefVersionada | null; programaId: string; entradaCalendarioId: string; contextoId: string }): Promise<{ ok: boolean; motivo: string }> {
    if ((await this.creativa.vigenciaContexto(ctx, d.contextoId)) !== 'VIGENTE') return { ok: false, motivo: 'contexto creativo obsoleto' };
    const aprobadas = await this.creativa.listarPiezasAprobadas(ctx);
    const pa = aprobadas.find((p) => p.paqueteId === d.pieza.id);
    if (!pa) return { ok: false, motivo: 'la pieza no está aprobada+vigente (o su variante no lo está)' };
    if (pa.version !== d.pieza.version) return { ok: false, motivo: 'la versión aprobada de la pieza cambió' };
    const cal = await this.creativa.cargarCalendario(ctx, d.programaId);
    const ent = cal.entradas.find((e) => e.entradaId === d.entradaCalendarioId);
    if (!ent) return { ok: false, motivo: 'la entrada de calendario no existe' };
    if (ent.estado === 'CANCELADA') return { ok: false, motivo: 'la entrada de calendario fue cancelada' };
    if (ent.piezaId !== d.pieza.id) return { ok: false, motivo: 'la entrada de calendario no referencia esta pieza' };
    const varEsperada = d.variante ? d.variante.id : null;
    if ((ent.varianteId ?? null) !== varEsperada) return { ok: false, motivo: 'la variante de la entrada no coincide (combinación cruzada)' };
    return { ok: true, motivo: '' };
  }

  async crearOrden(ctx: RequestContext, ordenId: string, e: EntradaOrden, a: Attribution, o: string): Promise<OrdenState> {
    if (!ordenId?.trim()) throw new ComandoOperacionInvalidoError('ordenId es obligatorio');
    const st = await this.cargarOrden(ctx, ordenId);
    if (st.existe) return st; // idempotente por ordenId
    const prueba = await this.pruebaVigencia(ctx, { pieza: e.pieza, variante: e.variante, programaId: e.programaId, entradaCalendarioId: e.entradaCalendarioId, contextoId: e.contextoId });
    if (!prueba.ok) throw new ComandoOperacionInvalidoError(`no se puede crear la orden: ${prueba.motivo}`);
    const datos: DatosOrden = {
      capacidad: e.capacidad, pieza: e.pieza, variante: e.variante,
      calendario: { programaId: e.programaId, entradaId: e.entradaCalendarioId }, contextoId: e.contextoId, segmento: e.segmento, canalLogico: e.canalLogico,
      instantePlanificado: e.instantePlanificado, zonaHoraria: e.zonaHoraria, politicaVersion: e.politicaVersion,
      idempotencyKey: claveEfecto(this.org(ctx), ordenId, e.pieza, e.variante, e.capacidad),
    };
    await this.appendOrden(ctx, ordenId, st.version, EVENTOS_ORDEN.creada, datos, a, o);
    await this.asegurarEnIndice(ctx, ordenId, a, o);
    return this.cargarOrden(ctx, ordenId);
  }

  private async exigir(ctx: RequestContext, ordenId: string): Promise<OrdenState> {
    const st = await this.cargarOrden(ctx, ordenId);
    if (!st.existe) throw new OrdenNoEncontradaError(`orden ${ordenId} no encontrada`);
    return st;
  }

  /** Valida la orden re-consultando M6; VALIDADA si vigente, OBSOLETA si no. */
  async validar(ctx: RequestContext, ordenId: string, a: Attribution, o: string): Promise<OrdenState> {
    const st = await this.exigir(ctx, ordenId);
    if (st.estado !== 'BORRADOR') return st;
    const d = st.datos!;
    const prueba = await this.pruebaVigencia(ctx, { pieza: d.pieza, variante: d.variante, programaId: d.calendario.programaId, entradaCalendarioId: d.calendario.entradaId, contextoId: d.contextoId });
    await this.transicionar(ctx, st.ordenId, prueba.ok ? 'VALIDADA' : 'OBSOLETA', prueba.motivo || 'vigente', a, o);
    return this.cargarOrden(ctx, ordenId);
  }

  /** Scheduler: programa si el instante no está en el pasado ni expirado; EXPIRADA si venció la ventana. */
  async programar(ctx: RequestContext, ordenId: string, ahora: string, a: Attribution, o: string): Promise<OrdenState> {
    const st = await this.exigir(ctx, ordenId);
    if (st.estado !== 'VALIDADA') return st;
    await this.exigirNoPausado(ctx, st.datos!);
    const inst = Date.parse(st.datos!.instantePlanificado);
    const ventana = this.opciones.ventanaExpiracionMs ?? Infinity;
    if (Number.isFinite(inst) && Date.parse(ahora) - inst > ventana) {
      await this.transicionar(ctx, st.ordenId, 'EXPIRADA', 'instante planificado expirado', a, o);
      return this.cargarOrden(ctx, ordenId);
    }
    await this.transicionar(ctx, st.ordenId, 'PROGRAMADA', 'programada', a, o);
    return this.cargarOrden(ctx, ordenId);
  }

  /** Encola: crea el trabajo (id determinista por orden+intento) DISPONIBLE y pasa la orden a EN_COLA. */
  async encolar(ctx: RequestContext, ordenId: string, a: Attribution, o: string, disponibleDesde?: string): Promise<TrabajoState> {
    const st = await this.exigir(ctx, ordenId);
    if (st.estado !== 'PROGRAMADA' && st.estado !== 'FALLIDA') throw new TransicionInvalidaError(`no se puede encolar desde ${st.estado}`);
    await this.exigirNoPausado(ctx, st.datos!);
    const intento = st.intentos + 1;
    const tid = trabajoIdDe(this.org(ctx), ordenId, intento);
    // Backoff: si se indica `disponibleDesde` (reintento), el trabajo no es reclamable hasta ese instante.
    await this.encolarTrabajo(ctx, tid, ordenId, intento, disponibleDesde ?? st.datos!.instantePlanificado, a, o);
    await this.transicionar(ctx, st.ordenId, 'EN_COLA', 'encolada', a, o); // PROGRAMADA→EN_COLA o FALLIDA→EN_COLA (reintento)
    return reconstruirTrabajo(this.org(ctx), tid, await this.store.readStream(ctx, trabajoStreamId(this.org(ctx), tid)));
  }

  private async encolarTrabajo(ctx: RequestContext, tid: string, ordenId: string, intento: number, disponibleDesde: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const st = reconstruirTrabajo(org, tid, await this.store.readStream(ctx, trabajoStreamId(org, tid)));
    if (st.existe) return; // idempotente por id determinista
    const input: EventInput = { type: EVENTOS_TRABAJO.encolado, payload: { ordenId, intentoLogico: intento, prioridad: 0, disponibleDesde }, attribution: a, occurredAt: o };
    await this.store.append(ctx, trabajoStreamId(org, tid), st.version, [input]);
  }

  /**
   * Reclama el trabajo (lease) y EJECUTA de forma gobernada. Re-valida M6 antes del efecto; verifica
   * presupuesto; aplica el efecto EXACTAMENTE UNA VEZ por `claveEfecto`; deja evidencia; transiciona la
   * orden y completa/reintenta según el resultado.
   */
  async reclamarYEjecutar(ctx: RequestContext, trabajoIdArg: string, worker: string, ahora: string, a: Attribution, o: string): Promise<OrdenState> {
    const org = this.org(ctx);
    const tw = reconstruirTrabajo(org, trabajoIdArg, await this.store.readStream(ctx, trabajoStreamId(org, trabajoIdArg)));
    if (!reclamable(tw, ahora)) throw new TrabajoNoReclamableError(`trabajo ${trabajoIdArg} no reclamable (estado ${tw.estado})`);
    const ordenPrev = await this.exigir(ctx, tw.ordenId);
    await this.exigirNoPausado(ctx, ordenPrev.datos!); // PAUSA impide reclamar/ejecutar
    const ttl = this.opciones.leaseTtlMs ?? 30000;
    const venceEn = new Date(Date.parse(ahora) + ttl).toISOString();
    // Reclamo: concurrencia optimista ⇒ dos workers, uno gana el lease, el otro ConcurrencyError.
    await this.store.append(ctx, trabajoStreamId(org, trabajoIdArg), tw.version, [{ type: EVENTOS_TRABAJO.reclamado, payload: { titular: worker, venceEn }, attribution: a, occurredAt: o }]);

    const orden = await this.exigir(ctx, tw.ordenId);
    if (orden.estado !== 'EN_COLA') { await this.fallarTrabajo(ctx, trabajoIdArg, 'orden no está EN_COLA', a, o); return orden; }
    await this.transicionar(ctx, orden.ordenId, 'EN_EJECUCION', 'en ejecución', a, o);
    let cur = await this.cargarOrden(ctx, tw.ordenId);
    await this.appendOrdenFresco(ctx, cur.ordenId, EVENTOS_ORDEN.intento, {}, a, o);
    cur = await this.cargarOrden(ctx, tw.ordenId);
    const d = cur.datos!;

    // GATE M6 antes del efecto: re-validar aprobación+vigencia.
    const prueba = await this.pruebaVigencia(ctx, { pieza: d.pieza, variante: d.variante, programaId: d.calendario.programaId, entradaCalendarioId: d.calendario.entradaId, contextoId: d.contextoId });
    if (!prueba.ok) {
      await this.emitirEvidencia(ctx, cur, tw.intentoLogico, 'RECHAZADA', 'VIGENCIA_PERDIDA', prueba.motivo, a, o);
      await this.transicionar(ctx, cur.ordenId, 'FALLIDA', prueba.motivo, a, o);
      await this.marcarObsoletaSiCorresponde(ctx, tw.ordenId, prueba.motivo, a, o);
      await this.fallarTrabajo(ctx, trabajoIdArg, prueba.motivo, a, o);
      return this.cargarOrden(ctx, tw.ordenId);
    }

    // GATE de EXPIRACIÓN por intento: si venció la ventana antes de este intento, no se ejecuta.
    const ventanaExp = this.opciones.ventanaExpiracionMs ?? Infinity;
    const inst = Date.parse(d.instantePlanificado);
    if (Number.isFinite(inst) && Date.parse(ahora) - inst > ventanaExp) {
      await this.emitirEvidencia(ctx, cur, tw.intentoLogico, 'RECHAZADA', 'EXPIRADA', 'ventana vencida antes del intento', a, o);
      await this.transicionar(ctx, cur.ordenId, 'EXPIRADA', 'expirada antes del intento', a, o);
      await this.fallarTrabajo(ctx, trabajoIdArg, 'EXPIRADA', a, o);
      return this.cargarOrden(ctx, tw.ordenId);
    }

    // Clave LÓGICA + reserva presupuestaria (RESERVA antes del efecto; unidades lógicas, nunca REAL).
    const unidades = this.opciones.unidadesPorEjecucion ?? 1;
    const clave = claveEfecto(org, tw.ordenId, d.pieza, d.variante, d.capacidad);
    const rid = reservaIdDe(org, tw.ordenId, clave);
    const huella = huellaEfecto(d.pieza, d.variante, d.capacidad);
    const huellaPrevia = await this.efectoHuella(ctx, clave);

    // Efecto EXACTAMENTE UNA VEZ por la clave LÓGICA. Conflicto de contenido ⇒ CONFLICTO_IDEMPOTENCIA.
    if (huellaPrevia !== null) {
      if (huellaPrevia !== huella) {
        await this.emitirEvidencia(ctx, cur, tw.intentoLogico, 'RECHAZADA', 'CONFLICTO_IDEMPOTENCIA', 'misma clave, contenido distinto', a, o);
        await this.transicionar(ctx, cur.ordenId, 'FALLIDA', 'conflicto de idempotencia', a, o);
        await this.fallarTrabajo(ctx, trabajoIdArg, 'CONFLICTO_IDEMPOTENCIA', a, o);
        return this.cargarOrden(ctx, tw.ordenId);
      }
      await this.emitirEvidencia(ctx, cur, tw.intentoLogico, 'DUPLICADA', null, 'efecto lógico ya aplicado', a, o);
      await this.transicionar(ctx, cur.ordenId, 'EJECUTADA_SIMULADA', 'efecto ya aplicado (idempotente)', a, o);
      await this.completarTrabajo(ctx, trabajoIdArg, 'DUPLICADA', a, o);
      return this.cargarOrden(ctx, tw.ordenId);
    }

    // Presupuesto: estimación conservadora → validación del límite → RESERVA.
    if (this.opciones.presupuesto) {
      const veredicto = evaluarPresupuesto(this.opciones.presupuesto, await this.comprometido(ctx), estimarConservador(null, unidades));
      if (!veredicto.permitido) {
        await this.emitirEvidencia(ctx, cur, tw.intentoLogico, 'RECHAZADA', 'PRESUPUESTO_EXCEDIDO', 'sin presupuesto', a, o);
        await this.transicionar(ctx, cur.ordenId, 'FALLIDA', 'presupuesto excedido', a, o);
        await this.fallarTrabajo(ctx, trabajoIdArg, 'presupuesto', a, o);
        return this.cargarOrden(ctx, tw.ordenId);
      }
    }
    await this.reservar(ctx, rid, tw.ordenId, clave, unidades, d.politicaVersion, this.opciones.presupuesto?.ventanaMs ?? 0, a, o);
    await this.appendOrdenFresco(ctx, cur.ordenId, EVENTOS_ORDEN.presupuesto, { unidades }, a, o);

    const r = await this.ejecutor.ejecutar({ organizacionId: org, ordenId: tw.ordenId, capacidad: d.capacidad, canalLogico: d.canalLogico, claveEfecto: clave, intento: tw.intentoLogico, observadoEn: o });
    if (r.resultado === 'EJECUTADA_SIMULADA') {
      // Efecto aplicado (concurrencia optimista: si otro worker lo aplicó, este append falla ⇒ un solo efecto).
      await this.store.append(ctx, efectoStreamId(org, clave), 0, [{ type: EVENTOS_EFECTO.aplicado, payload: { clave, huella }, attribution: a, occurredAt: o }]);
      await this.confirmarReserva(ctx, rid, unidades, a, o); // CONFIRMA el consumo UNA sola vez
    }
    await this.emitirEvidencia(ctx, cur, tw.intentoLogico, r.resultado, r.codigoError, 'ejecución simulada', a, o);
    cur = await this.cargarOrden(ctx, tw.ordenId);

    if (r.resultado === 'EJECUTADA_SIMULADA') {
      await this.transicionar(ctx, cur.ordenId, 'EJECUTADA_SIMULADA', 'ejecutada (simulada)', a, o);
      await this.completarTrabajo(ctx, trabajoIdArg, 'EJECUTADA_SIMULADA', a, o);
      return this.cargarOrden(ctx, tw.ordenId);
    }
    // Reintento CANÓNICO: `decidirRetry` (@soec/adaptadores) decide si reintentar y cuánto esperar (backoff).
    // NUNCA reintenta INVALIDO/NO_AUTORIZADO/CANCELADO. La clase de error se normaliza; si el adaptador no la
    // aporta, se deriva de `reintentable`. El próximo intento re-encola con backoff y re-ejecuta TODOS los gates.
    const clase = (r.claseError as ClaseErrorAdaptador | undefined) ?? (r.reintentable ? 'TIMEOUT' : 'INVALIDO');
    const decision = decidirRetry(this.politicaRetryEfectiva(), cur.intentos, clase);
    if (decision.reintentar) {
      // Fallo temporal reintentable: se CONSERVA la reserva (mismo efecto lógico) y se re-encola con backoff.
      await this.transicionar(ctx, cur.ordenId, 'FALLIDA', r.codigoError ?? 'fallo temporal', a, o);
      await this.fallarTrabajo(ctx, trabajoIdArg, r.codigoError ?? 'temporal', a, o);
      const disponibleDesde = new Date(Date.parse(ahora) + decision.esperaMs).toISOString();
      await this.encolar(ctx, tw.ordenId, a, o, disponibleDesde);
    } else {
      // Terminal (no reintentable, o política agotada): se LIBERA la reserva (no se consumirá).
      await this.liberarReserva(ctx, rid, `terminal: ${r.resultado} (${decision.motivo})`, a, o);
      await this.transicionar(ctx, cur.ordenId, 'FALLIDA', r.codigoError ?? 'fallo', a, o);
      await this.fallarTrabajo(ctx, trabajoIdArg, r.codigoError ?? 'fallo', a, o);
    }
    return this.cargarOrden(ctx, tw.ordenId);
  }

  async cancelar(ctx: RequestContext, ordenId: string, motivo: string, a: Attribution, o: string): Promise<OrdenState> {
    const st = await this.exigir(ctx, ordenId);
    if (esTerminal(st.estado)) return st;
    if (!transicionValida(st.estado, 'CANCELADA')) throw new TransicionInvalidaError(`no se puede cancelar desde ${st.estado}`);
    await this.transicionar(ctx, st.ordenId, 'CANCELADA', motivo, a, o);
    return this.cargarOrden(ctx, ordenId);
  }

  async cargarCompensacion(ctx: RequestContext, cid: string) {
    const org = this.org(ctx);
    return reconstruirCompensacion(org, cid, await this.store.readStream(ctx, compensacionStreamId(org, cid)));
  }

  private async appendCompensacion(ctx: RequestContext, cid: string, type: string, payload: unknown, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const st = await this.cargarCompensacion(ctx, cid);
    await this.store.append(ctx, compensacionStreamId(org, cid), st.version, [{ type, payload, attribution: a, occurredAt: o }]);
  }

  /**
   * Compensación de PRIMERA CLASE (agregado propio): reverso LÓGICO simulado del efecto. No borra ni altera
   * el efecto original. Sólo aplica si el efecto se aplicó y la orden está EJECUTADA_SIMULADA; en otro caso
   * clasifica NO_APLICABLE. Idempotente: doble compensación converge. Devuelve el estado de la compensación.
   */
  async compensar(ctx: RequestContext, ordenId: string, motivo: string, a: Attribution, o: string) {
    const org = this.org(ctx);
    const st = await this.exigir(ctx, ordenId);
    const d = st.datos!;
    const clave = claveEfecto(org, ordenId, d.pieza, d.variante, d.capacidad);
    const cid = compensacionIdDe(org, ordenId, clave);
    const comp0 = await this.cargarCompensacion(ctx, cid);
    if (comp0.existe && (comp0.estado === 'COMPENSADA' || comp0.estado === 'NO_APLICABLE')) return comp0; // idempotente
    if (!comp0.existe) await this.appendCompensacion(ctx, cid, EVENTOS_COMPENSACION.iniciada, { ordenId, claveLogica: clave, motivo }, a, o);
    const efectoAplicado = (await this.efectoHuella(ctx, clave)) !== null;
    if (st.estado !== 'EJECUTADA_SIMULADA' || !efectoAplicado) {
      await this.appendCompensacion(ctx, cid, EVENTOS_COMPENSACION.noAplicable, { resultado: 'nada que compensar (efecto no aplicado o estado no ejecutado)' }, a, o);
      return this.cargarCompensacion(ctx, cid);
    }
    await this.appendCompensacion(ctx, cid, EVENTOS_COMPENSACION.ejecutando, {}, a, o);
    await this.emitirEvidencia(ctx, st, st.intentos, 'COMPENSADA', null, motivo, a, o);
    const fresca = await this.cargarOrden(ctx, ordenId);
    const evidenciaRef = fresca.evidenciaRefs[fresca.evidenciaRefs.length - 1] ?? null;
    await this.appendCompensacion(ctx, cid, EVENTOS_COMPENSACION.compensada, { evidenciaRef }, a, o);
    if (transicionValida(st.estado, 'COMPENSADA')) await this.transicionar(ctx, ordenId, 'COMPENSADA', motivo, a, o);
    return this.cargarCompensacion(ctx, cid);
  }

  private async marcarObsoletaSiCorresponde(_ctx: RequestContext, _ordenId: string, _motivo: string, _a: Attribution, _o: string): Promise<void> {
    // La orden ya pasó a FALLIDA por vigencia perdida; se conserva la historia. (Hook para futura OBSOLETA explícita.)
  }

  // ── Idempotencia de efectos / consumo simulado ──────────────────────────────────────────────────────
  /** Huella del efecto lógico ya aplicado bajo esa clave, o null si no se aplicó. */
  private async efectoHuella(ctx: RequestContext, clave: string): Promise<string | null> {
    const evs = await this.store.readStream(ctx, efectoStreamId(this.org(ctx), clave));
    const e = evs.find((x) => x.type === EVENTOS_EFECTO.aplicado);
    return e ? (e.payload as { huella: string }).huella : null;
  }

  private async registrarConsumo(ctx: RequestContext, unidades: number, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, consumoStreamId(org));
    await this.store.append(ctx, consumoStreamId(org), events.length, [{ type: EVENTOS_CONSUMO.registrado, payload: { unidades }, attribution: a, occurredAt: o }]);
  }

  private async consumido(ctx: RequestContext): Promise<number> {
    const events = await this.store.readStream(ctx, consumoStreamId(this.org(ctx)));
    return events.filter((e) => e.type === EVENTOS_CONSUMO.registrado).reduce((s, e) => s + ((e.payload as { unidades: number }).unidades ?? 0), 0);
  }

  // ── Ciclo de reserva presupuestaria (RESERVA→CONFIRMA/LIBERA), idempotente y versionado ──────────────
  async cargarReserva(ctx: RequestContext, rid: string): Promise<ReservaState> {
    const org = this.org(ctx);
    return reconstruirReserva(org, rid, await this.store.readStream(ctx, reservaStreamId(org, rid)));
  }

  /** Compromiso presupuestario vigente = suma de reservas RESERVADA/CONFIRMADA (idempotente, event-sourced). */
  private async comprometido(ctx: RequestContext): Promise<number> {
    const org = this.org(ctx);
    const idx = await this.store.readStream(ctx, reservaIndiceStreamId(org));
    const rids = idx.filter((e) => e.type === EVENTOS_RES_INDICE.registrada).map((e) => (e.payload as { rid: string }).rid);
    let total = 0;
    for (const rid of rids) {
      const r = await this.cargarReserva(ctx, rid);
      if (r.existe && comprometeReserva(r.estado)) total += r.unidades;
    }
    return total;
  }

  private async reservar(ctx: RequestContext, rid: string, ordenId: string, claveLogica: string, unidades: number, politicaVersion: string, ventanaMs: number, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const r = await this.cargarReserva(ctx, rid);
    if (r.existe) return; // idempotente por identidad determinista
    await this.store.append(ctx, reservaStreamId(org, rid), r.version, [{ type: EVENTOS_RESERVA.reservada, payload: { ordenId, claveLogica, unidades, ventanaMs, politicaVersion }, attribution: a, occurredAt: o }]);
    const idx = await this.store.readStream(ctx, reservaIndiceStreamId(org));
    if (!idx.some((e) => e.type === EVENTOS_RES_INDICE.registrada && (e.payload as { rid: string }).rid === rid)) {
      await this.store.append(ctx, reservaIndiceStreamId(org), idx.length, [{ type: EVENTOS_RES_INDICE.registrada, payload: { rid }, attribution: a, occurredAt: o }]);
    }
  }

  async confirmarReserva(ctx: RequestContext, rid: string, unidades: number, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const r = await this.cargarReserva(ctx, rid);
    if (!r.existe || r.estado !== 'RESERVADA') return; // idempotente: confirmar dos veces converge
    await this.store.append(ctx, reservaStreamId(org, rid), r.version, [{ type: EVENTOS_RESERVA.confirmada, payload: {}, attribution: a, occurredAt: o }]);
    await this.registrarConsumo(ctx, unidades, a, o); // consumo confirmado UNA sola vez (tras RESERVADA→CONFIRMADA)
  }

  async liberarReserva(ctx: RequestContext, rid: string, motivo: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const r = await this.cargarReserva(ctx, rid);
    if (!r.existe || r.estado !== 'RESERVADA') return; // idempotente
    await this.store.append(ctx, reservaStreamId(org, rid), r.version, [{ type: EVENTOS_RESERVA.liberada, payload: { motivo }, attribution: a, occurredAt: o }]);
  }

  async listarReservasIds(ctx: RequestContext): Promise<readonly string[]> {
    const idx = await this.store.readStream(ctx, reservaIndiceStreamId(this.org(ctx)));
    return idx.filter((e) => e.type === EVENTOS_RES_INDICE.registrada).map((e) => (e.payload as { rid: string }).rid);
  }

  private async emitirEvidencia(ctx: RequestContext, orden: OrdenState, intento: number, resultado: EvidenciaOperacional['resultado'], codigoError: string | null, _nota: string, a: Attribution, o: string): Promise<void> {
    const d = orden.datos!;
    const ev: EvidenciaOperacional = blindarEvidencia({
      version: EVIDENCIA_OPERACIONAL_VERSION, organizacionId: orden.organizacionId, ordenId: orden.ordenId, pieza: d.pieza, variante: d.variante,
      capacidad: d.capacidad, canalLogico: d.canalLogico, intento, politicaVersion: d.politicaVersion,
      presupuesto: { unidades: this.opciones.unidadesPorEjecucion ?? 1, naturaleza: 'ESTIMADO' }, resultado, codigoError, compensacion: resultado === 'COMPENSADA' ? 'reverso lógico' : null,
      aprobacionRef: `aprob:${d.pieza.id}@${d.pieza.version}`, vigencia: 'VIGENTE', naturaleza: 'SIMULADO', observadoEn: o,
    });
    const ref = `${orden.ordenId}:ev${orden.evidenciaRefs.length + 1}`;
    // La evidencia se guarda en su propio stream inmutable + se referencia desde la orden.
    await this.store.append(ctx, `evidencia:${orden.organizacionId}:${ref}`, 0, [{ type: 'evidencia.operacional', payload: ev, attribution: a, occurredAt: o }]);
    const fresca = await this.cargarOrden(ctx, orden.ordenId);
    await this.appendOrden(ctx, orden.ordenId, fresca.version, EVENTOS_ORDEN.evidencia, { evidenciaRef: ref }, a, o);
  }

  private async completarTrabajo(ctx: RequestContext, tid: string, resultado: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const st = reconstruirTrabajo(org, tid, await this.store.readStream(ctx, trabajoStreamId(org, tid)));
    if (st.estado === 'COMPLETADO' || st.estado === 'FALLIDO') return;
    await this.store.append(ctx, trabajoStreamId(org, tid), st.version, [{ type: EVENTOS_TRABAJO.completado, payload: { resultado }, attribution: a, occurredAt: o }]);
  }

  private async fallarTrabajo(ctx: RequestContext, tid: string, resultado: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const st = reconstruirTrabajo(org, tid, await this.store.readStream(ctx, trabajoStreamId(org, tid)));
    if (st.estado === 'COMPLETADO' || st.estado === 'FALLIDO') return;
    await this.store.append(ctx, trabajoStreamId(org, tid), st.version, [{ type: EVENTOS_TRABAJO.fallido, payload: { resultado }, attribution: a, occurredAt: o }]);
  }

  private async asegurarEnIndice(ctx: RequestContext, ordenId: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const events = await this.store.readStream(ctx, indiceStreamId(org));
    if (events.some((e) => e.type === EVENTOS_INDICE.registrada && (e.payload as { ordenId: string }).ordenId === ordenId)) return;
    await this.store.append(ctx, indiceStreamId(org), events.length, [{ type: EVENTOS_INDICE.registrada, payload: { ordenId }, attribution: a, occurredAt: o }]);
  }

  async listarOrdenesIds(ctx: RequestContext): Promise<readonly string[]> {
    const events = await this.store.readStream(ctx, indiceStreamId(this.org(ctx)));
    return events.filter((e) => e.type === EVENTOS_INDICE.registrada).map((e) => (e.payload as { ordenId: string }).ordenId);
  }
}

export { ConcurrencyError };
