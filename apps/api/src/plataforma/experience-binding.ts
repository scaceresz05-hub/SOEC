/**
 * apps/api · PLATAFORMA MULTIEMPRESA · BINDING EXPLÍCITO ORGANIZACIÓN ↔ EXPERIENCIA (D-4).
 *
 * El gateway autenticado garantiza SEGURIDAD (sesión + membresía) e inyecta el contexto autoritativo,
 * pero eso NO garantiza que la experiencia ejecutada pertenezca a esa organización: las experiencias
 * "reales" resolvían su organización desde constantes de módulo.
 *
 * `bindExperienciaReal` es la puerta obligatoria antes de ejecutar cualquier experiencia REAL. Valida,
 * en este orden y FAIL-CLOSED:
 *
 *   1. el `organizationId` del contexto es una clave de tenant CANÓNICA (no un alias legado);
 *   2. el alcance del contexto corresponde a esa misma organización (`requireScope`);
 *   3. el negocio EXISTE (404 sólo si no existe negocio alguno con esa clave);
 *   4. la CAPACIDAD que la experiencia requiere está habilitada → si no, 403 `CAPABILITY_NOT_ENABLED`;
 *   5. la CONEXIÓN que la experiencia necesita está conectada → si no, 409 `CONNECTION_REQUIRED`;
 *   6. el perfil de evaluación existe → si no, 409 `PROFILE_INCOMPLETE`;
 *   7. negocio, perfil y fuentes pertenecen todos a la MISMA organización (invariante estructural).
 *
 * LO QUE CAMBIA EN LA FASE B (conexiones como dato): los pasos 3–6 se resuelven contra datos PERSISTIDOS
 * (perfil, capacidades y conexiones en PostgreSQL, proyectados al resolutor) y cada negativa dice LA VERDAD
 * OPERATIVA: falta una capacidad, falta una conexión o falta información del negocio. Ninguna respuesta dice
 * ya «la organización no está en el registro», porque un negocio recién creado desde la interfaz es un
 * negocio válido y esa frase describía un detalle de implementación, no su situación.
 *
 * No se confía en: nombre de ruta, query param, cabecera del cliente, campaignId, ni configuración
 * global. La única autoridad es el `RequestContext` que produjo el gateway.
 */
import { requireScope, type RequestContext } from '@soec/contracts';
import {
  BindingDeExperienciaInvalidoError,
  CapacidadNoHabilitadaError,
  ConexionRequeridaError,
  PerfilIncompletoError,
} from './errors';
import { assertTenantIdCanonico } from './identidad-organizacion';
import { getBusiness, buscarProfile, buscarFuentes, faltantesDePerfilDeEvaluacion } from './registro';
import {
  ESTADOS_CON_LECTURA,
  type BusinessEvaluationProfile,
  type ExperienciaReal,
  type FuenteRegistrada,
  type NegocioRegistrado,
  type TipoFuente,
} from './tipos';

export interface OrganizationExperienceBinding {
  readonly organizationId: string;
  readonly experiencia: ExperienciaReal;
  readonly negocio: NegocioRegistrado;
  readonly perfil: BusinessEvaluationProfile;
  readonly fuentes: readonly FuenteRegistrada[];
}

/**
 * Nombre de la CAPACIDAD persistida que habilita cada experiencia. Es la misma traducción que usa el módulo
 * de conexiones; se declara aquí para que la plataforma no dependa de él (y no haya ciclo de importación).
 */
const CAPACIDAD_DE: Readonly<Record<ExperienciaReal, string>> = {
  'medicion-real': 'MEDICION_REAL',
  'director-real': 'DIRECTOR_REAL',
  'autonomia-ads': 'AUTONOMIA_ADS',
  'piloto-decision': 'PILOTO_DECISION',
};

/**
 * Conexión que cada experiencia NECESITA para operar de verdad. Sólo se declara cuando la experiencia es
 * inejecutable sin ella: inventar requisitos convertiría un 200 honesto en un 409 falso.
 */
const CONEXION_DE: Partial<Record<ExperienciaReal, { readonly tipo: TipoFuente; readonly detalle: string }>> = {
  'autonomia-ads': { tipo: 'ADS', detalle: 'conectar su cuenta de publicidad' },
};

/**
 * Vincula la organización AUTENTICADA con la experiencia solicitada. Lanza si algo no cuadra.
 * Nunca devuelve un binding de otra organización, ni un binding "por defecto".
 */
export function bindExperienciaReal(
  ctx: RequestContext,
  experiencia: ExperienciaReal,
): OrganizationExperienceBinding {
  // (1) identidad canónica: un alias legado NO es un tenant.
  const org = assertTenantIdCanonico(String(ctx.organizationId));

  // (2) el alcance debe corresponder a la organización del contexto (defensa ante contexto forjado).
  requireScope(ctx, 'events:read');

  // (3) el negocio existe (404 ORGANIZATION_NOT_CONFIGURED sólo si no existe ninguno con esa clave).
  const negocio = getBusiness(org);

  // (4) CAPACIDAD habilitada para ESTE negocio. Persistida: una persona la enciende, nadie la hereda.
  const capacidad = CAPACIDAD_DE[experiencia];
  if (capacidad === undefined) {
    // Experiencia fuera del vocabulario: es una llamada mal formada, no una decisión del negocio.
    throw new BindingDeExperienciaInvalidoError(org, experiencia, 'experiencia desconocida');
  }
  if (!negocio.experienciasHabilitadas.includes(experiencia)) {
    throw new CapacidadNoHabilitadaError(org, capacidad, experiencia);
  }

  const fuentes = buscarFuentes(org);

  // (5) CONEXIÓN necesaria, si la experiencia la exige. «Falta conectar» ≠ «no tienes permiso».
  const requisito = CONEXION_DE[experiencia];
  if (requisito) {
    const conectada = fuentes.some((f) => f.tipo === requisito.tipo && ESTADOS_CON_LECTURA.includes(f.estado));
    if (!conectada) throw new ConexionRequeridaError(org, requisito.tipo, requisito.detalle);
  }

  // (6) perfil de evaluación (409 PROFILE_INCOMPLETE si el negocio existe pero su política no está definida).
  //     Los motivos son los REALES de su política persistida (Fase C), no una lista genérica: la interfaz puede
  //     pedir exactamente lo que falta.
  const perfil = buscarProfile(org);
  if (perfil === null) {
    const faltantes = faltantesDePerfilDeEvaluacion(org);
    throw new PerfilIncompletoError(org, faltantes.length > 0 ? faltantes : ['primaryObjective', 'primaryConversionEvent', 'primaryKpi', 'successCriterion']);
  }

  // (7) invariante estructural: todo pertenece a la MISMA organización.
  const ajenas = [
    negocio.organizationId !== org,
    perfil.organizationId !== org,
    ...fuentes.map((f) => f.organizationId !== org),
  ];
  if (ajenas.some(Boolean)) {
    throw new BindingDeExperienciaInvalidoError(
      org,
      experiencia,
      'la configuración resuelta pertenece a otra organización',
    );
  }

  return { organizationId: org, experiencia, negocio, perfil, fuentes };
}
