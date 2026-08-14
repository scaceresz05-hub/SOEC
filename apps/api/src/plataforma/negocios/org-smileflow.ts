/**
 * apps/api · PLATAFORMA MULTIEMPRESA · CONFIGURACIÓN REGISTRADA de `org-smileflow`.
 *
 * SmileFlow deja de ser el centro conceptual de SOEC y pasa a ser lo que siempre debió ser: UNA
 * organización con su propia configuración registrada. Nada de lo que hay aquí es universal, y
 * ninguna otra organización puede resolverlo (el registro es por clave de tenant exacta).
 *
 * Los valores comerciales (criterio, política, límites, campaña) NO cambian respecto de lo que ya
 * gobernaba a SmileFlow: se MUEVEN desde el camino genérico a su configuración propia.
 *
 * Sin secretos: las credenciales aparecen sólo como referencias opacas `env:NOMBRE`.
 */
import {
  CAMPANIA_SMILEFLOW,
  CRITERIO_SMILEFLOW,
  GASTO_AUTORIZADO_SMILEFLOW,
  OBJETIVO_SMILEFLOW,
  POLICY_SMILEFLOW,
} from '../../real-director/criterio-smileflow';
import { LIMITES_SMILEFLOW } from '../../autonomia-ads/limites-smileflow';
import { desconocido } from '@soec/comercio';
import { BUSINESS_KEY_SMILEFLOW, ORG_SMILEFLOW, aliasLegados } from '../identidad-organizacion';
import { economiaSinMedir } from '../tipos';
import type { ConfiguracionOrganizacion } from '../tipos';

/** Cuenta de Google Ads gobernada por SmileFlow. Antes era el `CONFINAMIENTO` global de la plataforma. */
const ADS_SMILEFLOW = {
  customerId: '8605539300',
  loginCustomerId: '1742063041',
  campaignId: CAMPANIA_SMILEFLOW.campaignId,
  campaniaRef: CAMPANIA_SMILEFLOW.campaniaRef,
  actividadId: CAMPANIA_SMILEFLOW.actividadId,
  canal: CAMPANIA_SMILEFLOW.canal,
  nombreCampania: CAMPANIA_SMILEFLOW.nombre,
} as const;

export const CONFIGURACION_ORG_SMILEFLOW: ConfiguracionOrganizacion = {
  negocio: {
    organizationId: ORG_SMILEFLOW,
    businessKey: BUSINESS_KEY_SMILEFLOW,
    legalName: 'SmileFlow Clinic',
    displayName: 'SmileFlow Clinic',
    // La identidad legal sigue siendo un pendiente del propietario (ver expediente del piloto).
    rut: null,
    modeloDeNegocio: 'SAAS_FUNNEL',
    mercado: 'Chile',
    estado: 'OBSERVING',
    categoriasDeclaradas: ['clínica dental', 'software de gestión dental'],
    legacyAliases: aliasLegados(),
    experienciasHabilitadas: ['medicion-real', 'director-real', 'autonomia-ads', 'piloto-decision'],
    decisionPiloto: {
      businessKey: BUSINESS_KEY_SMILEFLOW,
      expedienteId: 'exp-smileflow-piloto-1',
      nombreComercial: 'SmileFlow Clinic',
    },
    datosHumanosPendientes: ['identidad legal (nombre legal y RUT)'],
  },
  /** Qué ES SmileFlow. Su economía tampoco se inventa: se mide o se declara desconocida. */
  perfilComercial: {
    organizationId: ORG_SMILEFLOW,
    businessModel: 'SAAS_FUNNEL',
    market: 'CL',
    currency: 'CLP',
    orientacion: 'B2B_LEAN',
    plataforma: null,
    sitio: null,
    base: 'Chile',
    canales: [
      {
        canal: 'ECOMMERCE',
        estado: 'NOT_APPLICABLE',
        contribucionComercial: desconocido('NO_APLICA'),
        detalle: 'no vende productos: capta solicitudes de demostración',
      },
    ],
    verticales: ['DENTAL_SAAS'],
    economia: economiaSinMedir('NO_MEDIDO'),
    procedencia: 'declaración del propietario + observación de Google Ads y Growth',
  },

  perfil: {
    organizationId: ORG_SMILEFLOW,
    modeloDeNegocio: 'SAAS_FUNNEL',
    objetivoId: OBJETIVO_SMILEFLOW,
    criterio: CRITERIO_SMILEFLOW,
    policy: POLICY_SMILEFLOW,
    gastoAutorizado: GASTO_AUTORIZADO_SMILEFLOW,
    limitesAutonomia: LIMITES_SMILEFLOW,
    externalResourceRefs: { googleAds: ADS_SMILEFLOW },
    cuentasExternas: [
      {
        proveedor: 'google-ads',
        externalAccountId: ADS_SMILEFLOW.customerId,
        loginAccountId: ADS_SMILEFLOW.loginCustomerId,
        credentialRef: 'env:GOOGLE_ADS_REFRESH_TOKEN',
        estado: 'CONNECTED_READ_ONLY',
      },
      {
        proveedor: 'growth-api',
        externalAccountId: null,
        loginAccountId: null,
        credentialRef: 'env:SMILEFLOW_GROWTH_TOKEN',
        estado: 'CONNECTED_READ_ONLY',
      },
    ],
    directorContext: {
      descripcion:
        'SaaS/clínica dental: la adquisición se mide por solicitudes de demostración y leads calificados, no por pedidos.',
      conversionPrimaria: 'demo_requested',
      conversionesSecundarias: ['demo_cta_clicked', 'demo_form_started', 'lead_created'],
      vocabulario: ['demo', 'lead', 'CAC', 'tasa de conversión', 'trial'],
    },
  },
  fuentes: [
    {
      sourceId: 'src-smileflow-google-ads',
      organizationId: ORG_SMILEFLOW,
      provider: 'google-ads',
      tipo: 'ADS',
      externalAccountId: ADS_SMILEFLOW.customerId,
      credentialRef: 'env:GOOGLE_ADS_REFRESH_TOKEN',
      estado: 'CONNECTED_READ_ONLY',
      soloLectura: true,
      faltantes: [],
    },
    {
      sourceId: 'src-smileflow-growth',
      organizationId: ORG_SMILEFLOW,
      provider: 'smileflow-growth',
      tipo: 'GROWTH',
      externalAccountId: null,
      credentialRef: 'env:SMILEFLOW_GROWTH_TOKEN',
      estado: 'CONNECTED_READ_ONLY',
      soloLectura: true,
      faltantes: [],
    },
  ],
};
