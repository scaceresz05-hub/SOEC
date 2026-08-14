/**
 * apps/api · PLATAFORMA MULTIEMPRESA · CONFIGURACIÓN REGISTRADA de `org-cyp`.
 *
 * SEGUNDA ORGANIZACIÓN REAL: **Distribuidora C Y P SpA**. Independiente de `org-smileflow` en
 * identidad, configuración, fuentes, credenciales y evaluación.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * DEMOSTRADO POR EL DISCOVERY (lectura pública, 2026-08-14) — https://distribuidoracyp.cl/
 *   · razón social  : Distribuidora C Y P SpA · base en Curicó, Región del Maule
 *   · stack         : WordPress + WooCommerce 11.0.1 + Divi 4.27.4
 *   · catálogo      : ~129 productos, taxonomía con verticales dental / aseo industrial / desechables
 *   · moneda        : CLP · mercado: Chile
 *   · canales       : tienda WooCommerce · WhatsApp visible en todo el sitio · redes sociales
 *   · analítica     : NO hay GA4, ni GTM, ni etiqueta de Ads, ni píxel de Meta, ni e-commerce tracking
 *   · despacho      : Starken declarado; checkout con un único `flat_rate` $0 «envío por pagar»
 *
 * SIGUE SIN SABERSE — y por tanto NO SE INVENTA:
 *   RUT · ventas · ticket · márgenes · costos · CAC/CPA/ROAS · tasa de conversión · recompra ·
 *   Google Ads · GA4 · Merchant Center · Search Console · CRM · contribución real de WhatsApp.
 *
 * Consecuencias codificadas:
 *   · `perfil` (política de evaluación) sigue en `null` ⇒ nada de ROAS/CPA/presupuesto inventados.
 *   · `perfilComercial` SÍ existe: describe el negocio con hechos, con la economía toda desconocida.
 *   · ninguna experiencia REAL habilitada: no hay nada que evaluar todavía.
 *   · «envío $0» NO se interpreta como ingreso ni costo cero: es pago EXTERNO / desconocido.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
import { conocido, desconocido } from '@soec/comercio';
import type {
  ConfiguracionOrganizacion,
  EstadoFuente,
  FuenteRegistrada,
  TipoFuente,
} from '../tipos';
import { economiaSinMedir } from '../tipos';

/** Clave de tenant canónica. Coherente con `org-smileflow`: prefijo `org-` + clave corta. */
export const ORG_CYP = 'org-cyp' as const;
/** Clave de NEGOCIO (dominio), separada del tenant. No es utilizable como `organizationId`. */
export const BUSINESS_KEY_CYP = 'distribuidora-cyp' as const;

export const SITIO_CYP = 'https://distribuidoracyp.cl' as const;
/** Base de la Store API pública de WooCommerce. Sólo lectura, sin credenciales. */
export const STORE_API_CYP = `${SITIO_CYP}/wp-json/wc/store/v1` as const;
/** Identificador opaco de la fuente de catálogo. Debe coincidir con el del adaptador. */
export const SOURCE_CATALOGO_CYP = 'woocommerce-store-api' as const;

function fuente(
  sourceId: string,
  provider: string,
  tipo: TipoFuente,
  estado: EstadoFuente,
  faltantes: readonly string[],
): FuenteRegistrada {
  return {
    sourceId,
    organizationId: ORG_CYP,
    provider,
    tipo,
    externalAccountId: null,
    credentialRef: null,
    estado,
    soloLectura: true,
    faltantes,
  };
}

export const CONFIGURACION_ORG_CYP: ConfiguracionOrganizacion = {
  negocio: {
    organizationId: ORG_CYP,
    businessKey: BUSINESS_KEY_CYP,
    legalName: 'Distribuidora C Y P SpA',
    displayName: 'Distribuidora C Y P',
    rut: null, // pendiente del propietario; nunca se inventa
    modeloDeNegocio: 'ECOMMERCE_DISTRIBUCION',
    mercado: 'Chile',
    // Parte de las fuentes ya se observa (sitio, tienda, catálogo) y parte no existe.
    estado: 'SOURCES_PARTIAL',
    categoriasDeclaradas: ['insumos dentales', 'aseo industrial', 'desechables'],
    legacyAliases: [],
    // Ninguna experiencia REAL habilitada: sin política de evaluación no hay nada que evaluar.
    experienciasHabilitadas: [],
    decisionPiloto: null,
    datosHumanosPendientes: [
      'RUT / identificación tributaria',
      'credenciales de lectura de pedidos de WooCommerce (ventas)',
      'Google Ads: customer_id y login_customer_id (si hay cuenta manager)',
      'GA4: property_id (hoy no hay analítica instalada)',
      'Merchant Center: merchant_id',
      'Search Console: propiedad verificada',
      'costos y márgenes desde una fuente autorizada',
      'confirmación de la cobertura y tarifas reales de despacho',
      'contribución comercial real del canal WhatsApp',
    ],
  },

  /** Qué ES el negocio: hechos del discovery. La economía, toda desconocida. */
  perfilComercial: {
    organizationId: ORG_CYP,
    businessModel: 'ECOMMERCE_DISTRIBUCION',
    market: 'CL',
    currency: 'CLP',
    // El checkout admite consumidor final: no se impone B2B puro.
    orientacion: 'B2B_LEAN',
    plataforma: 'WordPress + WooCommerce',
    sitio: SITIO_CYP,
    base: 'Curicó, Región del Maule, Chile',
    canales: [
      {
        canal: 'ECOMMERCE',
        estado: 'OBSERVED',
        // Es el único canal cuyo catálogo SOEC puede leer; su peso en ventas sigue sin medirse.
        contribucionComercial: desconocido('NO_INSTRUMENTADO'),
        detalle: 'tienda WooCommerce pública, catálogo legible sin credenciales',
      },
      {
        canal: 'WHATSAPP',
        estado: 'CONNECTED_UNKNOWN',
        contribucionComercial: desconocido('NO_INSTRUMENTADO'),
        detalle:
          'WhatsApp visible en todo el sitio; opera de verdad, pero su volumen de ventas no es medible por SOEC',
      },
      {
        canal: 'SOCIAL',
        estado: 'OBSERVED',
        contribucionComercial: desconocido('NO_INSTRUMENTADO'),
        detalle: 'presencia en redes observada; sin píxel ni atribución',
      },
    ],
    // Sin línea MÉDICA diferenciada: el discovery no la encontró como vertical propia.
    verticales: ['DENTAL', 'INDUSTRIAL_CLEANING', 'GENERAL_DISPOSABLES'],
    economia: economiaSinMedir('NO_MEDIDO'),
    procedencia: 'discovery de solo lectura sobre el sitio público (2026-08-14)',
  },

  // Sin POLÍTICA de evaluación: no hay objetivo, criterio ni cuenta externa que fijar sin datos.
  perfil: null,

  fuentes: [
    fuente('src-cyp-website', 'sitio-web', 'WEBSITE', 'OBSERVED', []),
    fuente('src-cyp-ecommerce', 'woocommerce', 'ECOMMERCE', 'OBSERVED', []),
    fuente('src-cyp-catalogo', SOURCE_CATALOGO_CYP, 'CATALOG', 'OBSERVED', []),
    fuente('src-cyp-ga4', 'ga4', 'ANALYTICS', 'NOT_CONFIGURED', [
      'no hay GA4 instalado en el sitio',
      'property_id (cuando exista)',
    ]),
    fuente('src-cyp-gtm', 'google-tag-manager', 'TAG_MANAGER', 'NOT_CONFIGURED', [
      'no hay contenedor GTM instalado',
    ]),
    fuente('src-cyp-google-ads', 'google-ads', 'ADS', 'NOT_CONFIGURED', [
      'no hay etiqueta de Google Ads en el sitio',
      'customer_id de C Y P',
      'credencial propia (referencia opaca)',
    ]),
    fuente('src-cyp-merchant-center', 'merchant-center', 'MERCHANT', 'NOT_CONFIGURED', [
      'merchant_id',
      'feed de productos (el catálogo carece de SKU y marca)',
    ]),
    fuente('src-cyp-ventas', 'woocommerce-orders', 'SALES', 'CREDENTIALS_REQUIRED', [
      'credenciales de lectura de la API privada de pedidos',
    ]),
    fuente('src-cyp-pagos', 'pagos', 'PAYMENTS', 'CREDENTIALS_REQUIRED', [
      'acceso al proveedor de pagos para conciliar cobros',
    ]),
    fuente('src-cyp-despacho', 'starken', 'SHIPPING', 'PARTIAL_CONFIGURATION', [
      'cobertura nacional declarada pero no configurada en el checkout',
      'el checkout tiene una única tarifa plana $0 «envío por pagar»: el costo real es externo',
    ]),
    fuente('src-cyp-whatsapp', 'whatsapp', 'MESSAGING', 'CONNECTED_UNKNOWN', [
      'contribución comercial del canal (no medible sin instrumentación)',
    ]),
    fuente('src-cyp-social', 'redes-sociales', 'SOCIAL', 'OBSERVED', [
      'atribución de tráfico y ventas (sin píxel)',
    ]),
    fuente('src-cyp-crm', 'crm', 'CRM', 'NOT_CONFIGURED', [
      'sistema de gestión de clientes, si existe',
    ]),
  ],
};

/** Marcador explícito: el envío «$0» del checkout NO es ingreso ni costo cero. */
export const ENVIO_CYP = {
  proveedorDeclarado: 'STARKEN',
  integracion: 'NINGUNA',
  cobertUraNacionalDeclarada: conocido(1),
  configuracionOperativaNacional: desconocido('NO_APLICA'),
  ingresoDeEnvio: desconocido('PAGO_EXTERNO'),
  costoDeEnvio: desconocido('PAGO_EXTERNO'),
} as const;
