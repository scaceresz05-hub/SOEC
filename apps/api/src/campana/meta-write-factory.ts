/**
 * apps/api · V2 PRE-REAL · FACTORY de selección de modo de escritura. FAIL-CLOSED:
 *   SOEC_AUTONOMOUS_REAL != 'true'  → SIEMPRE MetaWriteDryRunAdapter (0 escrituras reales).
 *   SOEC_AUTONOMOUS_REAL == 'true'  → MetaWriteRealAdapter, PERO además exige META_WRITE_CONFIG_READY,
 *     scopes suficientes y transporte/reconciliación configurados. Si algo falta, NO cae a real a medias:
 *     lanza (o, si se pide tolerancia, vuelve al dry-run). Nunca se "activa por accidente".
 */
import { MetaWriteDryRunAdapter, type MetaWritePort } from './meta-write-port';
import { MetaWriteRealAdapter, ModoRealBloqueadoError, type DepsRealAdapter } from './meta-write-real-adapter';
import { SCOPES_ESCRITURA_REQUERIDOS } from './write-capability';

export interface ConfigSeleccionEscritura {
  readonly autonomousReal: boolean; // normalmente process.env.SOEC_AUTONOMOUS_REAL === 'true'
  readonly configReady: boolean; // META_WRITE_CONFIG_READY
  readonly grantedScopes: readonly string[];
  readonly real?: Omit<DepsRealAdapter, 'configReady' | 'grantedScopes'>; // transporte + reconciliación (sólo si real)
}

export interface ResultadoSeleccion {
  readonly port: MetaWritePort;
  readonly modo: 'DRY_RUN' | 'REAL';
  readonly motivo: string;
}

/** Devuelve el port a usar. En modo seguro SIEMPRE dry-run. En real, sólo si TODO está listo (fail-closed). */
export function seleccionarMetaWritePort(cfg: ConfigSeleccionEscritura): ResultadoSeleccion {
  if (!cfg.autonomousReal) {
    return { port: new MetaWriteDryRunAdapter(), modo: 'DRY_RUN', motivo: 'SOEC_AUTONOMOUS_REAL != true ⇒ modo seguro (simulación)' };
  }
  // Real solicitado: exigir configuración completa. Cualquier falta ⇒ fail-closed a dry-run (nunca real a medias).
  const scopesOk = SCOPES_ESCRITURA_REQUERIDOS.every((s) => cfg.grantedScopes.includes(s));
  if (!cfg.configReady || !scopesOk || !cfg.real) {
    const faltan = !cfg.configReady ? 'META_WRITE_CONFIG_READY=false' : !scopesOk ? 'scopes de escritura insuficientes' : 'transporte/reconciliación no configurados';
    return { port: new MetaWriteDryRunAdapter(), modo: 'DRY_RUN', motivo: `real solicitado pero ${faltan} ⇒ fail-closed a simulación` };
  }
  try {
    const port = new MetaWriteRealAdapter({ ...cfg.real, configReady: cfg.configReady, grantedScopes: cfg.grantedScopes });
    return { port, modo: 'REAL', motivo: 'todos los gates de configuración OK (ejecución real habilitada)' };
  } catch (e) {
    if (e instanceof ModoRealBloqueadoError) return { port: new MetaWriteDryRunAdapter(), modo: 'DRY_RUN', motivo: `adapter real rechazó activarse: ${e.message}` };
    throw e;
  }
}
