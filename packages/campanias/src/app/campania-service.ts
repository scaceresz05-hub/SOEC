/**
 * Servicio de campañas gobernadas (Bloque C). Una campaña SOLO nace referenciando una decisión de
 * marketing de la MISMA organización. Aplica los invariantes de gobierno antes de emitir eventos:
 *
 *  1. No huérfana: la decisión referenciada debe existir.
 *  2. Separación multi-tenant: la decisión debe pertenecer a la organización del contexto.
 *  3. Ejecutabilidad: nada se vuelve ejecutable sin una decisión APROBADA. Una decisión
 *     NO_EVALUABLE nunca origina una campaña ejecutable.
 *  4. Presupuesto: si está definido, es positivo y cabe en `politica.presupuestoMaximo`.
 *  5. Experimentalidad: sin hipótesis solo se admite si la política lo permite explícitamente.
 *
 * DOS PUERTAS DE ENTRADA, con reglas distintas a propósito:
 *
 *  · `crearDesdeDecision` — la campaña nace LISTA para ejecutarse: decisión APROBADA y presupuesto > 0.
 *    Es la que usan programas y el piloto.
 *  · `crearBorrador` — la campaña nace como PLAN: puede tener presupuesto `null` y referenciar una
 *    decisión todavía no aprobada (incluso NO_EVALUABLE, que es lo honesto cuando falta el presupuesto).
 *    No aprueba nada ni fija KPIs: registra lo que se sabe y lo que falta.
 *
 * Sea cual sea la puerta, la ENTRADA a un estado ejecutable pasa por `transicionar`, que exige
 * presupuesto > 0 y decisión aprobada (`evaluarActivacion`). Ésa es la protección que importa, y vive
 * en dominio.
 *
 * Event-sourced (`campania:<org>:<id>`).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { DecisionMktService, esEjecutable } from '@soec/decisiones-mkt';
import {
  type Campania,
  type CambiosBorrador,
  type DestinoGrupo,
  type EstadoCampania,
  type PoliticaCampania,
  type Presupuesto,
  EVENTOS_CAMPANIA,
  POLITICA_CAMPANIA_CONSERVADORA,
  campaniaStreamId,
  esEstadoCampaniaEjecutable,
  evaluarActivacion,
  reconstruirCampania,
  transicionCampaniaValida,
} from '../domain/campania';
import { type AlcanceGeografico, validarAlcanceGeografico } from '../domain/alcance';
import { CampaniaInvalidaError, SeparacionCampaniaVioladaError, TransicionCampaniaInvalidaError } from '../domain/errors';

/** Datos con que se propone una campaña. `decisionId` es obligatorio: no hay campañas huérfanas. */
export interface EntradaCampania {
  readonly organizacionId: string;
  readonly decisionId: string;
  readonly nombre?: string;
  readonly objetivo: string;
  readonly publico: string;
  readonly propuesta: string;
  readonly mensaje: string;
  readonly canal: string;
  readonly contenidoRequerido?: readonly string[];
  readonly calendario: string;
  readonly presupuesto: Presupuesto;
  readonly hipotesis?: readonly string[];
  readonly metricas?: readonly string[];
  readonly criterioExito: string;
  readonly criterioPausa: string;
  readonly nivelAutonomia?: number;
  readonly riesgos?: readonly string[];
  readonly destino?: string | null;
  readonly destinosPorGrupo?: readonly DestinoGrupo[];
  readonly requisitosPrevios?: readonly string[];
  readonly alcanceGeografico?: AlcanceGeografico | null;
}

/** Datos de un BORRADOR: igual que una campaña, pero el presupuesto puede no estar decidido. */
export interface EntradaBorrador extends Omit<EntradaCampania, 'presupuesto'> {
  readonly presupuesto: Presupuesto | null;
}

/** Destino válido: URL absoluta https. Un borrador no inventa landings relativas ni esquemas raros. */
function validarDestino(url: string, etiqueta: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new CampaniaInvalidaError(`${etiqueta} no es una URL absoluta: ${url}`);
  }
  if (u.protocol !== 'https:') throw new CampaniaInvalidaError(`${etiqueta} debe usar https: ${url}`);
}

function validarDestinosPorGrupo(grupos: readonly DestinoGrupo[]): void {
  const vistos = new Set<string>();
  for (const g of grupos) {
    if (!g.grupo?.trim()) throw new CampaniaInvalidaError('un destino por grupo no tiene nombre de grupo');
    if (vistos.has(g.grupo)) throw new CampaniaInvalidaError(`grupo duplicado en destinos: ${g.grupo}`);
    vistos.add(g.grupo);
    validarDestino(g.destino, `destino del grupo ${g.grupo}`);
  }
}

/**
 * Presupuesto de un BORRADOR: `null` (todavía no decidido) o positivo dentro de la política. Un 0 no es
 * "sin presupuesto": es una cifra, y además una que no autoriza nada. Se rechaza para que la ausencia de
 * decisión no pueda disfrazarse de decisión.
 */
function validarPresupuestoDeBorrador(p: Presupuesto | null, politica: PoliticaCampania): void {
  if (p === null) return;
  if (typeof p.monto !== 'number' || !Number.isFinite(p.monto) || !(p.monto > 0)) {
    throw new CampaniaInvalidaError('el presupuesto, si se define, debe ser positivo; si aún no está decidido debe ser null');
  }
  if (!p.moneda?.trim()) throw new CampaniaInvalidaError('el presupuesto definido debe indicar moneda');
  if (p.monto > politica.presupuestoMaximo) {
    throw new CampaniaInvalidaError(`presupuesto ${p.monto} excede el máximo de política ${politica.presupuestoMaximo}`);
  }
}

function validarAlcance(a: AlcanceGeografico | null | undefined): void {
  if (a === null || a === undefined) return;
  const errores = validarAlcanceGeografico(a);
  if (errores.length > 0) throw new CampaniaInvalidaError(`alcance geográfico inválido: ${errores.join(', ')}`);
}

/**
 * Validación PURA del contenido de un borrador (todo salvo la decisión, que exige leer el store). Se
 * exporta para que un llamante que tenga que escribir algo ANTES —p. ej. la decisión que el borrador
 * referenciará— pueda comprobar primero que el borrador es válido y no deje escrituras huérfanas.
 */
export function validarContenidoDeBorrador(entrada: EntradaBorrador, politica: PoliticaCampania): void {
  if (!entrada.objetivo?.trim()) throw new CampaniaInvalidaError('el borrador necesita un objetivo');
  if (!entrada.canal?.trim()) throw new CampaniaInvalidaError('el borrador necesita un canal planificado');
  validarPresupuestoDeBorrador(entrada.presupuesto, politica);
  if (entrada.destino) validarDestino(entrada.destino, 'destino');
  validarDestinosPorGrupo(entrada.destinosPorGrupo ?? []);
  validarAlcance(entrada.alcanceGeografico);
}

export class CampaniaService {
  private readonly decisiones: DecisionMktService;
  constructor(private readonly store: EventStore) {
    this.decisiones = new DecisionMktService(store);
  }

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  cargar(ctx: RequestContext, campaniaId: string): Promise<Campania> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, campaniaStreamId(org, campaniaId)).then((e) => reconstruirCampania(org, campaniaId, e));
  }

  /** Estado de la decisión referenciada por una campaña (dentro de SU organización), o null si no existe. */
  async estadoDecision(ctx: RequestContext, c: Campania): Promise<string | null> {
    if (!c.decisionId) return null;
    const d = await this.decisiones.cargar(ctx, c.decisionId);
    return d.existe && d.organizacionId === this.org(ctx) ? d.estado : null;
  }

  /** Deriva una campaña gobernada lista para ejecutar desde una decisión APROBADA. */
  async crearDesdeDecision(
    ctx: RequestContext,
    campaniaId: string,
    entrada: EntradaCampania,
    politica: PoliticaCampania,
    a: Attribution,
    o: string,
  ): Promise<Campania> {
    const org = this.org(ctx);
    if (entrada.organizacionId !== org) {
      throw new SeparacionCampaniaVioladaError('organizacionId de la campaña no coincide con el contexto');
    }
    if (!entrada.decisionId) throw new CampaniaInvalidaError('la campaña debe referenciar una decisión (no puede ser huérfana)');

    // La decisión se carga SIEMPRE dentro de la organización del contexto: una decisión de otra
    // org simplemente no existe en este stream → se rechaza como inexistente/ajena.
    const decision = await this.decisiones.cargar(ctx, entrada.decisionId);
    if (!decision.existe) {
      throw new CampaniaInvalidaError(`la decisión ${entrada.decisionId} no existe en la organización ${org}`);
    }
    if (decision.organizacionId !== org) {
      throw new SeparacionCampaniaVioladaError('la decisión referenciada pertenece a otra organización');
    }

    // Evaluabilidad + aprobación: NO_EVALUABLE jamás deriva campaña; si la política exige
    // aprobación, la decisión debe ser ejecutable (APROBADA).
    if (decision.estado === 'NO_EVALUABLE') {
      throw new CampaniaInvalidaError('una decisión NO_EVALUABLE no puede derivar una campaña');
    }
    if (politica.requiereAprobacion && !esEjecutable(decision.estado)) {
      throw new CampaniaInvalidaError(`la política exige una decisión APROBADA; estado actual: ${decision.estado}`);
    }

    // Presupuesto compatible con la política.
    if (!(entrada.presupuesto.monto > 0)) throw new CampaniaInvalidaError('el presupuesto debe ser positivo');
    if (entrada.presupuesto.monto > politica.presupuestoMaximo) {
      throw new CampaniaInvalidaError(`presupuesto ${entrada.presupuesto.monto} excede el máximo de política ${politica.presupuestoMaximo}`);
    }

    // Experimentalidad: sin hipótesis solo si la política lo permite.
    const hipotesis = entrada.hipotesis ?? [];
    if (hipotesis.length === 0 && !politica.permiteNoExperimental) {
      throw new CampaniaInvalidaError('una campaña sin hipótesis requiere una política que permita campañas no experimentales');
    }

    if (entrada.destino) validarDestino(entrada.destino, 'destino');
    validarDestinosPorGrupo(entrada.destinosPorGrupo ?? []);
    validarAlcance(entrada.alcanceGeografico);

    const existente = await this.cargar(ctx, campaniaId);
    if (existente.existe) return existente;

    return this.emitirCreada(ctx, campaniaId, existente.version, { ...entrada, hipotesis }, a, o);
  }

  /**
   * Crea una campaña en BORRADOR. Puede no tener presupuesto y puede referenciar una decisión aún no
   * aprobada. No aprueba la decisión, no transiciona nada y no fija métricas por su cuenta: la campaña
   * queda exactamente como se describe, y `evaluarActivacion` dirá qué le falta para ejecutarse.
   */
  async crearBorrador(
    ctx: RequestContext,
    campaniaId: string,
    entrada: EntradaBorrador,
    politica: PoliticaCampania,
    a: Attribution,
    o: string,
  ): Promise<Campania> {
    const org = this.org(ctx);
    if (entrada.organizacionId !== org) {
      throw new SeparacionCampaniaVioladaError('organizacionId de la campaña no coincide con el contexto');
    }
    if (!campaniaId?.trim()) throw new CampaniaInvalidaError('la campaña necesita un identificador');
    if (!entrada.decisionId) throw new CampaniaInvalidaError('la campaña debe referenciar una decisión (no puede ser huérfana)');

    const decision = await this.decisiones.cargar(ctx, entrada.decisionId);
    if (!decision.existe) {
      throw new CampaniaInvalidaError(`la decisión ${entrada.decisionId} no existe en la organización ${org}`);
    }
    if (decision.organizacionId !== org) {
      throw new SeparacionCampaniaVioladaError('la decisión referenciada pertenece a otra organización');
    }
    // Una decisión RECHAZADA es terminal: planificar sobre ella sería planificar algo ya descartado.
    if (decision.estado === 'RECHAZADA') {
      throw new CampaniaInvalidaError('una decisión RECHAZADA no puede originar una campaña, ni siquiera en borrador');
    }

    validarContenidoDeBorrador(entrada, politica);

    const existente = await this.cargar(ctx, campaniaId);
    if (existente.existe) return existente;

    return this.emitirCreada(ctx, campaniaId, existente.version, entrada, a, o);
  }

  /** Edita un BORRADOR. Fuera de BORRADOR, la campaña ya no se reescribe: se transiciona. */
  async actualizarBorrador(
    ctx: RequestContext,
    campaniaId: string,
    cambios: CambiosBorrador,
    politica: PoliticaCampania,
    a: Attribution,
    o: string,
  ): Promise<Campania> {
    const c = await this.cargar(ctx, campaniaId);
    if (!c.existe) throw new CampaniaInvalidaError('la campaña no existe');
    if (c.estado !== 'BORRADOR') {
      throw new TransicionCampaniaInvalidaError(`sólo un BORRADOR se edita; estado actual: ${c.estado}`);
    }
    const claves = Object.keys(cambios) as (keyof CambiosBorrador)[];
    if (claves.length === 0) throw new CampaniaInvalidaError('no hay cambios que aplicar');

    if ('objetivo' in cambios && !cambios.objetivo?.trim()) throw new CampaniaInvalidaError('el objetivo no puede quedar vacío');
    if ('canal' in cambios && !cambios.canal?.trim()) throw new CampaniaInvalidaError('el canal planificado no puede quedar vacío');
    if ('presupuesto' in cambios) validarPresupuestoDeBorrador(cambios.presupuesto ?? null, politica);
    if ('destino' in cambios && cambios.destino) validarDestino(cambios.destino, 'destino');
    if ('destinosPorGrupo' in cambios) validarDestinosPorGrupo(cambios.destinosPorGrupo ?? []);
    if ('alcanceGeografico' in cambios) validarAlcance(cambios.alcanceGeografico);

    const input: EventInput = { type: EVENTOS_CAMPANIA.borradorActualizado, payload: cambios, attribution: a, occurredAt: o };
    await this.store.append(ctx, campaniaStreamId(this.org(ctx), campaniaId), c.version, [input]);
    return this.cargar(ctx, campaniaId);
  }

  /**
   * Transición gobernada por la máquina de estados de la campaña. Entrar en un estado EJECUTABLE exige,
   * además de la transición válida, presupuesto > 0 y decisión aprobada: la comprobación está aquí y no
   * en ninguna interfaz, así que ningún llamante puede saltársela.
   */
  async transicionar(ctx: RequestContext, campaniaId: string, hacia: EstadoCampania, a: Attribution, o: string): Promise<Campania> {
    const c = await this.cargar(ctx, campaniaId);
    if (!c.existe) throw new CampaniaInvalidaError('la campaña no existe');
    if (!transicionCampaniaValida(c.estado, hacia)) {
      throw new TransicionCampaniaInvalidaError(`transición no permitida: ${c.estado} → ${hacia}`);
    }
    if (esEstadoCampaniaEjecutable(hacia)) {
      const activacion = evaluarActivacion(c, await this.estadoDecision(ctx, c));
      if (!activacion.ok) {
        throw new CampaniaInvalidaError(`la campaña no puede pasar a ${hacia}: ${activacion.motivos.join('; ')}`);
      }
    }
    const input: EventInput = { type: EVENTOS_CAMPANIA.transicionada, payload: { estado: hacia }, attribution: a, occurredAt: o };
    await this.store.append(ctx, campaniaStreamId(this.org(ctx), campaniaId), c.version, [input]);
    return this.cargar(ctx, campaniaId);
  }

  private async emitirCreada(
    ctx: RequestContext,
    campaniaId: string,
    versionEsperada: number,
    entrada: EntradaBorrador,
    a: Attribution,
    o: string,
  ): Promise<Campania> {
    const org = this.org(ctx);
    const payload: Omit<Campania, 'autor' | 'en' | 'version' | 'existe'> = {
      campaniaId,
      organizacionId: org,
      decisionId: entrada.decisionId,
      nombre: entrada.nombre ?? '',
      objetivo: entrada.objetivo,
      publico: entrada.publico,
      propuesta: entrada.propuesta,
      mensaje: entrada.mensaje,
      canal: entrada.canal,
      contenidoRequerido: entrada.contenidoRequerido ?? [],
      calendario: entrada.calendario,
      presupuesto: entrada.presupuesto,
      hipotesis: entrada.hipotesis ?? [],
      metricas: entrada.metricas ?? [],
      criterioExito: entrada.criterioExito,
      criterioPausa: entrada.criterioPausa,
      nivelAutonomia: entrada.nivelAutonomia ?? 0,
      aprobaciones: [],
      riesgos: entrada.riesgos ?? [],
      destino: entrada.destino ?? null,
      destinosPorGrupo: entrada.destinosPorGrupo ?? [],
      requisitosPrevios: entrada.requisitosPrevios ?? [],
      alcanceGeografico: entrada.alcanceGeografico ?? null,
      estado: 'BORRADOR',
    };
    const input: EventInput = {
      type: EVENTOS_CAMPANIA.creada,
      payload,
      attribution: a,
      occurredAt: o,
      idempotencyKey: `crear:${campaniaStreamId(org, campaniaId)}`,
    };
    await this.store.append(ctx, campaniaStreamId(org, campaniaId), versionEsperada, [input]);
    return this.cargar(ctx, campaniaId);
  }
}

export { POLITICA_CAMPANIA_CONSERVADORA };
