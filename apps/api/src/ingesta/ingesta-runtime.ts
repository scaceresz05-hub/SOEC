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
 * ALCANCE: las fuentes SIN planificador propio. Google Ads queda fuera a propósito: tiene su propio scheduler
 * multi-tenant con lease distribuido, y repetir su trabajo aquí sólo gastaría cuota de la API.
 *
 * AISLAMIENTO: cada organización corre con su propio `SchedulerIngesta`, su propio contexto y sus propios
 * cursores (`ingesta-cursor:<provider>:<org>`), que ya son por proveedor y organización. Un fallo de una
 * organización se captura y no impide que las demás corran (ni las detiene a mitad).
 *
 * IDEMPOTENCIA: intacta. No se toca la deduplicación existente (`provider:event_id` en la observación y el
 * cursor por fuente), de modo que un reinicio o una corrida repetida no duplica datos.
 */
import { ActorId, OrganizationId, type EventStore, type RequestContext } from '@soec/contracts';
import { SecretStoreEnv, type SecretStore } from '@soec/secretos';
import { ObservacionService } from '@soec/motor-medicion';
import { buscarFuente, buscarFuenteGrowth, buscarNegocio } from '../plataforma';
import { descubridorDelRegistro, type DescubridorDeNegocios } from '../negocio/descubrimiento';
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
  // `secretstore:<org>/<nombre>` ⇒ la credencial vive cifrada por tenant; existe si la conexión la declara y
  // su verificación real ocurre al leer (no se descifra nada aquí sólo para comprobar que está).
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
function prepararOrganizacion(org: string, store: EventStore, env: NodeJS.ProcessEnv, secretStore?: SecretStore): Corrible | null {
  const negocio = buscarNegocio(org);
  if (!negocio) return null;
  const observaciones = new ObservacionService(store, {} as never);
  const fuentes: FuenteIngesta[] = [];
  const nombres: string[] = [];
  const omitidas: string[] = [];
  let growth: IngestaGrowth | null = null;

  // ── Fuente GROWTH propia del negocio (puente M2M declarado por la organización) ──
  // La resolución se hace a prueba de fallos: una fuente mal declarada de UNA empresa no puede abortar el
  // tick de las demás (el bucle superior aísla el fallo de la corrida, no el de la preparación).
  let fuenteGrowth: ReturnType<typeof buscarFuenteGrowth> = null;
  try {
    fuenteGrowth = buscarFuenteGrowth(org);
  } catch (e) {
    omitidas.push(`growth: configuración inválida (${e instanceof Error ? e.message : String(e)})`);
  }
  if (fuenteGrowth === null) {
    omitidas.push('growth: sin fuente declarada o no conectada');
  } else if (!credencialDisponible(fuenteGrowth.credencialRef, env)) {
    // La credencial se DECLARA en la fuente y se deposita fuera del código. Sin ella la organización no entra
    // en la corrida: es una empresa pendiente de conectar, no una avería que haya que reintentar cada tick.
    omitidas.push(`growth: credencial ausente (${fuenteGrowth.credencialRef})`);
  } else {
    try {
      // El almacén de secretos lo inyecta la composición: entorno (credenciales históricas) + depósito
      // cifrado por tenant (credenciales de empresas conectadas desde la interfaz). Sin él, sólo entorno.
      const almacen = secretStore ?? new SecretStoreEnv(env);
      const adaptador = crearGrowthAdapter(fuenteGrowth, { secretStore: almacen, esquemaEgress: ESQUEMA_EGRESS_GROWTH, env });
      growth = new IngestaGrowth({ adaptador, observaciones, store, org, provider: fuenteGrowth.provider });
      fuentes.push({ provider: fuenteGrowth.provider, ingesta: growth });
      nombres.push(fuenteGrowth.sourceId);
    } catch (e) {
      // Credencial ausente o egress mal declarado ⇒ la fuente no entra; el resto de la organización sí.
      omitidas.push(`growth: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Google Ads: NO se ingiere aquí ──
  // Ya tiene su propio scheduler multi-tenant con lease distribuido (`GoogleAdsScheduler`, cadencia 3 h,
  // cableado en server.ts). Duplicarlo cada 15 min gastaría cuota de la API y provocaría 429 sin aportar
  // datos nuevos. Este runtime cubre las fuentes que NO tienen planificador propio: hoy, Growth.
  const fuenteAds = buscarFuente(org, 'google-ads');
  if (fuenteAds) omitidas.push('google-ads: lo ingiere su propio scheduler (GoogleAdsScheduler)');

  if (fuentes.length === 0) return null;
  return { org, negocio: negocio.displayName, scheduler: new SchedulerIngesta({ store, org, fuentes }), growth, fuentes: nombres, omitidas };
}

/**
 * ELEGIBILIDAD COMO DATO (Autonomy Fase B): además de tener fuente y credencial, la organización necesita la
 * capacidad `INGESTA_GROWTH` habilitada. `undefined` ⇒ no se filtra (tests unitarios y despliegues sin base).
 */
export interface OpcionesIngesta {
  readonly elegibles?: () => Promise<ReadonlySet<string>>;
  /** Almacén de secretos de la composición (entorno + depósito cifrado por tenant). */
  readonly secretStore?: SecretStore;
}

/**
 * Qué organizaciones puede ingerir este despliegue AHORA, y con qué fuentes. Sólo lectura de configuración.
 * Las organizaciones las aporta el DESCUBRIDOR (la base), no un array en código.
 */
export async function planDeIngesta(
  store: EventStore,
  env: NodeJS.ProcessEnv,
  descubrir: DescubridorDeNegocios = descubridorDelRegistro,
  opciones: OpcionesIngesta = {},
): Promise<readonly PlanIngestaOrg[]> {
  const plan: PlanIngestaOrg[] = [];
  const elegibles = opciones.elegibles ? await opciones.elegibles() : null;
  for (const org of await descubrir()) {
    if (elegibles !== null && !elegibles.has(org)) continue; // capacidad no habilitada: no es un fallo
    const c = prepararOrganizacion(org, store, env, opciones.secretStore);
    if (c !== null) plan.push({ org: c.org, negocio: c.negocio, fuentes: c.fuentes, omitidas: c.omitidas });
  }
  return plan;
}

export interface DepsIngestaRuntime {
  readonly store: EventStore;
  readonly env: NodeJS.ProcessEnv;
  readonly salud?: RepositorioSaludJobs;
  /** De dónde salen las organizaciones. Por defecto, el registro histórico (para tests sin base). */
  readonly descubrir?: DescubridorDeNegocios;
  readonly ahora?: () => string;
  readonly log?: (info: Record<string, unknown>) => void;
  /** Organizaciones con la capacidad de ingesta habilitada. Ausente ⇒ no se filtra por capacidad. */
  readonly elegibles?: () => Promise<ReadonlySet<string>>;
  /** Almacén de secretos con el que se resuelven las credenciales de las fuentes. */
  readonly secretStore?: SecretStore;
}

/**
 * Una pasada completa: recorre las organizaciones ingeribles y corre cada una AISLADA. El fallo de una no
 * bloquea a las otras (se registra y se sigue). Devuelve un resultado por organización.
 */
export async function correrIngestaDeTodas(deps: DepsIngestaRuntime, intervaloMs: number): Promise<readonly ResultadoIngestaOrg[]> {
  const ahora = deps.ahora ?? (() => new Date().toISOString());
  const resultados: ResultadoIngestaOrg[] = [];
  const elegibles = deps.elegibles ? await deps.elegibles() : null;
  for (const org of await (deps.descubrir ?? descubridorDelRegistro)()) {
    if (elegibles !== null && !elegibles.has(org)) continue; // sin capacidad habilitada no se ingiere
    const corrible = prepararOrganizacion(org, deps.store, deps.env, deps.secretStore);
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
      // El RESUMEN por fuente es la prueba de la no-duplicación: leídos/ingeridos/nuevos y el cursor antes y
      // después. Son contadores y un número de cursor; ningún dato de persona sale en el log.
      deps.log?.({
        ingestion: 'tick', org, negocio: corrible.negocio, estado: r.estado,
        fuentes: r.fuentes.map((f) => ({ provider: f.provider, estado: f.estado, resumen: f.resumen ?? null })),
        omitidas: corrible.omitidas,
      });
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
 * Marca como DESHABILITADAS las organizaciones registradas que HOY no son ingeribles, con su motivo. Sin
 * esto, una organización que dejó de entrar en el plan (credencial retirada, fuente movida a otro
 * planificador) conservaría para siempre su último estado —incluido un `FALLANDO` viejo— y el read model
 * mentiría sobre lo que el sistema está haciendo.
 */
export async function sincronizarSaludDelPlan(deps: DepsIngestaRuntime): Promise<void> {
  if (!deps.salud) return;
  const opciones: OpcionesIngesta = { elegibles: deps.elegibles, secretStore: deps.secretStore };
  const ingeribles = new Set((await planDeIngesta(deps.store, deps.env, deps.descubrir, opciones)).map((p) => p.org));
  const elegibles = deps.elegibles ? await deps.elegibles() : null;
  for (const org of await (deps.descubrir ?? descubridorDelRegistro)()) {
    if (ingeribles.has(org)) continue;
    const motivo = elegibles !== null && !elegibles.has(org)
      ? 'capacidad INGESTA_GROWTH no habilitada para este negocio'
      : buscarFuenteGrowth(org) === null
        ? 'sin fuente Growth declarada o conectada'
        : 'credencial de la fuente Growth ausente en este despliegue';
    await deps.salud.marcarDeshabilitado(JOB, org, motivo).catch(() => undefined);
  }
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
