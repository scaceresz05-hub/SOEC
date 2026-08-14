/**
 * apps/api · autonomía · CANARY REAL — última milla en STANDBY (sin efecto externo).
 *
 * Cablea el canary con los perfiles reales: la credencial de escritura NO está configurada (fail-closed
 * ⇒ WRITE NOT_READY), el interruptor maestro `AUTONOMOUS_REAL` sigue apagado, y el candidato se deriva
 * SÓLO de una intención comercial real elegible. Si no hay ninguna, `CANARY_CANDIDATE = NONE` (abstención,
 * un PASS). Nunca se construye una acción para «probar». No importa ningún adaptador de escritura real.
 */
import { AUTONOMOUS_REAL } from '@soec/cia';
import {
  estadoCapacidadWrite,
  evaluarCandidatoCanary,
  preMutateCheck,
  type CanaryCandidate,
  type CredencialWrite,
  type EstadoCapacidadWrite,
} from '@soec/autonomia';
import { getRecursoGoogleAds } from '../plataforma';
import { evaluarSombraAds, type EntradaSombraAds } from './shadow-ads';

/**
 * Contrato de credencial de escritura por organización. `credentialRef = null`: NO hay token de
 * escritura (fail-closed). NUNCA se reutiliza la credencial de lectura. Tenant-scoped a la cuenta real.
 */
export function credencialWriteDe(org: string): CredencialWrite | null {
  let externalAccountId: string;
  try {
    externalAccountId = getRecursoGoogleAds(org).customerId;
  } catch {
    return null; // sin cuenta de Ads ⇒ no hay a qué asociar escritura
  }
  return {
    credentialRef: null, // ← sin token de escritura configurado (a propósito)
    organizationId: org,
    provider: 'google-ads',
    externalAccountId,
    permissionScope: 'WRITE',
    capabilities: ['ADD_NEGATIVE_KEYWORD_EXACT'],
  };
}

export type EstadoCanary =
  | { readonly candidato: 'NONE'; readonly motivo: string; readonly writeEstado: EstadoCapacidadWrite; readonly autonomousReal: boolean; readonly puedeMutarHoy: false }
  | { readonly candidato: 'CANDIDATE'; readonly detalle: CanaryCandidate; readonly writeEstado: EstadoCapacidadWrite; readonly autonomousReal: boolean; readonly puedeMutarHoy: boolean; readonly preMutateRazon: string };

/**
 * Evalúa el estado del canary para una organización con datos reales. La ABSTENCIÓN (`NONE`) es válida.
 * Aunque apareciera un candidato, `puedeMutarHoy` es false: no hay credencial de escritura y
 * `AUTONOMOUS_REAL` está apagado.
 */
export function evaluarCanaryReal(org: string, entrada: EntradaSombraAds): EstadoCanary {
  const cred = credencialWriteDe(org);
  const sombra = evaluarSombraAds(entrada);

  // Sólo las acciones que el pipeline dejaría EJECUTAR son insumo del canary.
  const candidatas = sombra.candidatas;
  const ctx = {
    mandato: entrada.mandato,
    interruptores: entrada.interruptores,
    ahora: entrada.ahora,
    gastoDiario: entrada.gastoDiario,
    gastoMensual: entrada.gastoMensual,
    gastoDiarioPrevio: entrada.gastoDiarioPrevio,
    cambiosUltimaHora: 0,
    cambiosHoy: entrada.cambiosHoy,
    cambiosCampaniaHoy: entrada.cambiosHoy,
    enCooldown: false,
    accionesYaEjecutadas: [] as string[],
  };

  const writeEstado = estadoCapacidadWrite(cred, org, entrada.mandato.externalAccountId, 'ADD_NEGATIVE_KEYWORD_EXACT').estado;

  for (const accion of candidatas) {
    const r = evaluarCandidatoCanary(accion, ctx, entrada.mandato.externalAccountId);
    if (r.estado === 'CANDIDATE') {
      const pre = preMutateCheck({
        candidato: r.candidato,
        accion,
        ctx,
        credWrite: cred,
        autonomousReal: AUTONOMOUS_REAL,
        evidenciaActual: { muestra: accion.evidencia.muestra, mandateVersion: entrada.mandato.version },
      });
      return { candidato: 'CANDIDATE', detalle: r.candidato, writeEstado, autonomousReal: AUTONOMOUS_REAL, puedeMutarHoy: pre.puedeMutar, preMutateRazon: pre.razon };
    }
  }

  return { candidato: 'NONE', motivo: candidatas.length === 0 ? 'NO_ELIGIBLE_ACTION' : 'NO_CANARY_ELIGIBLE_ACTION', writeEstado, autonomousReal: AUTONOMOUS_REAL, puedeMutarHoy: false };
}
