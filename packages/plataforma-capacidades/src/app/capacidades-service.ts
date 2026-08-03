/**
 * @soec/plataforma-capacidades · aplicación · Servicio del NÚCLEO de la PCE (M4-A). Registra y gobierna
 * el ciclo de vida de las capacidades externas (Título I de la Directiva Maestra PCE), event-sourced y
 * multi-tenant. NEUTRAL: no conoce proveedores concretos ni secretos ni costos; sólo referencias opacas.
 * Determinista: el `occurredAt` lo provee el llamador (sin reloj del sistema).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { CapacidadExternaInvalidaError, CapacidadNoEncontradaError } from '../domain/errors';
import {
  type CapacidadState,
  type EstadoCapacidad,
  type ModoCapacidad,
  type PoliticaDegradacion,
  type SaludCapacidad,
  type VeredictoConsumo,
  EVENTOS_CAPACIDAD,
  capacidadStreamId,
  esConsumible,
  puedeActivarReal,
  reconstruirCapacidad,
  transicionCicloValida,
} from '../domain/capacidad';
import { esIdentificadorLogico, esReferenciaSecreto } from '../domain/referencias';
import {
  type CapacidadIndice,
  EVENTOS_CAP_INDICE,
  capacidadIndiceStreamId,
  reconstruirCapacidadIndice,
} from '../domain/indice';

const POLITICAS: readonly PoliticaDegradacion[] = ['ABSTENER', 'SIMULAR', 'ALTERNATIVA', 'CACHE', 'DETENER'];
const SALUDES: readonly SaludCapacidad[] = ['SALUDABLE', 'DEGRADADA', 'NO_CONFIABLE'];

export class CapacidadesExternasService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  private append(ctx: RequestContext, capacidadId: string, version: number, type: string, payload: unknown, a: Attribution, o: string): Promise<{ version: number }> {
    const ev: EventInput = { type, payload, attribution: a, occurredAt: o };
    return this.store.append(ctx, capacidadStreamId(this.org(ctx), capacidadId), version, [ev]);
  }

  async cargar(ctx: RequestContext, capacidadId: string): Promise<CapacidadState> {
    const org = this.org(ctx);
    return reconstruirCapacidad(org, capacidadId, await this.store.readStream(ctx, capacidadStreamId(org, capacidadId)));
  }

  async listar(ctx: RequestContext): Promise<CapacidadIndice> {
    return reconstruirCapacidadIndice(this.org(ctx), await this.store.readStream(ctx, capacidadIndiceStreamId(this.org(ctx))));
  }

  private async exigir(ctx: RequestContext, capacidadId: string): Promise<CapacidadState> {
    const st = await this.cargar(ctx, capacidadId);
    if (!st.existe) throw new CapacidadNoEncontradaError(`capacidad ${capacidadId} no encontrada`);
    if (st.terminada) throw new CapacidadExternaInvalidaError(`la capacidad ${capacidadId} está ${st.estado} (terminal)`);
    return st;
  }

  /**
   * Registra una capacidad. Nace SIMULADA (Art. 3). La política de degradación es OBLIGATORIA (Art. 11).
   * Idempotente por capacidadId; asegura el índice (autorreparable).
   */
  async registrar(ctx: RequestContext, capacidadId: string, tipo: string, politicaDegradacion: PoliticaDegradacion, a: Attribution, o: string): Promise<void> {
    if (!capacidadId?.trim()) throw new CapacidadExternaInvalidaError('capacidadId es obligatorio');
    if (!tipo?.trim()) throw new CapacidadExternaInvalidaError('tipo es obligatorio (una Capacidad, no un proveedor)');
    if (!POLITICAS.includes(politicaDegradacion)) throw new CapacidadExternaInvalidaError('politicaDegradacion inválida (Art. 11: obligatoria y explícita)');
    const st = await this.cargar(ctx, capacidadId);
    if (!st.existe) {
      await this.append(ctx, capacidadId, st.version, EVENTOS_CAPACIDAD.registrada, { tipo: tipo.trim(), politicaDegradacion }, a, o);
    }
    await this.asegurarEnIndice(ctx, capacidadId, tipo.trim(), a, o);
  }

  /**
   * Configura las REFERENCIAS opacas (Art. 2/4): proveedorRef + secretRef (NUNCA el valor del secreto ni el
   * proveedor concreto) + política de degradación. Versiona la configuración (Art. 7). No admite valores que
   * parezcan un secreto en claro (guardarraíl del Art. 4).
   */
  async configurar(ctx: RequestContext, capacidadId: string, cfg: { proveedorRef: string; secretRef: string; politicaDegradacion: PoliticaDegradacion; alternativaCapacidadId?: string; cacheRef?: string }, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, capacidadId);
    if (!POLITICAS.includes(cfg.politicaDegradacion)) throw new CapacidadExternaInvalidaError('politicaDegradacion inválida');
    // M4A-1 (Art. 4): el secretRef debe ser una REFERENCIA opaca; se rechaza cualquier valor con forma de
    // secreto (env:sk-…, tokens largos, "Bearer …", claves con "="). El proveedorRef es un id lógico, no texto libre.
    if (!esReferenciaSecreto(cfg.secretRef?.trim() ?? '')) throw new CapacidadExternaInvalidaError('secretRef debe ser una REFERENCIA de una allowlist (env:/vault:/aws-sm:…) y NO puede tener forma de secreto (Art. 4)');
    if (!esIdentificadorLogico(cfg.proveedorRef?.trim() ?? '')) throw new CapacidadExternaInvalidaError('proveedorRef debe ser un identificador lógico acotado (no un secreto ni texto libre)');
    // M4A-4 (Art. 11): la política de degradación debe traer su objetivo cuando lo requiere.
    const alternativaCapacidadId = cfg.alternativaCapacidadId?.trim() || null;
    const cacheRef = cfg.cacheRef?.trim() || null;
    if (cfg.politicaDegradacion === 'ALTERNATIVA') {
      if (!alternativaCapacidadId) throw new CapacidadExternaInvalidaError('la política ALTERNATIVA requiere alternativaCapacidadId');
      if (alternativaCapacidadId === capacidadId) throw new CapacidadExternaInvalidaError('la alternativa no puede ser la propia capacidad (ciclo)');
    }
    if (cfg.politicaDegradacion === 'CACHE' && !cacheRef) throw new CapacidadExternaInvalidaError('la política CACHE requiere cacheRef');
    // M4A-3 (Art. 7): re-configurar con contenido IDÉNTICO no versiona (evita inflación en replay/auditoría).
    if (st.proveedorRef === cfg.proveedorRef.trim() && st.secretRef === cfg.secretRef.trim() && st.politicaDegradacion === cfg.politicaDegradacion && st.alternativaCapacidadId === alternativaCapacidadId && st.cacheRef === cacheRef) return;
    await this.append(ctx, capacidadId, st.version, EVENTOS_CAPACIDAD.configurada, { proveedorRef: cfg.proveedorRef.trim(), secretRef: cfg.secretRef.trim(), politicaDegradacion: cfg.politicaDegradacion, alternativaCapacidadId, cacheRef, configVersion: st.configVersion + 1 }, a, o);
  }

  /** Avanza el ciclo de vida (Art. 3). `autorizar`/`ponerEnUso` son actos humanos gobernados. */
  async transicionar(ctx: RequestContext, capacidadId: string, hacia: EstadoCapacidad, opts: { actorHumano?: string } = {}, a: Attribution, o: string): Promise<CapacidadState> {
    if (hacia === 'REEMPLAZADA') throw new CapacidadExternaInvalidaError('use reemplazar() para un reemplazo gobernado (M4A-5)');
    const st = await this.exigir(ctx, capacidadId);
    if (!transicionCicloValida(st.estado, hacia)) throw new CapacidadExternaInvalidaError(`transición inválida ${st.estado}→${hacia}`);
    if ((hacia === 'AUTORIZADA' || hacia === 'EN_USO') && !opts.actorHumano?.trim()) {
      throw new CapacidadExternaInvalidaError(`${hacia} requiere un actor humano (soberanía humana, Art. 8)`);
    }
    if (hacia === 'HABILITADA' && !st.proveedorRef) throw new CapacidadExternaInvalidaError('no se puede HABILITAR sin configurar (proveedorRef/secretRef)');
    await this.append(ctx, capacidadId, st.version, EVENTOS_CAPACIDAD.transicionada, { estado: hacia }, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /**
   * Reemplazo GOBERNADO (M4A-5): la capacidad `capacidadId` se reemplaza por `porCapacidadId`. Acto humano.
   * Valida que el reemplazo exista en la MISMA organización, sea del MISMO tipo (compatibilidad), no sea la
   * propia capacidad (ciclo trivial) ni una capacidad terminal, y no genere reemplazo recíproco directo.
   */
  async reemplazar(ctx: RequestContext, capacidadId: string, porCapacidadId: string, actorHumano: string, a: Attribution, o: string): Promise<CapacidadState> {
    const st = await this.exigir(ctx, capacidadId);
    if (!actorHumano?.trim()) throw new CapacidadExternaInvalidaError('el reemplazo requiere un actor humano (Art. 8)');
    if (!porCapacidadId?.trim()) throw new CapacidadExternaInvalidaError('porCapacidadId es obligatorio');
    if (porCapacidadId === capacidadId) throw new CapacidadExternaInvalidaError('una capacidad no puede reemplazarse a sí misma (ciclo)');
    const destino = await this.cargar(ctx, porCapacidadId); // misma org (contexto)
    if (!destino.existe) throw new CapacidadExternaInvalidaError(`la capacidad de reemplazo ${porCapacidadId} no existe en la organización`);
    if (destino.terminada) throw new CapacidadExternaInvalidaError(`la capacidad de reemplazo ${porCapacidadId} está ${destino.estado} (terminal)`);
    if (destino.tipo !== st.tipo) throw new CapacidadExternaInvalidaError(`incompatibles: ${capacidadId} es '${st.tipo}' y ${porCapacidadId} es '${destino.tipo}'`);
    if (destino.reemplazadaPor === capacidadId) throw new CapacidadExternaInvalidaError('reemplazo recíproco (ciclo A↔B)');
    await this.append(ctx, capacidadId, st.version, EVENTOS_CAPACIDAD.transicionada, { estado: 'REEMPLAZADA', reemplazadaPor: porCapacidadId }, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** AUTORIDAD ÚNICA de consumibilidad (M4A-2): todo consumidor debe usar esto (no re-derivar). */
  async puedeConsumir(ctx: RequestContext, capacidadId: string): Promise<VeredictoConsumo> {
    return esConsumible(await this.cargar(ctx, capacidadId));
  }

  /**
   * Activa la capacidad en modo REAL (acto humano). Exige EN_USO + referencias + salud SALUDABLE (Art. 3/13).
   * NUNCA se asciende a REAL de forma implícita.
   */
  async activarReal(ctx: RequestContext, capacidadId: string, actorHumano: string, a: Attribution, o: string): Promise<CapacidadState> {
    const st = await this.exigir(ctx, capacidadId);
    if (!actorHumano?.trim()) throw new CapacidadExternaInvalidaError('activar en modo REAL requiere un actor humano (Art. 8)');
    const ok = puedeActivarReal(st);
    if (!ok.ok) throw new CapacidadExternaInvalidaError(ok.motivo);
    if (st.modo === 'REAL') return st; // idempotente
    await this.append(ctx, capacidadId, st.version, EVENTOS_CAPACIDAD.modoCambiado, { modo: 'REAL' satisfies ModoCapacidad, actorHumano }, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Kill-switch explícito (Art. 8): devuelve la capacidad a modo SIMULADA de inmediato. */
  async volverASimulado(ctx: RequestContext, capacidadId: string, motivo: string, a: Attribution, o: string): Promise<CapacidadState> {
    const st = await this.exigir(ctx, capacidadId);
    if (st.modo === 'SIMULADA') return st;
    await this.append(ctx, capacidadId, st.version, EVENTOS_CAPACIDAD.modoCambiado, { modo: 'SIMULADA' satisfies ModoCapacidad, motivo }, a, o);
    return this.cargar(ctx, capacidadId);
  }

  /** Registra la salud (Art. 13). NO_CONFIABLE en modo REAL → el reductor la devuelve a SIMULADA (fail-safe). */
  async registrarSalud(ctx: RequestContext, capacidadId: string, salud: SaludCapacidad, a: Attribution, o: string): Promise<CapacidadState> {
    const st = await this.exigir(ctx, capacidadId);
    if (!SALUDES.includes(salud)) throw new CapacidadExternaInvalidaError('salud inválida');
    await this.append(ctx, capacidadId, st.version, EVENTOS_CAPACIDAD.saludRegistrada, { salud }, a, o);
    return this.cargar(ctx, capacidadId);
  }

  private async asegurarEnIndice(ctx: RequestContext, capacidadId: string, tipo: string, a: Attribution, o: string): Promise<void> {
    const org = this.org(ctx);
    const idx = reconstruirCapacidadIndice(org, await this.store.readStream(ctx, capacidadIndiceStreamId(org)));
    if (idx.capacidades.some((c) => c.capacidadId === capacidadId)) return;
    const ev: EventInput = { type: EVENTOS_CAP_INDICE.registrada, payload: { capacidadId, tipo }, attribution: a, occurredAt: o };
    await this.store.append(ctx, capacidadIndiceStreamId(org), idx.version, [ev]);
  }
}
