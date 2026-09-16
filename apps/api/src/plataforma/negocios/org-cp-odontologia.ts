/**
 * apps/api · PLATAFORMA MULTIEMPRESA · CONFIGURACIÓN REGISTRADA de `org-cp-odontologia`.
 *
 * TERCERA ORGANIZACIÓN REAL: **CP Odontología** (Dra. Claudia Pacheco, Curicó). Independiente de
 * `org-smileflow` y de `org-cyp` en identidad, configuración, fuentes, credenciales y evaluación.
 * Se incorpora AÑADIENDO esta configuración y su línea en `ORGANIZACIONES_DEL_DESPLIEGUE`: el núcleo
 * no cambia (es exactamente la puerta de extensión que `crearResolutorDeNegocios` ya probaba).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ESTADO REAL
 *   · el sitio nuevo (Next.js) está en PRODUCCIÓN en `https://www.dentistaclaudiapacheco.cl`; el
 *     ÁPICE sigue deliberadamente en el servidor antiguo, porque de él depende el MX del correo;
 *   · el puente M2M `GROWTH` está CONECTADO en SOLO LECTURA: endpoint publicado, token depositado en
 *     los dos extremos y `www` autorizado; el despliegue lo consume vía `CP_ODONTOLOGIA_M2M_URL`;
 *   · NO hay cuenta de anuncios, ni analítica, ni economía medida ⇒ `perfil` (política de
 *     evaluación) permanece en `null` y ninguna experiencia REAL está habilitada.
 *
 * NO SE INVENTA: RUT, ticket, márgenes, CAC/CPA, tasa de conversión, volumen de pacientes,
 * títulos, años de experiencia ni resultados clínicos.
 *
 * PRIVACIDAD (regla V1 del proyecto, verificada en `politica-privacidad-growth.ts`):
 *   · los eventos de interés por tratamiento (`service_viewed:<slug>`) llegan SIN `leadRef`;
 *   · los eventos correlacionables con contacto (`whatsapp_intent`, `phone_intent`,
 *     `appointment_intent`) pueden llevar `leadRef`, pero NUNCA tratamiento, ruta de tratamiento,
 *     diagnóstico, síntomas ni texto clínico libre.
 * Por eso el embudo V1 se construye SÓLO con eventos de intención comercial.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
import { desconocido } from '@soec/comercio';
import { economiaSinMedir } from '../tipos';
import type {
  ConfiguracionOrganizacion,
  CredencialRef,
  EmbudoDeConversion,
  FuenteRegistrada,
} from '../tipos';

/** Clave de tenant canónica. Coherente con el resto: prefijo `org-` + clave de negocio. */
export const ORG_CP_ODONTOLOGIA = 'org-cp-odontologia' as const;
/** Clave/slug de NEGOCIO. No es utilizable como `organizationId`. */
export const BUSINESS_KEY_CP_ODONTOLOGIA = 'cp-odontologia' as const;

/** Provider PROPIO de la fuente Growth de CP. Nunca se reutiliza el de otra organización. */
export const PROVIDER_GROWTH_CP_ODONTOLOGIA = 'cp-odontologia-growth' as const;

/** Sitio público en producción: el sitio nuevo, servido en `www` (canónico). */
export const SITIO_CP_ODONTOLOGIA = 'https://www.dentistaclaudiapacheco.cl' as const;

/**
 * Origen DECLARADO del puente M2M: el STAGING, donde se validó. El origen EFECTIVO en producción lo
 * fija la variable `CP_ODONTOLOGIA_M2M_URL` del despliegue, que apunta a `www`; así un entorno sin
 * esa variable nunca envía el token a producción por defecto.
 */
export const BASE_URL_GROWTH_CP_ODONTOLOGIA = 'https://cp-odontologia-stg.pages.dev' as const;
export const HOST_GROWTH_CP_ODONTOLOGIA = 'cp-odontologia-stg.pages.dev' as const;

/**
 * Host del sitio nuevo en PRODUCCIÓN: `www`, el canónico de los HTML, del `robots.txt` y del
 * `sitemap.xml` validados. Es el ÚNICO host de producción autorizado.
 *
 * El ÁPICE NO se autoriza, y no por omisión: sigue en el servidor antiguo porque de su registro A
 * depende el MX del correo. Ese servidor no sirve el puente (la ruta devuelve 404), así que
 * autorizarlo sólo abriría un camino para que el token de ingesta viajara a un host ajeno al sitio
 * nuevo. El traslado del ápice es una operación aparte.
 */
export const HOST_WWW_CP_ODONTOLOGIA = 'www.dentistaclaudiapacheco.cl' as const;
export const BASE_URL_WWW_CP_ODONTOLOGIA = 'https://www.dentistaclaudiapacheco.cl' as const;

/**
 * Credencial de ingesta, SÓLO por referencia opaca. Su valor lo deposita una persona en el entorno;
 * SOEC no lo crea, no lo lee y no lo registra.
 */
export const CREDENCIAL_GROWTH_CP_ODONTOLOGIA: CredencialRef = {
  nombreLogico: 'cp-odontologia-growth-token',
  secretRef: 'env:CP_ODONTOLOGIA_GROWTH_TOKEN',
};

/**
 * EMBUDO V1 de CP Odontología: intención comercial, nada clínico.
 *   primaria   : `whatsapp_intent`   (el canal declarado como principal por la clínica)
 *   secundarias: `appointment_intent`, `phone_intent`
 * Los eventos `service_viewed:<slug>` NO entran todavía en el embudo (decisión de este gate).
 */
export const EMBUDO_CP_ODONTOLOGIA: EmbudoDeConversion = {
  conversionPrimaria: 'whatsapp_intent',
  conversionesSecundarias: ['appointment_intent', 'phone_intent'],
};

/** Fuente GROWTH de CP: su propio provider, host, ruta y credencial. Conectada en SOLO LECTURA. */
const FUENTE_GROWTH_CP: FuenteRegistrada = {
  sourceId: 'src-cp-odontologia-growth',
  organizationId: ORG_CP_ODONTOLOGIA,
  provider: PROVIDER_GROWTH_CP_ODONTOLOGIA,
  tipo: 'GROWTH',
  externalAccountId: null,
  credenciales: [CREDENCIAL_GROWTH_CP_ODONTOLOGIA],
  // CONECTADA en SOLO LECTURA, igual que la de SmileFlow: el endpoint M2M del staging está publicado,
  // el token está depositado en los dos extremos y la ingesta real ya corrió contra este host. El
  // estado es un HECHO verificado, no una intención: mientras decía `NOT_CONNECTED`, SOEC informaba
  // como sin conectar una fuente de la que estaba ingiriendo.
  estado: 'CONNECTED_READ_ONLY',
  soloLectura: true,
  // Nada pendiente para ESTA fuente: endpoint publicado, token depositado y host de producción (`www`)
  // autorizado. Que el ápice siga en el servidor antiguo no es un requisito de la fuente Growth.
  faltantes: [],
  growth: {
    baseUrl: BASE_URL_GROWTH_CP_ODONTOLOGIA,
    // Staging y `www`, y nada más. El staging sigue autorizado porque es el origen declarado y donde
    // se validó el puente; el ápice queda fuera a propósito (ver HOST_WWW_CP_ODONTOLOGIA).
    hostsAutorizados: [HOST_GROWTH_CP_ODONTOLOGIA, HOST_WWW_CP_ODONTOLOGIA],
    rutaIngesta: '/integrations/soec/growth-events',
    nombreLogicoCredencial: CREDENCIAL_GROWTH_CP_ODONTOLOGIA.nombreLogico,
    baseUrlEnvOverride: 'CP_ODONTOLOGIA_M2M_URL',
  },
};

export const CONFIGURACION_ORG_CP_ODONTOLOGIA: ConfiguracionOrganizacion = {
  negocio: {
    organizationId: ORG_CP_ODONTOLOGIA,
    businessKey: BUSINESS_KEY_CP_ODONTOLOGIA,
    // Razón social EXACTA según WHOIS de NIC Chile. No se "corrige" ni se embellece.
    legalName: 'CENTRO E SALUD ODONTOLOGICO CP SPA',
    displayName: 'CP Odontología',
    rut: null, // pendiente del propietario; nunca se inventa
    modeloDeNegocio: 'SERVICIOS',
    mercado: 'Chile',
    // Su única fuente está declarada y sin conectar: la incorporación está en curso.
    estado: 'SOURCES_PENDING',
    categoriasDeclaradas: ['clínica dental', 'odontología general'],
    legacyAliases: [],
    // Ninguna experiencia REAL habilitada: sin política de evaluación no hay nada que evaluar.
    experienciasHabilitadas: [],
    decisionPiloto: null,
    datosHumanosPendientes: [
      'RUT / identificación tributaria',
      'buzón de correo corporativo (contacto@dentistaclaudiapacheco.cl aún no existe)',
      'cuenta de anuncios propia, si alguna vez se abre',
      'economía del servicio (ticket, costos) desde una fuente autorizada',
    ],
  },

  /** Qué ES el negocio: hechos observados. La economía, toda desconocida. */
  perfilComercial: {
    organizationId: ORG_CP_ODONTOLOGIA,
    businessModel: 'SERVICIOS',
    market: 'CL',
    currency: 'CLP',
    orientacion: 'B2C',
    plataforma: 'Next.js (sitio en reconstrucción; producción actual congelada)',
    sitio: SITIO_CP_ODONTOLOGIA,
    base: 'Curicó, Región del Maule, Chile',
    canales: [
      {
        canal: 'WHATSAPP',
        estado: 'CONNECTED_UNKNOWN',
        contribucionComercial: desconocido('NO_INSTRUMENTADO'),
        detalle: 'WhatsApp es el contacto público principal; su volumen real no es medible aún',
      },
      {
        canal: 'TELEFONO',
        estado: 'CONNECTED_UNKNOWN',
        contribucionComercial: desconocido('NO_INSTRUMENTADO'),
        detalle: 'teléfono publicado en el sitio; sin instrumentación de llamadas',
      },
      {
        canal: 'SOCIAL',
        estado: 'OBSERVED',
        contribucionComercial: desconocido('NO_INSTRUMENTADO'),
        detalle: 'perfil de Instagram observado; sin píxel ni atribución',
      },
      {
        canal: 'ECOMMERCE',
        estado: 'NOT_APPLICABLE',
        contribucionComercial: desconocido('NO_APLICA'),
        detalle: 'no vende en línea: capta solicitudes de atención',
      },
    ],
    verticales: ['ODONTOLOGIA'],
    economia: economiaSinMedir('NO_MEDIDO'),
    procedencia: 'discovery de solo lectura del sitio público y del dominio (Gate 0 / Gate 2)',
  },

  // Sin POLÍTICA de evaluación: no hay objetivo, criterio, presupuesto ni cuenta externa que fijar.
  perfil: null,

  /** Embudo propio: existe aunque la organización todavía no sea evaluable. */
  embudo: EMBUDO_CP_ODONTOLOGIA,

  fuentes: [
    {
      sourceId: 'src-cp-odontologia-website',
      organizationId: ORG_CP_ODONTOLOGIA,
      provider: 'sitio-web',
      tipo: 'WEBSITE',
      externalAccountId: null,
      credenciales: [],
      estado: 'OBSERVED',
      soloLectura: true,
      faltantes: [],
    },
    FUENTE_GROWTH_CP,
    {
      sourceId: 'src-cp-odontologia-ga4',
      organizationId: ORG_CP_ODONTOLOGIA,
      provider: 'ga4',
      tipo: 'ANALYTICS',
      externalAccountId: null,
      credenciales: [],
      estado: 'NOT_CONFIGURED',
      soloLectura: true,
      faltantes: ['no hay GA4 instalado en el sitio', 'property_id (cuando exista)'],
    },
    {
      sourceId: 'src-cp-odontologia-google-ads',
      organizationId: ORG_CP_ODONTOLOGIA,
      provider: 'google-ads',
      tipo: 'ADS',
      externalAccountId: null,
      credenciales: [],
      estado: 'NOT_CONFIGURED',
      soloLectura: true,
      faltantes: ['no hay cuenta de Google Ads para esta organización'],
    },
  ],
};
