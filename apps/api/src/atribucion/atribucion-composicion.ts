/**
 * apps/api · ATRIBUCIÓN FIRST-PARTY · composición y caso de uso.
 *
 * Aquí se junta lo único que hace falta: el lector de `click_view` de la organización —de SU cuenta, con SU
 * credencial— y la tabla donde vive la relación entre una intención y el clic que la originó.
 *
 * ES UNA LECTURA DE GOOGLE Y UNA ESCRITURA EN SOEC. En Google no se crea, ni se modifica, ni se carga nada:
 * `click_view` es una consulta. Lo que se escribe es una fila en la base de SOEC.
 */
import type { Pool } from 'pg';
import { GoogleSearchError, type GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import { clienteDeAuditoriaDeCuenta, type OpcionesComposicionEjecucion } from '../ejecucion/composicion';
import { atribuirIntencion, gclidValido, type ClicObservado, type ConsultaDeClics } from './atribucion-click';
import { RepositorioAtribucion } from './atribucion-pg';
import type { AtribucionDeIntencion } from './atribucion-tipos';

/**
 * GAQL de `click_view`. Los dos límites de la plataforma están AQUÍ, visibles: un solo día en el `where` y
 * el filtro por el identificador exacto. Google documenta: «Queries including ClickView must have a filter
 * limiting the results to one day and can be requested for dates back to 90 days before the time of the
 * request».
 */
export function consultaDeClicView(gclid: string, fecha: string): string {
  const seguro = gclid.replace(/[^A-Za-z0-9._-]/g, '');
  return `select click_view.gclid, click_view.keyword_info.text, click_view.keyword_info.match_type,
       campaign.id, campaign.name, ad_group.id, ad_group.name, segments.date, segments.device
from click_view
where segments.date = '${fecha}' and click_view.gclid = '${seguro}'`;
}

function mapearClic(fila: Record<string, unknown>): ClicObservado {
  const cv = (fila.clickView ?? {}) as Record<string, unknown>;
  const kw = (cv.keywordInfo ?? {}) as Record<string, unknown>;
  const camp = (fila.campaign ?? {}) as Record<string, unknown>;
  const grupo = (fila.adGroup ?? {}) as Record<string, unknown>;
  const seg = (fila.segments ?? {}) as Record<string, unknown>;
  const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  return {
    gclid: String(cv.gclid ?? ''),
    campaignId: texto(camp.id),
    campaignName: texto(camp.name),
    adGroupId: texto(grupo.id),
    adGroupName: texto(grupo.name),
    keyword: texto(kw.text),
    matchType: texto(kw.matchType),
    device: texto(seg.device),
    fecha: String(seg.date ?? ''),
  };
}

/** Lector de clics de UNA organización. `null` ⇒ no hay cuenta con la que preguntar. */
export function consultaDeClicsDe(cliente: Pick<GoogleAdsMutateHttpClient, 'buscar'>, customerId: string, log?: (i: Record<string, unknown>) => void): ConsultaDeClics {
  return async (gclid: string, fecha: string) => {
    try {
      const filas = await cliente.buscar(customerId, consultaDeClicView(gclid, fecha));
      return filas.map((f) => mapearClic(f));
    } catch (e) {
      // `null` = NO SE PUDO PREGUNTAR. Distinto de una lista vacía, que sí es una respuesta.
      const d = e instanceof GoogleSearchError ? e.detalle : null;
      log?.({ atribucion: 'click_view_fallida', fecha, httpStatus: d?.httpStatus ?? null, codigo: d?.code ?? d?.status ?? null });
      return null;
    }
  };
}

export interface OpcionesAtribucion extends OpcionesComposicionEjecucion {
  readonly ahora?: () => string;
}

export interface IntencionEntrante {
  readonly ref: string;
  readonly gclid: string | null;
  readonly eventTimestamp: string;
}

/**
 * Registra una intención y resuelve su atribución. Idempotente por `(organización, ref)`: si esa intención
 * ya estaba resuelta, se devuelve tal cual y NO se vuelve a preguntar a Google — ni se crea una segunda fila.
 */
export async function atribuirIntencionDeOrganizacion(pool: Pool, org: string, intencion: IntencionEntrante, o: OpcionesAtribucion): Promise<AtribucionDeIntencion> {
  const repo = new RepositorioAtribucion(pool);
  const ahora = (o.ahora ?? (() => new Date().toISOString()))();

  const gclid = gclidValido(intencion.gclid) ? intencion.gclid : null;
  await repo.registrarSiNueva({ organizationId: org, ref: intencion.ref, gclid, eventTimestamp: intencion.eventTimestamp });

  const existente = await repo.obtener(org, intencion.ref);
  // Ya resuelta y con respuesta definitiva: no se vuelve a preguntar. Una atribución no cambia de opinión.
  if (existente !== null && existente.estado !== 'PENDIENTE' && existente.estado !== 'PROVIDER_UNAVAILABLE') return existente;

  const cuenta = await clienteDeAuditoriaDeCuenta(org, o);
  const consulta: ConsultaDeClics = cuenta === null
    ? async () => null // sin cuenta conectada no se puede preguntar: PROVIDER_UNAVAILABLE, no «no encontrado»
    : consultaDeClicsDe(cuenta.cliente, cuenta.customerId, o.log);

  const r = await atribuirIntencion({ gclid, eventTimestamp: intencion.eventTimestamp }, consulta, ahora);
  await repo.resolver(org, intencion.ref, {
    estado: r.estado,
    campaignId: r.clic?.campaignId ?? null,
    campaignName: r.clic?.campaignName ?? null,
    adGroupId: r.clic?.adGroupId ?? null,
    adGroupName: r.clic?.adGroupName ?? null,
    keyword: r.clic?.keyword ?? null,
    matchType: r.clic?.matchType ?? null,
    device: r.clic?.device ?? null,
    clickDate: r.clic?.fecha ?? null,
    error: r.estado === 'PROVIDER_UNAVAILABLE' ? r.motivo : null,
    resueltoEn: ahora,
  });
  o.log?.({ atribucion: 'resuelta', org, estado: r.estado, conGclid: gclid !== null, dias: r.diasConsultados.length });

  return (await repo.obtener(org, intencion.ref))!;
}
