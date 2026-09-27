/**
 * apps/api · MEDICIÓN · AUDITORÍA DE PREPARACIÓN (sólo lectura, sin efectos).
 *
 * Antes de crear nada en la cuenta de un cliente hay que saber qué hay. Este módulo mira tres cosas y las
 * mantiene SEPARADAS, porque confundirlas es cómo se acaba con una campaña gastando sin medir:
 *
 *   1. QUÉ EXISTE EN LA PLATAFORMA — las acciones de conversión de la cuenta, con su estado y su tipo.
 *   2. QUÉ EMITE EL SITIO — si SOEC ha observado de verdad el evento que el negocio declaró como resultado.
 *   3. QUÉ NO SE PUDO COMPROBAR — que no es lo mismo que «no hay».
 *
 * LA REGLA QUE MÁS IMPORTA: una consulta que falla NO produce `ACTION_MISSING`. Si Google no contestó, el
 * diagnóstico es `PROVIDER_UNOBSERVABLE` y se dice el código del fallo. Ya hemos cometido tres veces el error
 * de leer un silencio como una medición —una lista vacía de programas de verificación, un `billing_setup`
 * aprobado, un planificador sin términos—, y cada una costó una corrección en producción.
 *
 * NADA DE LO QUE HAY AQUÍ ESCRIBE. Ni en Google, ni en el sitio, ni en la base: es una lectura.
 */
import { GoogleSearchError, type GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import type { EstadoMedicion } from './ejecucion-tipos';

/**
 * ── UNA CONVERSIÓN POR INTENCIÓN: EL SSOT PUBLICITARIO ──
 *
 * Un clic de WhatsApp es UN hecho. Puede llegar a Google Ads por varios caminos a la vez —la etiqueta en el
 * sitio, una importación desde GA4, un contenedor de Tag Manager que dispare lo mismo— y entonces la cuenta
 * registra dos o tres conversiones por una sola persona. Eso no es un detalle de informe: es la cifra con la
 * que el sistema decide cuánto pujar, así que duplicarla hace pujar de más con dinero de alguien.
 *
 * La regla es que EXACTAMENTE UN camino puede ser la fuente de la conversión publicitaria. Los demás pueden
 * medir para uso interno, pero no alimentar la acción de conversión de la cuenta.
 */
export type CaminoDeMedicion = 'GOOGLE_ADS_TAG' | 'GA4_IMPORT' | 'GTM' | 'CP_GROWTH_INTERNO' | 'OFFLINE_IMPORT';

/** Caminos que ALIMENTAN la conversión publicitaria. `CP_GROWTH_INTERNO` no: mide para SOEC, no para Google. */
const CAMINOS_QUE_ALIMENTAN_GOOGLE: readonly CaminoDeMedicion[] = ['GOOGLE_ADS_TAG', 'GA4_IMPORT', 'GTM', 'OFFLINE_IMPORT'];

export interface RiesgoDeDuplicacion {
  readonly riesgo: 'NONE' | 'LOW' | 'HIGH';
  readonly fuentesQueAlimentanGoogle: readonly CaminoDeMedicion[];
  readonly explicacion: string;
}

/**
 * Calcula el riesgo de contar dos veces la misma intención. Determinista y sin red: es una regla de diseño,
 * no una observación. `LOW` existe para un caso concreto —no hay ningún camino activo todavía—, porque el
 * riesgo aparece al instalar el segundo, no al no tener ninguno.
 */
export function riesgoDeDuplicacion(caminosActivos: readonly CaminoDeMedicion[]): RiesgoDeDuplicacion {
  const alimentan = [...new Set(caminosActivos)].filter((c) => CAMINOS_QUE_ALIMENTAN_GOOGLE.includes(c));
  if (alimentan.length > 1) {
    return {
      riesgo: 'HIGH',
      fuentesQueAlimentanGoogle: alimentan,
      explicacion: `hay ${alimentan.length} caminos alimentando la misma conversión (${alimentan.join(', ')}): un clic se contaría ${alimentan.length} veces`,
    };
  }
  if (alimentan.length === 1) {
    return {
      riesgo: 'NONE',
      fuentesQueAlimentanGoogle: alimentan,
      explicacion: `un solo camino alimenta la conversión publicitaria (${alimentan[0]}): una intención, una conversión`,
    };
  }
  return {
    riesgo: 'LOW',
    fuentesQueAlimentanGoogle: [],
    explicacion: 'todavía no hay ningún camino que alimente la conversión publicitaria: el riesgo aparecerá al instalar el segundo, no el primero',
  };
}

/** Una acción de conversión tal como la declara la plataforma. Sin interpretar: lo que dice, como lo dice. */
export interface AccionDeConversionObservada {
  readonly id: string;
  readonly nombre: string;
  readonly estado: string;
  readonly tipo: string;
  readonly categoria: string;
  readonly origen: string;
  readonly conteo: string;
  readonly ventanaClicDias: number | null;
  /** `primary_for_goal`: si la acción cuenta para el objetivo de las campañas. Observable desde v13. */
  readonly primaria: boolean | null;
  /** ¿La plataforma entrega una etiqueta instalable (`AW-…/…`)? Es lo que el sitio necesitaría. */
  readonly etiquetaDisponible: boolean;
  /** Última conversión registrada por la plataforma, si la declara. `null` ⇒ no la declara o nunca hubo. */
  readonly conversionesUltimos30: number | null;
}

export type CausaSinMedicion =
  | 'PROVIDER_UNOBSERVABLE'
  | 'CONVERSION_ACTION_MISSING'
  | 'TAG_MISSING'
  | 'SITE_EVENT_MISSING'
  | 'READY_FOR_INSTALL'
  | 'READY';

export interface AuditoriaDeMedicion {
  readonly organizationId: string;
  readonly customerId: string | null;
  /** Evento que el negocio declaró como resultado. `null` ⇒ no declaró ninguno. */
  readonly eventoDeclarado: string | null;
  readonly acciones: readonly AccionDeConversionObservada[];
  /** La acción que corresponde al evento declarado, si ya existe con el nombre estable de SOEC. */
  readonly accionRelevante: AccionDeConversionObservada | null;
  /** Eventos del sitio observados por SOEC para ese evento. */
  readonly eventosDelSitio: { readonly observados: number; readonly desde: string | null };
  readonly estado: EstadoMedicion;
  readonly causa: CausaSinMedicion;
  readonly explicacion: string;
  /** Fallo del proveedor, sanitizado, cuando la consulta no se pudo hacer. */
  readonly fallo: { readonly httpStatus: number | null; readonly codigo: string | null; readonly mensaje: string | null } | null;
  /** Qué habría que crear o instalar, dicho como una lista de actos concretos. */
  readonly loQueFalta: readonly string[];
}

export interface DepsAuditoriaMedicion {
  /** Cliente de LECTURA de la cuenta. `null` ⇒ no hay con qué consultar (y se dice, no se supone). */
  readonly cliente: Pick<GoogleAdsMutateHttpClient, 'buscar'> | null;
  readonly customerId: string | null;
  readonly eventoDeclarado: string | null;
  readonly nombreEstableEsperado: string | null;
  readonly observarEventosDelSitio: () => Promise<{ observados: number; desde: string | null }>;
}

/**
 * GAQL de sólo lectura. Se piden los campos que describen la acción y su comportamiento —no métricas de
 * rendimiento—, porque lo que se está auditando es si la medición EXISTE, no si va bien.
 */
const CONSULTA = `select conversion_action.id, conversion_action.name, conversion_action.status,
       conversion_action.type, conversion_action.category, conversion_action.origin,
       conversion_action.counting_type, conversion_action.primary_for_goal,
       conversion_action.click_through_lookback_window_days, conversion_action.tag_snippets
from conversion_action
where conversion_action.status != 'REMOVED'`;

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function mapear(fila: Record<string, unknown>): AccionDeConversionObservada {
  const ca = (fila.conversionAction ?? {}) as Record<string, unknown>;
  const snippets = (ca.tagSnippets ?? []) as Array<{ eventSnippet?: string; globalSiteTag?: string }>;
  const juntos = snippets.map((s) => `${s.eventSnippet ?? ''}\n${s.globalSiteTag ?? ''}`).join('\n');
  return {
    id: texto(ca.id),
    nombre: texto(ca.name),
    estado: texto(ca.status),
    tipo: texto(ca.type),
    categoria: texto(ca.category),
    origen: texto(ca.origin),
    conteo: texto(ca.countingType),
    ventanaClicDias: ca.clickThroughLookbackWindowDays === undefined ? null : Number(ca.clickThroughLookbackWindowDays),
    // `primary_for_goal` puede no venir; ausente ⇒ no se sabe, y se dice `null` en vez de suponer `false`.
    primaria: ca.primaryForGoal === undefined ? null : ca.primaryForGoal === true,
    etiquetaDisponible: /AW-\d+\/[\w-]+/.test(juntos),
    conversionesUltimos30: null,
  };
}

/**
 * Audita la medición de una organización. Nunca lanza: un fallo del proveedor es parte del diagnóstico, y
 * dejar caer la petición convertiría «no pude preguntar» en un error genérico que nadie sabe leer.
 */
export async function auditarMedicion(org: string, deps: DepsAuditoriaMedicion): Promise<AuditoriaDeMedicion> {
  const eventosDelSitio = await deps.observarEventosDelSitio().catch(() => ({ observados: 0, desde: null }));
  const base = {
    organizationId: org,
    customerId: deps.customerId,
    eventoDeclarado: deps.eventoDeclarado,
    eventosDelSitio,
  };

  if (deps.cliente === null || deps.customerId === null) {
    return {
      ...base,
      acciones: [],
      accionRelevante: null,
      estado: 'ACTION_MISSING',
      causa: 'PROVIDER_UNOBSERVABLE',
      explicacion: 'no hay una cuenta de publicidad conectada con la que consultar: no se sabe qué conversiones existen',
      fallo: null,
      loQueFalta: ['conectar la cuenta de publicidad del negocio'],
    };
  }

  let acciones: readonly AccionDeConversionObservada[];
  try {
    const filas = await deps.cliente.buscar(deps.customerId, CONSULTA);
    acciones = filas.map((f) => mapear(f));
  } catch (e) {
    const d = e instanceof GoogleSearchError ? e.detalle : null;
    return {
      ...base,
      acciones: [],
      accionRelevante: null,
      // NO es ACTION_MISSING: no se preguntó con éxito. Cero por fallo no es cero por ausencia.
      estado: 'ACTION_MISSING',
      causa: 'PROVIDER_UNOBSERVABLE',
      explicacion: 'la plataforma no respondió a la consulta de conversiones: no se puede afirmar que no existan',
      fallo: {
        httpStatus: d?.httpStatus ?? null,
        codigo: d?.code ?? d?.status ?? null,
        mensaje: d?.message ?? (e instanceof Error ? e.message.slice(0, 160) : null),
      },
      loQueFalta: ['volver a consultar la plataforma: hoy no se pudo comprobar qué conversiones existen'],
    };
  }

  const relevante = deps.nombreEstableEsperado === null
    ? null
    : acciones.find((a) => a.nombre === deps.nombreEstableEsperado) ?? null;

  const hayEventoDelSitio = eventosDelSitio.observados > 0;
  const loQueFalta: string[] = [];

  if (deps.eventoDeclarado === null) {
    return {
      ...base, acciones, accionRelevante: relevante,
      estado: 'ACTION_MISSING', causa: 'CONVERSION_ACTION_MISSING',
      explicacion: 'el negocio no declaró qué acción de un cliente cuenta como resultado',
      fallo: null,
      loQueFalta: ['declarar qué acción de un cliente cuenta como resultado'],
    };
  }

  if (relevante === null) {
    if (!hayEventoDelSitio) loQueFalta.push(`comprobar que el sitio emite «${deps.eventoDeclarado}»`);
    loQueFalta.push('crear en la plataforma la acción de conversión del evento declarado');
    loQueFalta.push('instalar en el sitio la etiqueta que dispara esa acción');
    return {
      ...base, acciones, accionRelevante: null,
      estado: 'ACTION_MISSING',
      // El sitio ya emite el evento: lo que falta es el otro lado. Distinguirlo cambia qué hay que hacer.
      causa: hayEventoDelSitio ? 'CONVERSION_ACTION_MISSING' : 'SITE_EVENT_MISSING',
      explicacion: hayEventoDelSitio
        ? `el sitio ya emite «${deps.eventoDeclarado}» (${eventosDelSitio.observados} observados) pero la plataforma no tiene todavía una acción de conversión para él`
        : `no hay acción de conversión en la plataforma y SOEC tampoco ha observado el evento «${deps.eventoDeclarado}» del sitio`,
      fallo: null,
      loQueFalta,
    };
  }

  if (!relevante.etiquetaDisponible) {
    return {
      ...base, acciones, accionRelevante: relevante,
      estado: 'TRACKING_MISSING', causa: 'TAG_MISSING',
      explicacion: 'la acción existe en la plataforma pero no entrega una etiqueta instalable: sin ella el sitio no puede dispararla',
      fallo: null,
      loQueFalta: ['obtener de la plataforma la etiqueta de la acción e instalarla en el sitio'],
    };
  }

  if (!hayEventoDelSitio) {
    return {
      ...base, acciones, accionRelevante: relevante,
      estado: 'TRACKING_MISSING', causa: 'READY_FOR_INSTALL',
      explicacion: `la acción existe y tiene etiqueta; falta que el sitio dispare «${deps.eventoDeclarado}» y que se observe al menos una vez`,
      fallo: null,
      loQueFalta: ['instalar la etiqueta en el sitio', 'comprobar con una interacción real que llega'],
    };
  }

  return {
    ...base, acciones, accionRelevante: relevante,
    estado: 'TRACKING_INSTALLED', causa: 'READY',
    explicacion: `la acción existe con etiqueta y el sitio emite «${deps.eventoDeclarado}» (${eventosDelSitio.observados} observados): queda confirmar que la plataforma registra la conversión`,
    fallo: null,
    loQueFalta: ['confirmar en la plataforma que la conversión se registró al menos una vez'],
  };
}
