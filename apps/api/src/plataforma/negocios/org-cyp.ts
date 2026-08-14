/**
 * apps/api · PLATAFORMA MULTIEMPRESA · CONFIGURACIÓN REGISTRADA de `org-cyp`.
 *
 * SEGUNDA ORGANIZACIÓN REAL: **Distribuidora C Y P SpA**. Independiente de `org-smileflow` en
 * identidad, configuración, fuentes, credenciales y evaluación.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * LO QUE SE SABE (declarado por el propietario, no inferido):
 *   · razón social  : Distribuidora C Y P SpA
 *   · actividad     : tienda/distribuidora virtual de insumos médicos, dentales y de aseo
 *   · mercado       : Chile
 *
 * LO QUE NO SE SABE — y por tanto NO SE INVENTA:
 *   RUT · dominio/URL · plataforma de e-commerce · catálogo/SKU · precios · stock · ventas ·
 *   márgenes · medios de pago · despacho · Google Ads · GA4 · Merchant Center · Search Console · CRM.
 *
 * Por eso esta organización:
 *   · NO tiene `perfil` (⇒ `getProfile` lanza BUSINESS_PROFILE_NOT_CONFIGURED). No se copia el
 *     criterio ni la política de SmileFlow, ni se fija ROAS/CPA/ticket/margen sin datos reales.
 *   · NO habilita ninguna experiencia REAL (`experienciasHabilitadas: []`).
 *   · Declara sus fuentes con su estado VERDADERO: ninguna conectada. `CERO ≠ NO CONECTADO`.
 *
 * Las categorías listadas son el CONTEXTO INICIAL declarado, no el catálogo definitivo: el catálogo
 * real debe descubrirse desde la fuente real de C Y P cuando exista.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
import type { ConfiguracionOrganizacion, FuenteRegistrada } from '../tipos';

/** Clave de tenant canónica. Coherente con `org-smileflow`: prefijo `org-` + clave corta. */
export const ORG_CYP = 'org-cyp' as const;
/** Clave de NEGOCIO (dominio), separada del tenant. No es utilizable como `organizationId`. */
export const BUSINESS_KEY_CYP = 'distribuidora-cyp' as const;

/** Fuente declarada pero NO conectada. Nada de esto produce datos todavía. */
function pendiente(
  sourceId: string,
  provider: string,
  tipo: FuenteRegistrada['tipo'],
  faltantes: readonly string[],
): FuenteRegistrada {
  return {
    sourceId,
    organizationId: ORG_CYP,
    provider,
    tipo,
    externalAccountId: null,
    credentialRef: null,
    estado: 'NOT_CONNECTED',
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
    // No es OBSERVING: no hay ninguna fuente conectada de la que observar nada.
    estado: 'SOURCES_PENDING',
    categoriasDeclaradas: ['insumos médicos', 'insumos dentales', 'insumos de aseo'],
    legacyAliases: [],
    // Ninguna experiencia REAL habilitada: sin perfil ni fuentes no hay nada que evaluar.
    experienciasHabilitadas: [],
    decisionPiloto: null,
    datosHumanosPendientes: [
      'RUT / identificación tributaria',
      'dominio o URL de la tienda',
      'plataforma de e-commerce (Shopify/WooCommerce/Jumpseller/propia…)',
      'confirmación de cobertura de despacho (¿todo Chile?)',
      'Google Ads: customer_id y login_customer_id (si hay cuenta manager)',
      'GA4: property_id',
      'Merchant Center: merchant_id',
      'Search Console: propiedad verificada',
      'medios de pago y sistema de despacho',
      'acceso de lectura al catálogo / SKU',
      'historial de ventas (fuente autorizada)',
      'costos y márgenes (fuente autorizada)',
      'credenciales PROPIAS de C Y P (referencia opaca; jamás el valor)',
    ],
  },

  // Sin perfil de evaluación: no hay objetivo, criterio, política ni cuenta externa que fijar sin
  // datos reales. Cualquier intento de evaluar a C Y P falla explícitamente en vez de usar los de otro.
  perfil: null,

  // Inventario HONESTO de fuentes: declaradas, ninguna conectada.
  fuentes: [
    pendiente('src-cyp-website', 'sitio-web', 'WEBSITE', [
      'dominio/URL confirmado por el propietario',
    ]),
    pendiente('src-cyp-ecommerce', 'ecommerce', 'ECOMMERCE', [
      'plataforma de e-commerce',
      'acceso de lectura (API o export)',
    ]),
    pendiente('src-cyp-google-ads', 'google-ads', 'ADS', [
      'customer_id de C Y P',
      'login_customer_id (si aplica)',
      'credencial propia (referencia opaca)',
    ]),
    pendiente('src-cyp-ga4', 'ga4', 'ANALYTICS', ['property_id', 'acceso de lectura']),
    pendiente('src-cyp-merchant-center', 'merchant-center', 'MERCHANT', [
      'merchant_id',
      'acceso de lectura',
    ]),
    pendiente('src-cyp-ventas', 'ventas', 'SALES', ['fuente autorizada de historial de ventas']),
    pendiente('src-cyp-catalogo', 'catalogo', 'CATALOG', ['acceso de lectura al catálogo/SKU']),
    pendiente('src-cyp-crm', 'crm', 'CRM', ['sistema de gestión de clientes, si existe']),
    pendiente('src-cyp-pagos', 'pagos', 'PAYMENTS', ['medios de pago en uso']),
    pendiente('src-cyp-despacho', 'despacho', 'SHIPPING', ['operador y cobertura de despacho']),
  ],
};
