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
  EVENTOS_CAPACIDAD,
  capacidadStreamId,
  puedeActivarReal,
  reconstruirCapacidad,
  transicionCicloValida,
} from '../domain/capacidad';
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
  async configurar(ctx: RequestContext, capacidadId: string, cfg: { proveedorRef: string; secretRef: string; politicaDegradacion: PoliticaDegradacion }, a: Attribution, o: string): Promise<void> {
    const st = await this.exigir(ctx, capacidadId);
    if (!cfg.proveedorRef?.trim() || !cfg.secretRef?.trim()) throw new CapacidadExternaInvalidaError('proveedorRef y secretRef (referencias) son obligatorios');
    if (!POLITICAS.includes(cfg.politicaDegradacion)) throw new CapacidadExternaInvalidaError('politicaDegradacion inválida');
    if (!esReferencia(cfg.secretRef)) throw new CapacidadExternaInvalidaError('secretRef debe ser una REFERENCIA (p. ej. env:… / vault:…), nunca el valor del secreto (Art. 4)');
    await this.append(ctx, capacidadId, st.version, EVENTOS_CAPACIDAD.configurada, { proveedorRef: cfg.proveedorRef.trim(), secretRef: cfg.secretRef.trim(), politicaDegradacion: cfg.politicaDegradacion, configVersion: st.configVersion + 1 }, a, o);
  }

  /** Avanza el ciclo de vida (Art. 3). `autorizar`/`ponerEnUso` son actos humanos gobernados. */
  async transicionar(ctx: RequestContext, capacidadId: string, hacia: EstadoCapacidad, opts: { actorHumano?: string; reemplazadaPor?: string } = {}, a: Attribution, o: string): Promise<CapacidadState> {
    const st = await this.exigir(ctx, capacidadId);
    if (!transicionCicloValida(st.estado, hacia)) throw new CapacidadExternaInvalidaError(`transición inválida ${st.estado}→${hacia}`);
    if ((hacia === 'AUTORIZADA' || hacia === 'EN_USO') && !opts.actorHumano?.trim()) {
      throw new CapacidadExternaInvalidaError(`${hacia} requiere un actor humano (soberanía humana, Art. 8)`);
    }
    if (hacia === 'HABILITADA' && !st.proveedorRef) throw new CapacidadExternaInvalidaError('no se puede HABILITAR sin configurar (proveedorRef/secretRef)');
    await this.append(ctx, capacidadId, st.version, EVENTOS_CAPACIDAD.transicionada, { estado: hacia, ...(opts.reemplazadaPor ? { reemplazadaPor: opts.reemplazadaPor } : {}) }, a, o);
    return this.cargar(ctx, capacidadId);
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

/** Un secretRef es una REFERENCIA (esquema:…), no un valor. Guardarraíl del Art. 4. */
function esReferencia(v: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(v.trim());
}
