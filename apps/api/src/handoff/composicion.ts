/**
 * apps/api · HANDOFF EXTERNO · composición: de dónde sale el estado real de cada canal.
 *
 * El módulo de handoff no sabe hablar con Google —ni debe—: recibe hechos. Aquí se leen esos hechos con las
 * piezas que ya existen (el ciclo OAuth del proveedor y su descubrimiento de cuentas), sin abrir un segundo
 * camino hacia la API ni duplicar credenciales.
 *
 * Fail-soft a propósito: si no se puede preguntar por las cuentas, se devuelve `null` —«no lo sabemos»— y no
 * cero. La diferencia importa: cero cuentas dispara una tarea de alta de cuenta, y no vamos a pedirle a nadie
 * que cree una cuenta porque nuestra consulta falló.
 */
import { descubrirCuentas, type ComponentesFlujoGoogleAds } from '../acquisition/google-ads-oauth-flow';
import { connectionIdDe } from '../acquisition/google-ads-connection';

export async function estadoGoogleParaHandoff(
  org: string,
  composicion: ComponentesFlujoGoogleAds | null | undefined,
): Promise<{ estadoProveedor: string | null; cuentasAccesibles: number | null } | null> {
  if (!composicion) return null; // este despliegue no tiene Google configurado: no hay nada que sincronizar
  const conexion = await composicion.connRepo.obtener(org, connectionIdDe(org)).catch(() => null);
  const estadoProveedor = conexion?.estado ?? null;

  // Sólo se pregunta por las cuentas cuando tiene sentido: sin autorización válida, la respuesta no
  // significaría nada y además gastaría una llamada al proveedor.
  if (estadoProveedor !== 'ACCOUNT_SELECTION_PENDING' && estadoProveedor !== 'CONNECTED') {
    return { estadoProveedor, cuentasAccesibles: null };
  }
  const r = await descubrirCuentas(composicion, org).catch(() => null);
  return { estadoProveedor, cuentasAccesibles: r !== null && r.ok ? r.cuentas.length : null };
}
