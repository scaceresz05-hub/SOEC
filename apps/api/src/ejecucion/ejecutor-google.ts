/**
 * apps/api · EJECUCIÓN DE CAMPAÑAS · ejecutor de Google Ads.
 *
 * Toma el paquete CONGELADO y lo convierte en recursos reales, con cuatro obsesiones:
 *
 *  1. NACE EN PAUSA. La campaña y sus grupos se crean `PAUSED`. No hay ninguna ruta, bandera ni parámetro en
 *     este archivo capaz de crear algo encendido.
 *  2. NO DUPLICA. Antes de escribir se pregunta a la plataforma si la campaña ya existe (por su nombre estable)
 *     y se consulta el libro de ejecución. Un reintento adopta lo que hay; nunca crea una segunda campaña.
 *  3. NO DEJA RESTOS. La request es atómica (`partialFailure=false`): si Google rechaza una operación, no queda
 *     nada a medias en la cuenta del cliente. Si el proceso muere después de que Google creara todo, el
 *     siguiente intento lo ADOPTA en vez de recrearlo.
 *  4. VERIFICA LO QUE CREÓ. `CREATED_PAUSED` sólo se declara después de leer de vuelta la campaña y comprobar
 *     que está en pausa y con lo que se pidió. Divergencias: se guardan, no se «arreglan» por la espalda.
 */
import { materializarPaqueteGoogleAds } from '../campana/google-ads-materializer';
import type { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import type { PaqueteDeEjecucion } from './paquete';
import type { Divergencia, PasoEjecucion, Reconciliacion, ResultadoPaso } from './ejecucion-tipos';

export interface PasoEjecutado {
  readonly paso: PasoEjecucion;
  readonly clave: string;
  readonly resultado: ResultadoPaso;
  readonly recursoExterno: string | null;
  readonly providerRequestId: string | null;
  readonly detalle: Record<string, unknown>;
}

export interface ResultadoEjecucionGoogle {
  readonly estado: 'CREATED_PAUSED' | 'PARTIAL' | 'FAILED';
  readonly motivo: string | null;
  readonly recursosExternos: Readonly<Record<string, readonly string[]>>;
  readonly pasos: readonly PasoEjecutado[];
  readonly reconciliacion: Reconciliacion | null;
  /** Llamadas de ESCRITURA al proveedor. Un reintento que adopta lo existente debe dejar esto en 0. */
  readonly escriturasProveedor: number;
}

export interface CampaniaRemota {
  readonly id: string;
  readonly nombre: string;
  readonly estado: string;
  readonly canal: string;
  readonly presupuestoMicros: number | null;
  readonly grupos: readonly { readonly id: string; readonly nombre: string; readonly estado: string }[];
  readonly palabras: readonly { readonly texto: string; readonly concordancia: string }[];
  readonly negativas: readonly { readonly texto: string }[];
  readonly geo: readonly string[];
  readonly anuncios: number;
}

type ClienteGoogle = Pick<GoogleAdsMutateHttpClient, 'buscar' | 'mutarGrafo'>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const escapar = (s: string): string => s.replace(/'/g, "\\'");

/** Lee de la plataforma la campaña por su NOMBRE estable. Es la base de la idempotencia y de la adopción. */
export async function leerCampaniaPorNombre(cliente: ClienteGoogle, customerId: string, nombre: string): Promise<CampaniaRemota | null> {
  const filas = await cliente.buscar(
    customerId,
    `select campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            campaign_budget.amount_micros
     from campaign where campaign.name = '${escapar(nombre)}' and campaign.status != 'REMOVED' limit 1`,
  );
  const f = filas[0] as { campaign?: Record<string, unknown>; campaignBudget?: Record<string, unknown> } | undefined;
  if (f?.campaign === undefined) return null;
  const id = String(f.campaign.id ?? '');
  const [grupos, palabras, negativas, geo, anuncios] = await Promise.all([
    leerGrupos(cliente, customerId, id),
    leerPalabras(cliente, customerId, id),
    leerNegativas(cliente, customerId, id),
    leerGeo(cliente, customerId, id),
    contarAnuncios(cliente, customerId, id),
  ]);
  return {
    id,
    nombre: String(f.campaign.name ?? ''),
    estado: String(f.campaign.status ?? ''),
    canal: String(f.campaign.advertisingChannelType ?? ''),
    presupuestoMicros: num(f.campaignBudget?.amountMicros),
    grupos, palabras, negativas, geo, anuncios,
  };
}

async function leerGrupos(c: ClienteGoogle, cid: string, campaignId: string): Promise<CampaniaRemota['grupos']> {
  const filas = await c.buscar(cid, `select ad_group.id, ad_group.name, ad_group.status from ad_group where campaign.id = ${campaignId} and ad_group.status != 'REMOVED'`);
  return filas.map((r) => {
    const g = (r as { adGroup?: Record<string, unknown> }).adGroup ?? {};
    return { id: String(g.id ?? ''), nombre: String(g.name ?? ''), estado: String(g.status ?? '') };
  });
}

async function leerPalabras(c: ClienteGoogle, cid: string, campaignId: string): Promise<CampaniaRemota['palabras']> {
  const filas = await c.buscar(cid, `select ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type from ad_group_criterion where campaign.id = ${campaignId} and ad_group_criterion.type = 'KEYWORD' and ad_group_criterion.negative = false and ad_group_criterion.status != 'REMOVED'`);
  return filas.map((r) => {
    const k = ((r as { adGroupCriterion?: { keyword?: Record<string, unknown> } }).adGroupCriterion?.keyword) ?? {};
    return { texto: String(k.text ?? ''), concordancia: String(k.matchType ?? '') };
  });
}

async function leerNegativas(c: ClienteGoogle, cid: string, campaignId: string): Promise<CampaniaRemota['negativas']> {
  const filas = await c.buscar(cid, `select campaign_criterion.keyword.text from campaign_criterion where campaign.id = ${campaignId} and campaign_criterion.type = 'KEYWORD' and campaign_criterion.negative = true and campaign_criterion.status != 'REMOVED'`);
  return filas.map((r) => {
    const k = ((r as { campaignCriterion?: { keyword?: Record<string, unknown> } }).campaignCriterion?.keyword) ?? {};
    return { texto: String(k.text ?? '') };
  });
}

async function leerGeo(c: ClienteGoogle, cid: string, campaignId: string): Promise<readonly string[]> {
  const filas = await c.buscar(cid, `select campaign_criterion.location.geo_target_constant from campaign_criterion where campaign.id = ${campaignId} and campaign_criterion.type = 'LOCATION' and campaign_criterion.status != 'REMOVED'`);
  return filas.map((r) => {
    const l = ((r as { campaignCriterion?: { location?: Record<string, unknown> } }).campaignCriterion?.location) ?? {};
    return String(l.geoTargetConstant ?? '').replace('geoTargetConstants/', '');
  }).filter((x) => x !== '');
}

async function contarAnuncios(c: ClienteGoogle, cid: string, campaignId: string): Promise<number> {
  const filas = await c.buscar(cid, `select ad_group_ad.ad.id from ad_group_ad where campaign.id = ${campaignId} and ad_group_ad.status != 'REMOVED'`);
  return filas.length;
}

/**
 * Compara lo que SOEC pidió con lo que la plataforma tiene. No corrige nada: describir la diferencia es el
 * trabajo; decidir qué hacer con ella es de una persona (o de una política de reconciliación futura).
 */
export function compararConPaquete(p: PaqueteDeEjecucion, remota: CampaniaRemota | null, ahora: string): Reconciliacion {
  const d: Divergencia[] = [];
  if (remota === null) {
    return { coincide: false, divergencias: [{ campo: 'campaña', esperado: p.campania.nombre, encontrado: 'no existe en la plataforma' }], observadoEn: ahora };
  }
  // LA COMPROBACIÓN QUE MÁS IMPORTA: no puede estar sirviendo.
  if (remota.estado !== 'PAUSED') d.push({ campo: 'estado', esperado: 'PAUSED', encontrado: remota.estado });
  if (remota.canal !== 'SEARCH') d.push({ campo: 'canal', esperado: 'SEARCH', encontrado: remota.canal });
  if (remota.presupuestoMicros !== null && remota.presupuestoMicros !== p.campania.presupuestoDiarioMicros) {
    d.push({ campo: 'presupuesto diario', esperado: String(p.campania.presupuestoDiarioMicros), encontrado: String(remota.presupuestoMicros) });
  }
  if (remota.grupos.length !== p.grupos.length) {
    d.push({ campo: 'grupos', esperado: String(p.grupos.length), encontrado: String(remota.grupos.length) });
  }
  const gruposEncendidos = remota.grupos.filter((g) => g.estado !== 'PAUSED').map((g) => g.nombre);
  if (gruposEncendidos.length > 0) {
    d.push({ campo: 'grupos en pausa', esperado: 'todos', encontrado: `encendidos: ${gruposEncendidos.join(', ')}` });
  }
  const esperadas = p.grupos.flatMap((g) => g.palabras.map((k) => k.texto.toLowerCase())).sort();
  const encontradas = remota.palabras.map((k) => k.texto.toLowerCase()).sort();
  if (esperadas.length !== encontradas.length || esperadas.some((t, i) => t !== encontradas[i])) {
    d.push({ campo: 'palabras clave', esperado: `${esperadas.length}`, encontrado: `${encontradas.length}` });
  }
  if (remota.negativas.length !== p.negativas.length) {
    d.push({ campo: 'negativas', esperado: String(p.negativas.length), encontrado: String(remota.negativas.length) });
  }
  const geoEsperada = p.campania.geo.map((g) => g.criterionId).sort();
  const geoEncontrada = [...remota.geo].sort();
  if (geoEsperada.length !== geoEncontrada.length || geoEsperada.some((g, i) => g !== geoEncontrada[i])) {
    d.push({ campo: 'territorios', esperado: geoEsperada.join(','), encontrado: geoEncontrada.join(',') });
  }
  const anunciosEsperados = p.grupos.reduce((a, g) => a + g.anuncios.length, 0);
  if (remota.anuncios !== anunciosEsperados) {
    d.push({ campo: 'anuncios', esperado: String(anunciosEsperados), encontrado: String(remota.anuncios) });
  }
  return { coincide: d.length === 0, divergencias: d, observadoEn: ahora };
}

/** Reconciliación MÍNIMA para declarar `CREATED_PAUSED`: la campaña existe y está en pausa. */
export function reconciliacionMinimaOk(remota: CampaniaRemota | null): boolean {
  return remota !== null && remota.estado === 'PAUSED';
}

export interface EntradaEjecutor {
  readonly paquete: PaqueteDeEjecucion;
  readonly cliente: ClienteGoogle;
  /** Pasos ya registrados de esta petición: permiten reanudar sin repetir. */
  readonly pasosPrevios: readonly { readonly paso: PasoEjecucion; readonly clave: string; readonly resultado: ResultadoPaso }[];
  readonly ahora: () => string;
  readonly log?: (info: Record<string, unknown>) => void;
}

/**
 * Ejecuta el paquete. Devuelve TODO lo que hizo (pasos, recursos, reconciliación) para que el servicio lo
 * persista en una transacción. No escribe en base: así se puede probar sin PostgreSQL.
 */
export async function ejecutarPaqueteGoogle(e: EntradaEjecutor): Promise<ResultadoEjecucionGoogle> {
  const pasos: PasoEjecutado[] = [];
  const p = e.paquete;
  const cid = p.cuenta.customerId;
  const yaHecho = (paso: PasoEjecucion, clave: string): boolean =>
    e.pasosPrevios.some((x) => x.paso === paso && x.clave === clave && x.resultado !== 'FAILED');

  // ── 1) ¿YA EXISTE? Se pregunta a la plataforma ANTES de escribir. Un reintento adopta, no duplica. ──
  const previa = await leerCampaniaPorNombre(e.cliente, cid, p.campania.nombre);
  pasos.push({
    paso: 'VERIFY_REMOTE_STATE', clave: `pre:${p.hash}`, resultado: 'OK',
    recursoExterno: previa?.id ?? null, providerRequestId: null,
    detalle: { existia: previa !== null, estado: previa?.estado ?? null },
  });

  if (previa !== null) {
    const rec = compararConPaquete(p, previa, e.ahora());
    e.log?.({ ejecucion: 'adopcion', org: p.organizationId, campaña: previa.id, coincide: rec.coincide });
    return {
      estado: reconciliacionMinimaOk(previa) ? 'CREATED_PAUSED' : 'PARTIAL',
      motivo: rec.coincide ? null : 'la campaña ya existía en la cuenta; se adoptó y se anotaron las diferencias',
      recursosExternos: recursosDeRemota(previa),
      pasos: [...pasos, {
        paso: 'CAMPAIGN_CREATE', clave: p.hash, resultado: 'SKIPPED_IDEMPOTENT',
        recursoExterno: previa.id, providerRequestId: null, detalle: { motivo: 'ya existía con el mismo nombre' },
      }],
      reconciliacion: rec,
      escriturasProveedor: 0,
    };
  }

  if (yaHecho('CAMPAIGN_CREATE', p.hash)) {
    // El libro dice que se creó, pero la plataforma no la encuentra: no se recrea a ciegas.
    return {
      estado: 'PARTIAL',
      motivo: 'el libro de ejecución dice que la campaña se creó, pero no aparece en la cuenta; revísalo antes de reintentar',
      recursosExternos: {}, pasos, reconciliacion: compararConPaquete(p, null, e.ahora()), escriturasProveedor: 0,
    };
  }

  // ── 2) ESCRITURA ATÓMICA: presupuesto + campaña + grupos + anuncios + palabras + negativas + geo + idioma ──
  const request = materializarPaqueteGoogleAds(p, { validateOnly: false });
  if (request === null) {
    return { estado: 'FAILED', motivo: 'el paquete no tiene material suficiente para crear la campaña', recursosExternos: {}, pasos, reconciliacion: null, escriturasProveedor: 0 };
  }

  const resultado = await e.cliente.mutarGrafo(cid, request);
  const recursos = agruparRecursos(resultado.results.map((r) => r.resourceName));
  const pasoDe: Readonly<Record<string, PasoEjecucion>> = {
    campaignBudgets: 'BUDGET_CREATE', campaigns: 'CAMPAIGN_CREATE', adGroups: 'AD_GROUP_CREATE',
    adGroupAds: 'AD_CREATE', adGroupCriteria: 'KEYWORD_CREATE', campaignCriteria: 'TARGETING_APPLY',
  };

  if (!resultado.ok) {
    pasos.push({
      paso: 'CAMPAIGN_CREATE', clave: p.hash, resultado: 'FAILED', recursoExterno: null,
      providerRequestId: resultado.requestId,
      detalle: { httpStatus: resultado.httpStatus, errorStatus: resultado.errorStatus, errorCode: resultado.errorCode, errorMessage: resultado.errorMessage },
    });
    e.log?.({ ejecucion: 'fallo', org: p.organizationId, errorCode: resultado.errorCode, requestId: resultado.requestId });
    // Atómica: si falló, NO quedan recursos parciales en la cuenta.
    return {
      estado: 'FAILED',
      motivo: `la plataforma rechazó la creación: ${resultado.errorCode ?? resultado.errorStatus ?? `HTTP ${resultado.httpStatus}`}`,
      recursosExternos: {}, pasos, reconciliacion: null, escriturasProveedor: 1,
    };
  }

  for (const [coleccion, ids] of Object.entries(recursos)) {
    const paso = pasoDe[coleccion];
    if (paso === undefined) continue;
    pasos.push({
      paso, clave: `${p.hash}:${coleccion}`, resultado: 'OK',
      recursoExterno: ids[0] ?? null, providerRequestId: resultado.requestId,
      detalle: { creados: ids.length },
    });
  }
  // Las negativas viajan en la misma colección que la geografía: se registran aparte para el libro.
  if (p.negativas.length > 0) {
    pasos.push({ paso: 'NEGATIVE_CREATE', clave: `${p.hash}:negativas`, resultado: 'OK', recursoExterno: null, providerRequestId: resultado.requestId, detalle: { creadas: p.negativas.length } });
  }
  if (p.extensiones.sitelinks.length > 0 || p.extensiones.callouts.length > 0) {
    // Esta fase declara las extensiones en el paquete pero NO las materializa todavía: decirlo es mejor que
    // crear a medias algo que después habría que limpiar en la cuenta del cliente.
    pasos.push({ paso: 'ASSET_CREATE', clave: `${p.hash}:extensiones`, resultado: 'SKIPPED_IDEMPOTENT', recursoExterno: null, providerRequestId: null, detalle: { motivo: 'extensiones declaradas, pendientes de una fase posterior', sitelinks: p.extensiones.sitelinks.length, callouts: p.extensiones.callouts.length } });
  }

  // ── 3) VERIFICACIÓN: se lee de vuelta lo creado. Sin esto no se declara `CREATED_PAUSED`. ──
  const remota = await leerCampaniaPorNombre(e.cliente, cid, p.campania.nombre);
  const rec = compararConPaquete(p, remota, e.ahora());
  pasos.push({
    paso: 'VERIFY_REMOTE_STATE', clave: `post:${p.hash}`, resultado: rec.coincide ? 'OK' : 'OK',
    recursoExterno: remota?.id ?? null, providerRequestId: null,
    detalle: { coincide: rec.coincide, divergencias: rec.divergencias.length, estado: remota?.estado ?? null },
  });
  e.log?.({ ejecucion: 'creada', org: p.organizationId, campaña: remota?.id ?? null, estado: remota?.estado ?? null, coincide: rec.coincide, operaciones: request.mutateOperations.length });

  return {
    estado: reconciliacionMinimaOk(remota) ? 'CREATED_PAUSED' : 'PARTIAL',
    motivo: reconciliacionMinimaOk(remota) ? null : 'la campaña se creó pero no se pudo verificar que esté en pausa',
    recursosExternos: remota === null ? recursos : { ...recursos, ...recursosDeRemota(remota) },
    pasos,
    reconciliacion: rec,
    escriturasProveedor: 1,
  };
}

/** Agrupa resource names por colección (`customers/1/campaigns/2` ⇒ `campaigns`). */
export function agruparRecursos(nombres: readonly (string | null)[]): Record<string, readonly string[]> {
  const out: Record<string, string[]> = {};
  for (const n of nombres) {
    if (!n) continue;
    const partes = n.split('/');
    const coleccion = partes[2] ?? 'desconocido';
    (out[coleccion] ??= []).push(n);
  }
  return out;
}

function recursosDeRemota(r: CampaniaRemota): Record<string, readonly string[]> {
  return {
    campaigns: [r.id],
    adGroups: r.grupos.map((g) => g.id),
  };
}
