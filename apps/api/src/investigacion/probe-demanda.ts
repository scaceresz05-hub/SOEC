/**
 * apps/api · INVESTIGACIÓN · SONDAS DEL PLANIFICADOR DE PALABRAS (sólo lectura, sin efectos).
 *
 * Existe porque un silencio no se diagnostica adivinando. El planificador de Google devolvió CERO términos
 * para una clínica dental con sitio, ofertas y territorio reales, y hay al menos cinco explicaciones posibles:
 * la geografía es demasiado estrecha, las semillas no sirven, el sitio confunde la consulta, la cuenta no
 * tiene acceso a esos datos, o la petición está mal formada. Cada una se arregla de una forma distinta, y
 * elegir una sin comprobarlo es exactamente el error que ya nos costó tres correcciones.
 *
 * Así que se pregunta lo mismo de varias maneras y se anota qué contestó cada una. Nada de esto persiste ni
 * cambia nada en la cuenta: son consultas de lectura del planificador, las mismas que ya hace la
 * investigación, y se registran SANITIZADAS —modo, geo, idioma, resultado y número de ideas—, nunca tokens ni
 * cuerpos de respuesta.
 */
import type { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import { GoogleSearchError } from '../campana/google-ads-mutate-http';

export type ModoSonda =
  | 'SEMILLAS_SIN_GEO'
  | 'SEMILLAS_PAIS'
  | 'SEMILLAS_REGION'
  | 'SEMILLAS_COMUNAS'
  | 'SOLO_URL'
  | 'SEMILLAS_Y_URL';

export interface ResultadoSonda {
  readonly modo: ModoSonda;
  /** Qué territorio se usó, en lenguaje humano. `null` = ninguno (consulta sin restricción geográfica). */
  readonly geo: string | null;
  readonly geoTargetIds: readonly string[];
  readonly idioma: string;
  readonly conUrl: boolean;
  readonly semillas: number;
  /** `OK` con su número de ideas, o el fallo del proveedor tal cual —código y status—, nunca inventado. */
  readonly resultado: 'OK' | 'ERROR';
  readonly ideas: number | null;
  /** Hasta tres ejemplos, para ver que lo devuelto tiene sentido. Sin métricas: esto no es una medición. */
  readonly ejemplos: readonly string[];
  readonly httpStatus: number | null;
  readonly codigo: string | null;
  readonly mensaje: string | null;
}

export interface EntradaSondas {
  readonly cliente: GoogleAdsMutateHttpClient;
  readonly customerId: string;
  readonly semillas: readonly string[];
  readonly urlSitio: string | null;
  readonly idioma: string;
  readonly pais: string;
  /** Territorios ya resueltos por la plataforma para el negocio (comunas). */
  readonly geoComunas: readonly string[];
  /** Id del país en la plataforma (Chile = 2152). Se resuelve fuera para no fijar constantes aquí. */
  readonly geoPaisId: string | null;
  /** Id de la región, si se pudo resolver. */
  readonly geoRegionId: string | null;
  readonly geoRegionNombre: string | null;
}

const idiomaDe = (idioma: string): string => (idioma.startsWith('es') ? '1003' : '1000');

async function unaSonda(
  e: EntradaSondas,
  modo: ModoSonda,
  opciones: { readonly geo: string | null; readonly geoTargetIds: readonly string[]; readonly conUrl: boolean; readonly conSemillas: boolean },
): Promise<ResultadoSonda> {
  const base = {
    modo,
    geo: opciones.geo,
    geoTargetIds: opciones.geoTargetIds,
    idioma: idiomaDe(e.idioma),
    conUrl: opciones.conUrl,
    semillas: opciones.conSemillas ? e.semillas.length : 0,
  };
  try {
    const ideas = await e.cliente.generarIdeasDePalabras(e.customerId, {
      semillas: opciones.conSemillas ? e.semillas : [],
      url: opciones.conUrl ? e.urlSitio : null,
      geoTargetIds: opciones.geoTargetIds,
      languageId: idiomaDe(e.idioma),
    });
    return {
      ...base,
      resultado: 'OK',
      ideas: ideas.length,
      ejemplos: ideas.slice(0, 3).map((i) => i.texto),
      httpStatus: null,
      codigo: null,
      mensaje: null,
    };
  } catch (err) {
    // El fallo del proveedor se traslada tal cual —su código, su status—; no se traduce a una conclusión.
    const d = err instanceof GoogleSearchError ? err.detalle : null;
    return {
      ...base,
      resultado: 'ERROR',
      ideas: null,
      ejemplos: [],
      httpStatus: d?.httpStatus ?? null,
      codigo: d?.code ?? d?.status ?? null,
      mensaje: d?.message ?? (err instanceof Error ? err.message.slice(0, 160) : null),
    };
  }
}

/**
 * Corre las sondas EN SERIE. En serie a propósito: es la llamada que Google pide consultar con calma, y seis
 * peticiones simultáneas a la misma cuenta son la forma más rápida de que nos limite y de confundir el
 * diagnóstico con un 429 que nos hicimos nosotros.
 */
export async function correrSondasDeDemanda(e: EntradaSondas): Promise<readonly ResultadoSonda[]> {
  const out: ResultadoSonda[] = [];
  const hayUrl = e.urlSitio !== null && e.urlSitio.trim() !== '';

  out.push(await unaSonda(e, 'SEMILLAS_SIN_GEO', { geo: null, geoTargetIds: [], conUrl: false, conSemillas: true }));
  if (e.geoPaisId !== null) {
    out.push(await unaSonda(e, 'SEMILLAS_PAIS', { geo: e.pais, geoTargetIds: [e.geoPaisId], conUrl: false, conSemillas: true }));
  }
  if (e.geoRegionId !== null) {
    out.push(await unaSonda(e, 'SEMILLAS_REGION', { geo: e.geoRegionNombre ?? 'región', geoTargetIds: [e.geoRegionId], conUrl: false, conSemillas: true }));
  }
  if (e.geoComunas.length > 0) {
    out.push(await unaSonda(e, 'SEMILLAS_COMUNAS', { geo: `${e.geoComunas.length} comuna(s)`, geoTargetIds: e.geoComunas, conUrl: false, conSemillas: true }));
  }
  if (hayUrl) {
    out.push(await unaSonda(e, 'SOLO_URL', { geo: null, geoTargetIds: [], conUrl: true, conSemillas: false }));
    out.push(await unaSonda(e, 'SEMILLAS_Y_URL', { geo: null, geoTargetIds: [], conUrl: true, conSemillas: true }));
  }
  return out;
}

export type CausaDelSilencio =
  | 'GEO_DEMASIADO_RESTRICTIVA'
  | 'SITIO_COMO_SEMILLA'
  | 'CUENTA_O_ACCESO'
  | 'NINGUN_SILENCIO'
  | 'DESCONOCIDA';

export interface LecturaDeSondas {
  readonly causa: CausaDelSilencio;
  readonly explicacion: string;
}

/**
 * LEE las sondas. Deliberadamente conservadora: sólo nombra una causa cuando las propias sondas la separan de
 * las demás. Si todas callan por igual, la respuesta es DESCONOCIDA — que es una respuesta, y la honesta.
 */
export function leerSondas(sondas: readonly ResultadoSonda[]): LecturaDeSondas {
  const ok = sondas.filter((s) => s.resultado === 'OK');
  const conIdeas = ok.filter((s) => (s.ideas ?? 0) > 0);
  if (ok.length === 0) {
    const primera = sondas[0];
    return {
      causa: 'CUENTA_O_ACCESO',
      explicacion: `ninguna consulta llegó a responder (${primera?.codigo ?? primera?.httpStatus ?? 'sin código'}): el problema está en la cuenta o en el acceso, no en las palabras`,
    };
  }
  if (conIdeas.length === ok.length) {
    return { causa: 'NINGUN_SILENCIO', explicacion: 'todas las consultas devolvieron términos: no hay silencio que explicar' };
  }
  if (conIdeas.length === 0) {
    return {
      causa: 'CUENTA_O_ACCESO',
      explicacion: 'la cuenta responde correctamente a todas las variantes —con y sin territorio, con y sin sitio— y ninguna trae términos: el planificador no está entregando datos a esta cuenta',
    };
  }
  const sinGeoTrae = conIdeas.some((s) => s.geoTargetIds.length === 0);
  const conComunasCalla = ok.some((s) => s.modo === 'SEMILLAS_COMUNAS' && (s.ideas ?? 0) === 0);
  if (sinGeoTrae && conComunasCalla) {
    return {
      causa: 'GEO_DEMASIADO_RESTRICTIVA',
      explicacion: 'las mismas semillas traen términos sin restricción geográfica y no traen ninguno restringidas a las comunas declaradas: el territorio es demasiado estrecho para que el planificador dé datos',
    };
  }
  const soloUrlCalla = ok.some((s) => s.modo === 'SOLO_URL' && (s.ideas ?? 0) === 0);
  const semillasSolasTraen = conIdeas.some((s) => s.modo === 'SEMILLAS_SIN_GEO');
  if (soloUrlCalla && semillasSolasTraen) {
    return {
      causa: 'SITIO_COMO_SEMILLA',
      explicacion: 'las palabras del negocio sí traen términos y el sitio por sí solo no: el planificador no está sacando nada de esa página',
    };
  }
  return { causa: 'DESCONOCIDA', explicacion: 'las sondas no separan una causa de las otras: hay resultados mezclados y no se puede afirmar cuál manda' };
}
