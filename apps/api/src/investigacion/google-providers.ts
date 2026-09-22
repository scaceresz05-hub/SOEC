/**
 * apps/api · INVESTIGACIÓN AUTÓNOMA · proveedores sobre Google Ads (SÓLO LECTURA).
 *
 * Dos capacidades, ambas de consulta: ideas de palabras con métricas históricas
 * (`KeywordPlanIdeaService`) y resolución de territorios reales (`GeoTargetConstantService`). Ninguna crea un
 * plan, una campaña, un presupuesto ni una conversión: son preguntas, no cambios.
 *
 * GOBIERNO DE CUOTA — la lección del 429 se aplica aquí desde el primer día:
 *   · SINGLE-FLIGHT por organización y por consulta: dos pantallas abiertas no producen dos llamadas;
 *   · CACHÉ en memoria con vida corta: abrir la pantalla de investigación no vuelve a consultar Google;
 *   · la investigación se lanza SÓLO cuando alguien la pide o cuando la anterior está vieja, nunca en cada render.
 *
 * FAIL-SOFT DECLARADO: si no hay conexión, si falta capacidad de lectura o si Google responde un error, el
 * proveedor devuelve `null` y la corrida registra `UNAVAILABLE`/`FAILED` con su motivo. La investigación sigue
 * con las fuentes que sí estén: perder una fuente no puede borrar las demás.
 */
import type { GoogleAdsMutateHttpClient } from '../campana/google-ads-mutate-http';
import type { GeoTargetProvider, GeoTargetResuelto, PeticionDemanda, RespuestaDemanda, SearchDemandProvider } from './proveedores';

/** Vida de la caché de una consulta. Corta: los datos de demanda cambian despacio, pero no son eternos. */
const TTL_CACHE_MS = 30 * 60_000;

interface EntradaCache<T> {
  readonly at: number;
  readonly valor: T;
}

/**
 * Coordinador de llamadas: una misma consulta en vuelo se comparte, y su resultado se reutiliza un rato. Vive
 * en memoria del proceso a propósito — es una defensa de cuota, no un almacén de datos.
 */
export class CoordinadorDeConsultas {
  private readonly enVuelo = new Map<string, Promise<unknown>>();
  private readonly cache = new Map<string, EntradaCache<unknown>>();

  constructor(private readonly ahora: () => number = () => Date.now(), private readonly ttlMs = TTL_CACHE_MS) {}

  async una<T>(clave: string, fn: () => Promise<T>): Promise<T> {
    const guardada = this.cache.get(clave);
    if (guardada !== undefined && this.ahora() - guardada.at < this.ttlMs) return guardada.valor as T;
    const enCurso = this.enVuelo.get(clave);
    if (enCurso !== undefined) return (await enCurso) as T;
    const promesa = (async (): Promise<T> => {
      try {
        const v = await fn();
        this.cache.set(clave, { at: this.ahora(), valor: v });
        return v;
      } finally {
        this.enVuelo.delete(clave);
      }
    })();
    this.enVuelo.set(clave, promesa);
    return promesa;
  }

  /** Cuántas consultas distintas se han servido de caché. Observabilidad del gobierno de cuota. */
  get tamanoCache(): number {
    return this.cache.size;
  }
}

export interface DepsGoogleInvestigacion {
  readonly cliente: GoogleAdsMutateHttpClient;
  readonly customerId: string;
  readonly org: string;
  readonly coordinador?: CoordinadorDeConsultas;
  readonly ahora?: () => string;
  readonly log?: (info: Record<string, unknown>) => void;
}

/** Demanda de búsqueda real. Las semillas son las OFERTAS del negocio: no se inventan términos aquí. */
export function crearProveedorDemandaGoogle(deps: DepsGoogleInvestigacion): SearchDemandProvider {
  const coordinador = deps.coordinador ?? new CoordinadorDeConsultas();
  const ahora = deps.ahora ?? (() => new Date().toISOString());
  return {
    nombre: 'google-ads-keyword-ideas',
    fuente: 'GOOGLE_ADS_KEYWORD_DATA',
    async demanda(p: PeticionDemanda): Promise<RespuestaDemanda | null> {
      if (p.semillas.length === 0) return null;
      const clave = `demanda:${deps.org}:${deps.customerId}:${[...p.semillas].sort().join('|')}:${[...p.geoTargetIds].sort().join(',')}:${p.idioma}`;
      try {
        const ideas = await coordinador.una(clave, async () =>
          deps.cliente.generarIdeasDePalabras(deps.customerId, {
            semillas: p.semillas,
            url: p.urlSitio,
            geoTargetIds: p.geoTargetIds,
            languageId: p.idioma.startsWith('es') ? '1003' : '1000',
          }),
        );
        deps.log?.({ investigacion: 'demanda', org: deps.org, ideas: ideas.length, cacheados: coordinador.tamanoCache });
        return {
          ideas: ideas.map((i) => ({
            termino: i.texto,
            semilla: null,
            metricas: {
              avgMonthlySearches: i.avgMonthlySearches,
              competition: i.competition === 'LOW' || i.competition === 'MEDIUM' || i.competition === 'HIGH' ? i.competition : 'UNKNOWN',
              competitionIndex: i.competitionIndex,
              lowTopOfPageBidMicros: i.lowTopOfPageBidMicros,
              highTopOfPageBidMicros: i.highTopOfPageBidMicros,
            },
          })),
          fuente: 'GOOGLE_ADS_KEYWORD_DATA',
          observadoEn: ahora(),
          // KeywordPlanIdeaService devuelve el promedio de los últimos 12 meses.
          periodo: 'promedio mensual de los últimos 12 meses',
        };
      } catch (e) {
        deps.log?.({ investigacion: 'demanda_fallida', org: deps.org, error: e instanceof Error ? e.message : String(e) });
        return null; // fail-soft: la corrida lo registra como FAILED con su motivo
      }
    },
  };
}

/**
 * Territorios REALES de la plataforma. Se distingue lo pedido de lo disponible, y se marca cuándo alcanzar el
 * territorio exige una unidad más amplia: usar un radio o una región entera como sustituto silencioso sería
 * anunciar donde el negocio no autorizó.
 */
export function crearProveedorGeoGoogle(deps: DepsGoogleInvestigacion): GeoTargetProvider {
  const coordinador = deps.coordinador ?? new CoordinadorDeConsultas();
  return {
    nombre: 'google-ads-geo-targets',
    fuente: 'GOOGLE_ADS_GEO_TARGETS',
    async resolver(nombres: readonly string[], pais: string, idioma: string): Promise<readonly GeoTargetResuelto[] | null> {
      if (nombres.length === 0) return [];
      const clave = `geo:${deps.org}:${pais}:${[...nombres].sort().join('|')}`;
      try {
        const sugeridos = await coordinador.una(clave, async () => deps.cliente.sugerirGeoTargets(nombres, pais, idioma));
        const porNombre = new Map(sugeridos.map((s) => [s.name.toLowerCase(), s]));
        return nombres.map((solicitado) => {
          const exacto = porNombre.get(solicitado.toLowerCase()) ?? null;
          if (exacto === null) {
            return { solicitado, disponible: false, targetId: null, targetTipo: null, nombreCanonico: null, aproximacion: false, riesgoDerrame: 'UNKNOWN' as const };
          }
          const esCiudad = exacto.targetType === 'City' || exacto.targetType === 'Municipality' || exacto.targetType === 'Postal Code';
          return {
            solicitado,
            disponible: exacto.status !== 'REMOVED' && exacto.criterionId !== '',
            targetId: exacto.criterionId,
            targetTipo: exacto.targetType,
            nombreCanonico: exacto.canonicalName,
            // Si la plataforma sólo ofrece una unidad más amplia que la pedida, hay aproximación y derrame.
            aproximacion: !esCiudad,
            riesgoDerrame: esCiudad ? ('NONE' as const) : ('HIGH' as const),
          };
        });
      } catch (e) {
        deps.log?.({ investigacion: 'geo_fallida', org: deps.org, error: e instanceof Error ? e.message : String(e) });
        return null;
      }
    },
  };
}
