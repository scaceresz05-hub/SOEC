/**
 * apps/api · CONEXIONES COMO DATO · proyección de lo persistido a la configuración que el runtime entiende.
 *
 * El sistema ya tenía UNA puerta de resolución `organización → negocio / perfil / fuentes`
 * (`crearResolutorDeNegocios`, una función pura sobre un conjunto de configuraciones). Esta fase no la
 * reemplaza: le cambia la FUENTE. Las configuraciones dejan de venir de un array de módulos TypeScript y se
 * PROYECTAN desde PostgreSQL —perfil, conexiones, capacidades y postura de gobierno—, de modo que las 34
 * rutas que dependían del registro pasan a leer datos persistidos sin tocar ninguna de ellas.
 *
 * MEZCLA DECLARADA (y por qué): para las tres empresas históricas, lo persistido MANDA en lo que esta fase
 * modela (identidad visible, capacidades, conexiones, recurso de Google Ads, pausa de seguridad) y el módulo
 * histórico sigue aportando lo que todavía NO es dato (política de evaluación: objetivo, criterio, límites de
 * autonomía, contexto del director). Cada campo que sigue viniendo del registro queda CONTADO en el resumen,
 * porque una dependencia legado que nadie mide se vuelve permanente.
 *
 * Una empresa NUEVA no participa de esa mezcla: su configuración se proyecta entera desde la base. Si algo le
 * falta (política de evaluación, conexión), el resultado dice exactamente qué falta — nunca hereda de nadie.
 */
import type { AlcanceGeografico } from '@soec/campanias';
import type { Pool } from 'pg';
import { configuracionHistorica, organizacionesHistoricas } from '../plataforma/registro';
import type {
  ConfiguracionOrganizacion,
  CredencialRef,
  EstadoFuente,
  EstadoNegocio as EstadoIncorporacion,
  ExperienciaReal,
  FuenteRegistrada,
  ModeloDeNegocio,
  NegocioRegistrado,
  RecursoGoogleAds,
} from '../plataforma/tipos';
import { RepositorioNegocios, type GobiernoNegocio, type PerfilNegocio, type TerritorioNegocio, type TipoNegocio } from '../negocio/negocio-pg';
import { RepositorioConexiones, type CapacidadPersistida, type Conexion } from './conexion-pg';
import {
  CAPACIDAD_DE_EXPERIENCIA,
  EXPERIENCIA_DE_CAPACIDAD,
  type CapacidadNegocio,
  type ConfigGoogleAds,
  type ConfigGrowth,
} from './conexion-tipos';

/** De dónde salió la configuración con la que el runtime está operando para una organización. */
export type OrigenConfiguracion = 'PERSISTIDA' | 'PERSISTIDA_CON_REGISTRO' | 'REGISTRO';

export interface DetalleProyeccion {
  readonly org: string;
  readonly origen: OrigenConfiguracion;
  readonly conexiones: readonly string[];
  readonly capacidades: readonly CapacidadNegocio[];
  /** Qué sigue viniendo del módulo TypeScript histórico. Vacío en una empresa nueva. */
  readonly camposDelRegistro: readonly string[];
}

export interface SnapshotNegocios {
  readonly configs: readonly ConfiguracionOrganizacion[];
  readonly detalle: readonly DetalleProyeccion[];
  readonly at: string;
}

/** Tipo de negocio → modelo de evaluación. `OTRO` cae en SERVICIOS: es el modelo genérico, no una suposición. */
function modeloDe(tipo: TipoNegocio): ModeloDeNegocio {
  switch (tipo) {
    case 'SAAS': return 'SAAS_FUNNEL';
    case 'ECOMMERCE': return 'ECOMMERCE_DISTRIBUCION';
    default: return 'SERVICIOS';
  }
}

/** Estado de fuente que corresponde al estado de la conexión. Ninguno significa «cero datos». */
function estadoDeFuente(c: Conexion): EstadoFuente {
  switch (c.estado) {
    case 'CONNECTED': return 'CONNECTED_READ_ONLY';
    case 'PENDING': return 'PENDING';
    case 'ERROR': return 'PARTIAL_CONFIGURATION';
    case 'DISABLED': return 'NOT_CONNECTED';
    default: return c.secretRef === null ? 'CREDENTIALS_REQUIRED' : 'NOT_CONNECTED';
  }
}

function faltantesDe(c: Conexion): readonly string[] {
  const f: string[] = [];
  if (c.secretRef === null) f.push('credencial de acceso');
  if (c.estado === 'ERROR' && c.ultimoError) f.push(`última validación fallida: ${c.ultimoError}`);
  return f;
}

/** Fuente registrada equivalente a una conexión persistida. Sin secretos: sólo la referencia declarada. */
export function fuenteDeConexion(c: Conexion): FuenteRegistrada {
  const cfg = c.configuracion as Partial<ConfigGrowth & ConfigGoogleAds>;
  const provider = c.provider === 'GROWTH_M2M'
    ? String(cfg.provider ?? 'growth')
    : c.provider === 'GOOGLE_ADS'
      ? 'google-ads'
      : c.provider.toLowerCase().replace(/_/g, '-');
  const sourceId = String(cfg.sourceId ?? `src-${c.organizationId}-${provider}`);
  const credenciales: readonly CredencialRef[] = c.secretRef === null
    ? []
    : [{ nombreLogico: String(cfg.nombreLogicoCredencial ?? `${provider}-credencial`), secretRef: c.secretRef }];
  const base: FuenteRegistrada = {
    sourceId,
    organizationId: c.organizationId,
    provider,
    tipo: c.tipo,
    externalAccountId: c.externalAccountId,
    credenciales,
    estado: estadoDeFuente(c),
    soloLectura: true,
    faltantes: faltantesDe(c),
  };
  if (c.provider !== 'GROWTH_M2M') return base;
  return {
    ...base,
    growth: {
      baseUrl: String(cfg.baseUrl ?? ''),
      hostsAutorizados: Array.isArray(cfg.hostsAutorizados) ? cfg.hostsAutorizados.map((h) => String(h)) : [],
      rutaIngesta: String(cfg.rutaIngesta ?? '/'),
      nombreLogicoCredencial: String(cfg.nombreLogicoCredencial ?? `${provider}-token`),
      baseUrlEnvOverride: cfg.baseUrlEnvOverride ?? null,
    },
  };
}

/** Recurso canónico de Google Ads de una conexión. `null` si la conexión no declara cuenta ni campaña. */
export function recursoGoogleAdsDe(c: Conexion | null): RecursoGoogleAds | null {
  if (c === null) return null;
  const cfg = c.configuracion as Partial<ConfigGoogleAds>;
  if (!cfg.customerId || !cfg.campaignId) return null;
  return {
    customerId: String(cfg.customerId),
    loginCustomerId: String(cfg.loginCustomerId ?? cfg.customerId),
    campaignId: String(cfg.campaignId),
    campaniaRef: String(cfg.campaniaRef ?? `campania-${cfg.campaignId}`),
    actividadId: String(cfg.actividadId ?? `actividad-${cfg.campaignId}`),
    canal: String(cfg.canal ?? 'GOOGLE_SEARCH'),
    nombreCampania: String(cfg.nombreCampania ?? `campaña ${cfg.campaignId}`),
  };
}

/** Experiencias que las capacidades persistidas habilitan. Orden estable para que la salida sea determinista. */
export function experienciasDeCapacidades(caps: readonly CapacidadPersistida[]): readonly ExperienciaReal[] {
  const habilitadas = new Set(caps.filter((c) => c.habilitada).map((c) => c.capacidad));
  return (Object.keys(CAPACIDAD_DE_EXPERIENCIA) as ExperienciaReal[])
    .filter((e) => habilitadas.has(CAPACIDAD_DE_EXPERIENCIA[e]));
}

function alcanceDeTerritorio(t: TerritorioNegocio | undefined): AlcanceGeografico | null {
  if (!t || t.localities.length === 0) return null;
  return {
    pais: t.country,
    region: t.region ?? '',
    provincia: t.province,
    comunas: [...t.localities],
    criterioUbicacion: 'PRESENCIA',
  };
}

/** Estado de incorporación derivado de lo persistido. Sólo se usa para empresas SIN módulo histórico. */
function estadoDeIncorporacion(perfil: PerfilNegocio, conexiones: readonly Conexion[]): EstadoIncorporacion {
  if (perfil.status === 'DRAFT') return 'CREATED';
  if (perfil.status === 'CONFIGURING') return 'CONFIGURING';
  if (conexiones.length === 0) return 'SOURCES_PENDING';
  const conectadas = conexiones.filter((c) => c.estado === 'CONNECTED').length;
  if (conectadas === 0) return 'SOURCES_PENDING';
  return conectadas === conexiones.length ? 'OBSERVING' : 'SOURCES_PARTIAL';
}

export interface DatosDeNegocio {
  readonly perfil: PerfilNegocio;
  readonly gobierno: GobiernoNegocio | null;
  readonly territorios: readonly TerritorioNegocio[];
  readonly categorias: readonly string[];
  readonly pendientes: readonly string[];
  readonly conexiones: readonly Conexion[];
  readonly capacidades: readonly CapacidadPersistida[];
}

/**
 * Proyecta UNA organización. Pura: recibe datos, devuelve configuración y el detalle de su procedencia.
 * Testeable sin base de datos, que es lo que permite demostrar la regla «una empresa nueva no usa el registro».
 */
export function proyectarNegocio(d: DatosDeNegocio): { config: ConfiguracionOrganizacion; detalle: DetalleProyeccion } {
  const org = d.perfil.organizationId;
  const base = configuracionHistorica(org);
  const delRegistro: string[] = [];
  // Se proyectan TODAS las conexiones, incluidas las apagadas: una conexión `DISABLED` se traduce a una fuente
  // sin lectura y SUSTITUYE a la del módulo histórico. Si se filtraran, apagar la conexión de una empresa
  // migrada no tendría efecto —volvería a valer la fuente del código—, y apagar algo tiene que apagarlo.
  const conexiones = d.conexiones;
  const fuentesProyectadas = conexiones.map((c) => fuenteDeConexion(c));

  // CAPACIDADES: lo persistido manda. Sin ninguna fila (migración no corrida) se respeta el registro, y se
  // deja constancia: es compatibilidad medida, no comportamiento por defecto.
  let experiencias: readonly ExperienciaReal[];
  if (d.capacidades.length > 0) {
    experiencias = experienciasDeCapacidades(d.capacidades);
  } else if (base) {
    experiencias = base.negocio.experienciasHabilitadas;
    delRegistro.push('experienciasHabilitadas');
  } else {
    experiencias = [];
  }

  const adsConexion = conexiones.find((c) => c.provider === 'GOOGLE_ADS') ?? null;
  const recursoAds = recursoGoogleAdsDe(adsConexion);
  const alcance = alcanceDeTerritorio(d.territorios.find((t) => t.ambito === 'BUSINESS'));

  // FUENTES: las conexiones persistidas sustituyen a la fuente del mismo proveedor y se añaden si son nuevas.
  // Las fuentes históricas que NO son conexiones (sitio observado, GA4 no configurado) se conservan: quitarlas
  // haría desaparecer información verdadera del panel.
  let fuentes: readonly FuenteRegistrada[] = fuentesProyectadas;
  if (base) {
    const proyectadas = new Map(fuentesProyectadas.map((f) => [f.provider, f]));
    const mezcladas = base.fuentes.map((f) => proyectadas.get(f.provider) ?? f);
    const yaEstaban = new Set(base.fuentes.map((f) => f.provider));
    fuentes = [...mezcladas, ...fuentesProyectadas.filter((f) => !yaEstaban.has(f.provider))];
    const noProyectadas = base.fuentes.filter((f) => !proyectadas.has(f.provider)).map((f) => f.provider);
    if (noProyectadas.length > 0) delRegistro.push(`fuentes:${noProyectadas.join('|')}`);
  }

  const negocio: NegocioRegistrado = base
    ? {
        ...base.negocio,
        // Lo que ahora es dato: nombre, objetivo, territorio, capacidades y permiso de pausa automática.
        displayName: d.perfil.displayName,
        legalName: d.perfil.legalName ?? base.negocio.legalName,
        experienciasHabilitadas: experiencias,
        objetivoComercial: d.perfil.primaryObjective ?? base.negocio.objetivoComercial,
        alcanceComercial: alcance ?? base.negocio.alcanceComercial ?? null,
        politicaSeguridad: { pausaAutomatica: d.gobierno?.automaticSafetyPause === true },
      }
    : {
        organizationId: org,
        businessKey: d.perfil.businessKey,
        legalName: d.perfil.legalName ?? d.perfil.displayName,
        displayName: d.perfil.displayName,
        rut: null, // dato de una persona: jamás se inventa
        modeloDeNegocio: modeloDe(d.perfil.businessType),
        mercado: d.perfil.country,
        estado: estadoDeIncorporacion(d.perfil, conexiones),
        categoriasDeclaradas: d.categorias,
        legacyAliases: [],
        experienciasHabilitadas: experiencias,
        decisionPiloto: null,
        datosHumanosPendientes: d.pendientes,
        alcanceComercial: alcance,
        tipoDeNegocio: d.perfil.description ?? undefined,
        objetivoComercial: d.perfil.primaryObjective ?? undefined,
        politicaSeguridad: { pausaAutomatica: d.gobierno?.automaticSafetyPause === true },
      };

  if (base) {
    // La POLÍTICA DE EVALUACIÓN (objetivo, criterio, límites, contexto del director) todavía no es dato.
    if (base.perfil) delRegistro.push('perfilDeEvaluacion');
    if (base.perfilComercial) delRegistro.push('perfilComercial');
    delRegistro.push('estadoDeIncorporacion');
  }

  const perfil = base?.perfil
    ? {
        ...base.perfil,
        // El recurso de Google Ads pasa a resolverse desde la CONEXIÓN. Sin conexión se conserva el histórico
        // (y queda contado), porque perderlo dejaría a la campaña vigente sin cuenta resuelta.
        externalResourceRefs: { googleAds: recursoAds ?? base.perfil.externalResourceRefs.googleAds },
      }
    : null;
  if (base?.perfil && recursoAds === null && base.perfil.externalResourceRefs.googleAds !== null) {
    delRegistro.push('recursoGoogleAds');
  }

  const config: ConfiguracionOrganizacion = {
    negocio,
    perfilComercial: base?.perfilComercial ?? null,
    perfil,
    embudo: base?.embudo ?? null,
    fuentes,
  };

  return {
    config,
    detalle: {
      org,
      origen: base ? 'PERSISTIDA_CON_REGISTRO' : 'PERSISTIDA',
      conexiones: conexiones.map((c) => `${c.provider}:${c.estado}`),
      capacidades: d.capacidades.filter((c) => c.habilitada).map((c) => c.capacidad),
      camposDelRegistro: [...new Set(delRegistro)],
    },
  };
}

/** Restricción «dato pendiente de aportar: X» → «X». Inverso exacto de lo que escribió la migración de Fase A. */
const PREFIJO_PENDIENTE = 'dato pendiente de aportar: ';

/**
 * Lee la base y construye el snapshot COMPLETO del despliegue. Incluye, al final y sólo por compatibilidad,
 * las organizaciones que están en el registro pero aún no en la base (una migración que no corrió no puede
 * dejar a una empresa histórica sin runtime). Cada una queda marcada con origen `REGISTRO`.
 */
export async function construirSnapshotDeNegocios(pool: Pool, ahora: () => string = () => new Date().toISOString()): Promise<SnapshotNegocios> {
  const repoN = new RepositorioNegocios(pool);
  const repoC = new RepositorioConexiones(pool);
  const [perfiles, conexiones, capacidades] = await Promise.all([repoN.listarTodos(), repoC.todas(), repoC.todasLasCapacidades()]);

  const configs: ConfiguracionOrganizacion[] = [];
  const detalle: DetalleProyeccion[] = [];
  const vistas = new Set<string>();

  for (const perfil of perfiles) {
    const org = perfil.organizationId;
    const [gobierno, territorios, oferta, restricciones] = await Promise.all([
      repoN.gobierno(org), repoN.territorios(org), repoN.oferta(org), repoN.restricciones(org),
    ]);
    const r = proyectarNegocio({
      perfil,
      gobierno,
      territorios,
      categorias: [...new Set(oferta.map((o) => o.category ?? o.name))],
      pendientes: restricciones
        .filter((x) => x.tipo === 'RESTRICTION' && x.texto.startsWith(PREFIJO_PENDIENTE))
        .map((x) => x.texto.slice(PREFIJO_PENDIENTE.length)),
      conexiones: conexiones.filter((c) => c.organizationId === org),
      capacidades: capacidades.filter((c) => c.organizationId === org),
    });
    configs.push(r.config);
    detalle.push(r.detalle);
    vistas.add(org);
  }

  for (const org of organizacionesHistoricas()) {
    if (vistas.has(org)) continue;
    const c = configuracionHistorica(org);
    if (!c) continue;
    configs.push(c);
    detalle.push({
      org,
      origen: 'REGISTRO',
      conexiones: c.fuentes.map((f) => `${f.provider}:${f.estado}`),
      capacidades: c.negocio.experienciasHabilitadas
        .map((e) => CAPACIDAD_DE_EXPERIENCIA[e])
        .filter((x): x is CapacidadNegocio => x !== undefined),
      camposDelRegistro: ['negocio', 'fuentes', 'perfilDeEvaluacion', 'experienciasHabilitadas'],
    });
  }

  return { configs, detalle, at: ahora() };
}

/** Capacidad ↔ experiencia, expuesto para que la superficie HTTP hable el mismo idioma que el binding. */
export function experienciaDeCapacidad(c: CapacidadNegocio): ExperienciaReal | null {
  return EXPERIENCIA_DE_CAPACIDAD[c] ?? null;
}
