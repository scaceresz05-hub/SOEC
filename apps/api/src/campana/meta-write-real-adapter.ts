/**
 * apps/api · V2 PRE-REAL · META WRITE REAL ADAPTER. Implementación REAL de MetaWritePort — IMPLEMENTADA pero
 * IMPOSIBLE DE ACTIVAR sin los gates humanos.
 *
 * FAIL-CLOSED en DOS niveles:
 *  1) Constructor: lanza si `SOEC_AUTONOMOUS_REAL !== 'true'`. El adapter real ni siquiera se instancia en
 *     modo seguro (la factory devuelve el dry-run).
 *  2) Cada `ejecutar`: re-verifica el master switch en runtime y TODOS los gates antes de tocar el transporte:
 *     - guardApproved (el Action Plane: policy + budget guard + ledger ya aprobó) — sin esto, jamás llama a Meta;
 *     - operación en whitelist + scopes concedidos suficientes;
 *     - tenant y activo coherentes;
 *     - reconciliación idempotente (nunca duplica campaña/ad por retry).
 * Nunca sube presupuesto ni crea autorizaciones financieras: eso no existe como operación aquí.
 */
import { operacionPermitida, type MetaWritePort, type OperacionMeta, type ResultadoEscrituraMeta, type SolicitudEscrituraMeta } from './meta-write-port';
import { capacidadDe, scopesSuficientes } from './write-capability';
import { ErrorEscrituraMeta, clasificarErrorGraph } from './meta-write-errors';
import type { MetaWriteTransport } from './meta-write-transport';
import type { ReconciliacionRepo } from './meta-write-reconciliation';

export class ModoRealBloqueadoError extends Error {}

export interface DepsRealAdapter {
  readonly transport: MetaWriteTransport;
  readonly reconRepo: ReconciliacionRepo;
  readonly grantedScopes: readonly string[]; // scopes efectivamente concedidos al token
  readonly configReady: boolean; // META_WRITE_CONFIG_READY
  readonly timeoutMs?: number;
  readonly leerMasterSwitch?: () => boolean; // inyectable para tests; por defecto lee el env en runtime
}

const masterSwitchEnv = (): boolean => process.env.SOEC_AUTONOMOUS_REAL === 'true';

/** Deriva (path Graph, body) desde la operación + activo + payload sanitizado. */
function mapearGraph(op: OperacionMeta, assetId: string, payload: Readonly<Record<string, unknown>>): { path: string; body: Record<string, unknown> } {
  switch (op) {
    case 'CREATE_CAMPAIGN':
      return { path: `${assetId}/campaigns`, body: { status: 'PAUSED', ...payload } };
    case 'CREATE_ADSET':
      return { path: `${assetId}/adsets`, body: { status: 'PAUSED', ...payload } };
    case 'CREATE_AD':
      return { path: `${assetId}/ads`, body: { status: 'PAUSED', ...payload } };
    case 'UPLOAD_CREATIVE':
      return { path: `${assetId}/adcreatives`, body: { ...payload } };
    case 'PAUSE_CAMPAIGN':
    case 'PAUSE_AD':
      return { path: `${assetId}`, body: { status: 'PAUSED' } };
    case 'RESUME_CAMPAIGN':
    case 'RESUME_AD':
      return { path: `${assetId}`, body: { status: 'ACTIVE' } };
    case 'PUBLISH_FACEBOOK':
      return { path: `${assetId}/feed`, body: { ...payload } };
    case 'PUBLISH_INSTAGRAM':
      return { path: `${assetId}/media`, body: { ...payload } };
  }
}

export class MetaWriteRealAdapter implements MetaWritePort {
  readonly esReal = true;
  private readonly leerMasterSwitch: () => boolean;

  constructor(private readonly deps: DepsRealAdapter) {
    this.leerMasterSwitch = deps.leerMasterSwitch ?? masterSwitchEnv;
    // GATE 1 (construcción): imposible instanciar el adapter real en modo seguro.
    if (!this.leerMasterSwitch()) throw new ModoRealBloqueadoError('MetaWriteRealAdapter requiere SOEC_AUTONOMOUS_REAL=true');
    if (!deps.configReady) throw new ModoRealBloqueadoError('META_WRITE_CONFIG_READY debe ser true (config incompleta)');
  }

  async ejecutar(s: SolicitudEscrituraMeta): Promise<ResultadoEscrituraMeta> {
    // GATE 2 (runtime): re-chequear master switch en CADA llamada. Aun con credenciales: 0 requests si false.
    if (!this.leerMasterSwitch()) throw new ModoRealBloqueadoError('master switch OFF en runtime: no se ejecuta escritura real');
    // El Action Plane debe haber aprobado (policy + budget guard + ledger). Sin prueba ⇒ no se toca Meta.
    if (s.guardApproved !== true) return this.denegar(s.operacion, 'acción sin aprobación del Action Plane (policy/budget guard)');
    if (!operacionPermitida(s.operacion)) return this.denegar(s.operacion, 'operación no permitida (whitelist)');
    const op = s.operacion as OperacionMeta;
    if (!scopesSuficientes(op, this.deps.grantedScopes)) throw new ErrorEscrituraMeta('SCOPE_MISSING', `faltan scopes para ${op}`);
    if (!s.organizationId || !s.assetId) return this.denegar(op, 'tenant/activo ausente');

    // Reconciliación: reservar atómico. Si ya está COMPLETED ⇒ reusar (idempotente, sin recrear).
    const { creado, previo } = await this.deps.reconRepo.reservar(s.organizationId, s.idempotencyKey, op);
    if (!creado && previo) {
      if (previo.estado === 'COMPLETED' && previo.externalRef) return this.ok(op, previo.externalRef, 'idempotente: ya existía');
      // PENDING/AMBIGUOUS/FAILED previo ⇒ resultado desconocido: NO recrear. Requiere reconciliación manual.
      await this.deps.reconRepo.marcar(s.organizationId, s.idempotencyKey, 'AMBIGUOUS');
      throw new ErrorEscrituraMeta('CONFLICT', `resultado ambiguo para ${op}: no se recrea (evita duplicado)`);
    }

    const { path, body } = mapearGraph(op, s.assetId, s.payload);
    let res;
    try {
      res = await this.deps.transport.ejecutar({ method: 'POST', path, body, timeoutMs: this.deps.timeoutMs ?? 15000 });
    } catch {
      // Excepción del transporte: resultado desconocido ⇒ dejar PENDING y señalar ambiguo (no recrear en retry).
      await this.deps.reconRepo.marcar(s.organizationId, s.idempotencyKey, 'AMBIGUOUS');
      throw new ErrorEscrituraMeta('NETWORK', `fallo de red en ${op} (resultado desconocido)`);
    }

    if (res.status >= 200 && res.status < 300 && typeof res.body['id'] === 'string') {
      const externalRef = String(res.body['id']);
      await this.deps.reconRepo.completar(s.organizationId, s.idempotencyKey, externalRef);
      return this.ok(op, externalRef, 'escritura real confirmada');
    }
    // Error tipado: marcar FAILED (reintentable según clase) y no persistir externalRef.
    const clase = clasificarErrorGraph(res.status, res.body);
    await this.deps.reconRepo.marcar(s.organizationId, s.idempotencyKey, clase === 'CONFLICT' ? 'AMBIGUOUS' : 'FAILED');
    throw new ErrorEscrituraMeta(clase, `Meta rechazó ${op} (${clase})`);
  }

  private ok(op: string, externalRef: string, detalle: string): ResultadoEscrituraMeta {
    return { ok: true, modo: 'REAL', externalRef, operacion: op, detalle };
  }
  private denegar(op: string, detalle: string): ResultadoEscrituraMeta {
    return { ok: false, modo: 'REAL', externalRef: null, operacion: op, detalle, denegada: true };
  }
}
