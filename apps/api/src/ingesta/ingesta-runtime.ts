/**
 * apps/api · INGESTA SERVER-SIDE MULTIEMPRESA.
 *
 * Sustituye la dependencia de una tarea de Windows (`scripts/ingesta-tick.cmd` → `ingest-all.ts`), que
 * corría en el PC de un desarrollador, contra un Postgres local, para UNA organización fijada por
 * `SOEC_INGESTA_ORG`, y que llevaba deshabilitada desde 2026-08-27. Aquí la ingesta vive dentro del
 * proceso del servidor, descubre por sí misma qué organizaciones puede ingerir y corre cada una aislada.
 *
 * DESCUBRIMIENTO (nunca una organización fijada en código): se recorre el registro de negocios y se admite
 * una organización sólo si tiene una fuente DECLARADA, su estado permite lectura y sus credenciales se
 * resuelven de verdad. Una fuente `NOT_CONNECTED`, sin token o sin recurso configurado simplemente no entra
 * en la corrida: no se inventa ni se hereda la de otra.
 *
 * AISLAMIENTO: cada organización corre con su propio `SchedulerIngesta`, su propio contexto y sus propios
 * cursores (`ingesta-cursor:<provider>:<org>`), que ya son por proveedor y organización. Un fallo de una
 * organización se captura y no impide que las demás corran (ni las detiene a mitad).
 *
 * IDEMPOTENCIA: intacta. No se toca la deduplicación existente (`provider:event_id` en la observación y el
 * cursor por fuente), de modo que un reinicio o una corrida repetida no duplica datos.
 */
import { ActorId, OrganizationId, type EventStore, type RequestContext } from '@soec/contracts';
import { SecretStoreEnv } from '@soec/secretos';
import { ObservacionService } from '@soec/motor-medicion';
import { buscarFuente, buscarFuenteGrowth, buscarNegocio, organizacionesRegistradas } from '../plataforma';
import { construirIngestaGoogleAds } from './google-ads-runtime';
import { ESQUEMA_EGRESS_GROWTH, crearGrowthAdapter } from './growth-adapter';
import { IngestaGrowth } from './ingesta-growth-service';
import { SchedulerIngesta, type FuenteIngesta } from './scheduler';
import type { NombreJob, RepositorioSaludJobs } from '../operacion/job-health-pg';

/** Ventana de reconciliación de naturaleza TEST/REAL, igual que en el script que se reemplaza. */
const VENTANA_RECONCILIACION_MS = 30 * 24 * 3600 * 1000;

const JOB: NombreJob = 'ingestion';

export interface PlanIngestaOrg {
  readonly org: string;
  readonly negocio: string;
  readonly fuentes: readonly string[];
  /** Motivos por los que alguna fuente declarada quedó fuera de la corrida (visibles, no silenciosos). */
  readonly omitidas: readonly string[];
}

export interface ResultadoIngestaOrg {
  readonly org: string;
  readonly ok: boolean;
  readonly estado: string;
  readonly fuentes: readonly string[];
  readonly error?: string;
}

/**
 * ¿Está disponible la credencial que declara la fuente? Sólo se comprueba la referencia `env:NOMBRE`, que es
 * la que resuelve este proceso; otras referencias (depósito en archivo, KMS) las resuelve su propio adaptador
 * y no se pueden verificar aquí sin abrirlas — nunca se lee ni se registra el valor.
 */
function credencialDisponible(credencialRef: string, env: NodeJS.ProcessEnv): boolean {
  if (!credencialRef.startsWith('env:')) return true;
  const nombre = credencialRef.slice('env:'.length);
  return typeof env[nombre] === 'string' && env[nombre]!.trim().length > 0;
}

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('ingesta-servidor'),
    scope: { organizationId: o, permissions: ['events:append', 'events:read'] },
    correlationId: `ingesta-servidor-${org}`,
  };
}

interface Corrible {
  readonly org: string;
  readonly negocio: string;
  readonly scheduler: SchedulerIngesta;
  readonly growth: IngestaGrowth | null;
  readonly fuentes: readonly string[];
  readonly omitidas: readonly string[];
}

/**
 * Construye lo corrible de UNA organización. Devuelve `null` si no tiene ninguna fuente ingerible: no es un
 * error, es una organización que todavía no está conectada.
 */
function prepararOrganizacion(org: string, store: EventStore, env: NodeJS.ProcessEnv): Corrible | null {
  const negocio = buscarNegocio(org);
  if (!negocio) return null;
  const observaciones = new ObservacionService(store, {} as never);
  const fuentes: FuenteIngesta[] = [];
  const nombres: string[] = [];
  const omitidas: string[] = [];
  let growth: IngestaGrowth | null = null;

  // ── Fuente GROWTH propia del negocio (puente M2M declarado por la organización) ──
  const fuenteGrowth = buscarFuenteGrowth(org);
  if (fuenteGrowth === null) {
    omitidas.push('growth: sin fuente declarada o no conectada');
  } else if (!credencialDisponible(fuenteGrowth.credencialRef, env)) {
    // La credencial se DECLARA en la fuente y se deposita fuera del código. Sin ella la organización no entra
    // en la corrida: es una empresa pendiente de conectar, no una avería que haya que reintentar cada tick.
    omitidas.push(`growth: credencial ausente (${fuenteGrowth.credencialRef})`);
  } else {
    try {
      const adaptador = crearGrowthAdapter(fuenteGrowth, { secretStore: new SecretStoreEnv(env), esquemaEgress: ESQUEMA_EGRESS_GROWTH, env });
      growth = new IngestaGrowth({ adaptador, observaciones, store, org, provider: fuenteGrowth.provider });
      fuentes.push({ provider: fuenteGrowth.provider, ingesta: growth });
      nombres.push(fuenteGrowth.sourceId);
    } catch (e) {
      // Credencial ausente o egress mal declarado ⇒ la fuente no entra; el resto de la organización sí.
      omitidas.push(`growth: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Fuente Google Ads (READ ONLY), si la organización la tiene configurada ──
  const fuenteAds = buscarFuente(org, 'google-ads');
  if (!fuenteAds) {
    omitidas.push('google-ads: sin fuente declarada');
  } else {
    const ingestaAds = construirIngestaGoogleAds(store, env, org);
    if (ingestaAds === null) omitidas.push('google-ads: credenciales o recurso incompletos');
    else {
      fuentes.push({ provider: fuenteAds.provider, ingesta: ingestaAds });
      nombres.push(fuenteAds.sourceId);
    }
  }

  if (fuentes.length === 0) return null;
  return { org, negocio: negocio.displayName, scheduler: new SchedulerIngesta({ store, org, fuentes }), growth, fuentes: nombres, omitidas };
}

/** Qué organizaciones puede ingerir este despliegue AHORA, y con qué fuentes. Sólo lectura de configuración. */
export function planDeIngesta(store: EventStore, env: NodeJS.ProcessEnv): readonly PlanIngestaOrg[] {
  const plan: PlanIngestaOrg[] = [];
  for (const org of organizacionesRegistradas()) {
    const c = prepararOrganizacion(org, store, env);
    if (c !== null) plan.push({ org: c.org, negocio: c.negocio, fuentes: c.fuentes, omitidas: c.omitidas });
  }
  return plan;
}

export interface DepsIngestaRuntime {
  readonly store: EventStore;
  readonly env: NodeJS.ProcessEnv;
  readonly salud?: RepositorioSaludJobs;
  readonly ahora?: () => string;
  readonly log?: (info: Record<string, unknown>) => void;
}

/**
 * Una pasada completa: recorre las organizaciones ingeribles y corre cada una AISLADA. El fallo de una no
 * bloquea a las otras (se registra y se sigue). Devuelve un resultado por organización.
 */
export async function correrIngestaDeTodas(deps: DepsIngestaRuntime, intervaloMs: number): Promise<readonly ResultadoIngestaOrg[]> {
  const ahora = deps.ahora ?? (() => new Date().toISOString());
  const resultados: ResultadoIngestaOrg[] = [];
  for (const org of organizacionesRegistradas()) {
    const corrible = prepararOrganizacion(org, deps.store, deps.env);
    if (corrible === null) continue; // organización sin fuentes ingeribles: no es un fallo
    const inicio = ahora();
    await deps.salud?.marcarInicio(JOB, org, inicio).catch(() => undefined);
    try {
      const r = await corrible.scheduler.correrTodo(ctx(org), { ahora: inicio });
      // Reconciliación de naturaleza TEST/REAL: no puede tumbar el tick (igual que en el script anterior).
      if (corrible.growth !== null) {
        try {
          const desde = new Date(Date.parse(inicio) - VENTANA_RECONCILIACION_MS).toISOString();
          await corrible.growth.reconciliarDiagnostico(ctx(org), { ahora: ahora(), since: desde });
        } catch (e) {
          deps.log?.({ ingestion: 'reconcile_failed', org, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const fin = ahora();
      const ok = r.estado !== 'TOTAL_FAILURE';
      const siguiente = new Date(Date.parse(fin) + intervaloMs).toISOString();
      if (ok) await deps.salud?.marcarExito(JOB, org, fin, siguiente).catch(() => undefined);
      else await deps.salud?.marcarFallo(JOB, org, fin, JSON.stringify(r.fuentes.filter((f) => !f.ok).map((f) => f.error ?? f.provider)), siguiente).catch(() => undefined);
      deps.log?.({ ingestion: 'tick', org, negocio: corrible.negocio, estado: r.estado, fuentes: corrible.fuentes, omitidas: corrible.omitidas });
      resultados.push({ org, ok, estado: r.estado, fuentes: corrible.fuentes });
    } catch (e) {
      // AISLAMIENTO: una organización caída no detiene a las demás.
      const error = e instanceof Error ? e.message : String(e);
      const fin = ahora();
      await deps.salud?.marcarFallo(JOB, org, fin, error, new Date(Date.parse(fin) + intervaloMs).toISOString()).catch(() => undefined);
      deps.log?.({ ingestion: 'tick_failed', org, error });
      resultados.push({ org, ok: false, estado: 'TOTAL_FAILURE', fuentes: corrible.fuentes, error });
    }
  }
  return resultados;
}

/**
 * Arranca el bucle dentro del servidor. `unref()` para no retener el proceso, sin solapes (un tick lento no
 * lanza otro encima) y con la primera corrida diferida unos segundos para no competir con el arranque.
 */
export function iniciarIngestaServidor(deps: DepsIngestaRuntime, intervaloMs: number, retrasoInicialMs = 30_000): { detener: () => void } {
  let corriendo = false;
  const tick = async (): Promise<void> => {
    if (corriendo) return;
    corriendo = true;
    try {
      await correrIngestaDeTodas(deps, intervaloMs);
    } catch (e) {
      deps.log?.({ ingestion: 'loop_error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      corriendo = false;
    }
  };
  const primero = setTimeout(() => void tick(), retrasoInicialMs);
  const timer = setInterval(() => void tick(), intervaloMs);
  primero.unref?.();
  timer.unref?.();
  return {
    detener: () => {
      clearTimeout(primero);
      clearInterval(timer);
    },
  };
}
