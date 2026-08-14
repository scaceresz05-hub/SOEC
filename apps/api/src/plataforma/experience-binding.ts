/**
 * apps/api · PLATAFORMA MULTIEMPRESA · BINDING EXPLÍCITO ORGANIZACIÓN ↔ EXPERIENCIA (D-4).
 *
 * El gateway autenticado garantiza SEGURIDAD (sesión + membresía) e inyecta el contexto autoritativo,
 * pero eso NO garantizaba que la experiencia ejecutada perteneciera a esa organización: las
 * experiencias "reales" resolvían su organización desde constantes de módulo.
 *
 * `bindExperienciaReal` es la puerta obligatoria antes de ejecutar cualquier experiencia REAL. Valida,
 * en este orden y FAIL-CLOSED:
 *
 *   1. el `organizationId` del contexto es una clave de tenant CANÓNICA (no un alias legado);
 *   2. el alcance del contexto corresponde a esa misma organización (`requireScope`);
 *   3. la organización está REGISTRADA como negocio;
 *   4. la experiencia está HABILITADA para esa organización;
 *   5. existe perfil de evaluación;
 *   6. negocio, perfil y fuentes pertenecen todos a la MISMA organización (invariante estructural).
 *
 * No se confía en: nombre de ruta, query param, cabecera del cliente, campaignId, ni configuración
 * global. La única autoridad es el `RequestContext` que produjo el gateway.
 */
import { requireScope, type RequestContext } from '@soec/contracts';
import { BindingDeExperienciaInvalidoError } from './errors';
import { assertTenantIdCanonico } from './identidad-organizacion';
import { getBusiness, getProfile, buscarFuentes } from './registro';
import type {
  BusinessEvaluationProfile,
  ExperienciaReal,
  FuenteRegistrada,
  NegocioRegistrado,
} from './tipos';

export interface OrganizationExperienceBinding {
  readonly organizationId: string;
  readonly experiencia: ExperienciaReal;
  readonly negocio: NegocioRegistrado;
  readonly perfil: BusinessEvaluationProfile;
  readonly fuentes: readonly FuenteRegistrada[];
}

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

  // (3) negocio registrado (404 NOT_CONFIGURED si no existe).
  const negocio = getBusiness(org);

  // (4) experiencia habilitada para ESTA organización.
  if (!negocio.experienciasHabilitadas.includes(experiencia)) {
    throw new BindingDeExperienciaInvalidoError(
      org,
      experiencia,
      'la experiencia no está habilitada para esta organización',
    );
  }

  // (5) perfil de evaluación (409 BUSINESS_PROFILE_NOT_CONFIGURED si falta).
  const perfil = getProfile(org);

  // (6) invariante estructural: todo pertenece a la MISMA organización.
  const fuentes = buscarFuentes(org);
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
