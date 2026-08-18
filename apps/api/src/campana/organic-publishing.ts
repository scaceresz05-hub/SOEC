/**
 * apps/api · V2-B · ORGANIC PUBLISHING ENGINE (dry-run). Publica contenido ORGÁNICO (costo 0, sin presupuesto)
 * pasando igualmente por el Action Plane (policy → ledger) y el Meta Write Port. El contenido debe pasar la
 * content-policy antes de publicarse. Idempotente por (organizationId, ref). En dry-run: sin escritura real.
 */
import type { DepsActionPlane } from '../accion/action-plane';
import { procesarAccion } from '../accion/action-plane';
import type { AccionPropuesta } from '../accion/budget-guard';
import type { Mandato } from '../accion/mandato';
import { validarContenido } from './content-policy';
import type { PiezaContenido, Placement } from './content-engine';
import type { MetaWritePort, ResultadoEscrituraMeta } from './meta-write-port';

export interface SolicitudPublicacion {
  readonly organizationId: string;
  readonly placement: Placement; // instagram | facebook
  readonly assetId: string; // página/perfil autorizado en el mandato
  readonly ref: string; // id estable de la publicación (para idempotencia)
  readonly pieza: PiezaContenido;
  readonly historia?: boolean; // true ⇒ story
}

export interface ResultadoPublicacion {
  readonly organizationId: string;
  readonly estado: 'SIMULADA' | 'EJECUTADA' | 'RECHAZADA' | 'BLOQUEADA_CONTENIDO';
  readonly externalRef: string | null;
  readonly bloqueos: readonly string[];
  readonly modo: 'DRY_RUN' | 'REAL';
  readonly metaWriteCallsReales: number;
}

export async function publicarOrganico(
  deps: DepsActionPlane,
  port: MetaWritePort,
  mandato: Mandato,
  s: SolicitudPublicacion,
): Promise<ResultadoPublicacion> {
  const modo = deps.autonomousReal ? 'REAL' : 'DRY_RUN';
  // 1) Content-policy ANTES de tocar el Action Plane.
  const c = validarContenido({ organizationId: s.organizationId, textos: [s.pieza.headline, s.pieza.primaryText, s.pieza.description, s.pieza.cta] }, s.organizationId);
  if (!c.permitido) {
    return { organizationId: s.organizationId, estado: 'BLOQUEADA_CONTENIDO', externalRef: null, bloqueos: c.violaciones.map((v) => v.tipo), modo, metaWriteCallsReales: 0 };
  }

  const accion: AccionPropuesta = {
    organizationId: s.organizationId,
    mandatoId: mandato.id,
    idempotencyKey: `organic:${s.placement}:${s.ref}`,
    actionType: s.historia ? 'PUBLISH_STORY' : 'PUBLISH_POST',
    assetId: s.assetId,
    costMinor: 0, // orgánico: nunca consume presupuesto
    currency: mandato.currency,
    propuestaPor: 'director',
  };

  const r = await procesarAccion(deps, mandato, accion);
  if (!r.veredicto.permitido) {
    return { organizationId: s.organizationId, estado: 'RECHAZADA', externalRef: null, bloqueos: r.veredicto.bloqueos, modo, metaWriteCallsReales: 0 };
  }

  const escritura: ResultadoEscrituraMeta = await port.ejecutar({
    operacion: s.placement === 'instagram' ? 'PUBLISH_INSTAGRAM' : 'PUBLISH_FACEBOOK',
    organizationId: s.organizationId,
    assetId: s.assetId,
    idempotencyKey: accion.idempotencyKey,
    payload: { headline: s.pieza.headline, primaryText: s.pieza.primaryText, historia: s.historia === true },
  });
  const metaWriteCallsReales = port.esReal && escritura.ok ? 1 : 0;
  const estado = r.veredicto.modo === 'REAL' && escritura.ok ? 'EJECUTADA' : 'SIMULADA';
  return { organizationId: s.organizationId, estado, externalRef: escritura.externalRef, bloqueos: [], modo, metaWriteCallsReales };
}
