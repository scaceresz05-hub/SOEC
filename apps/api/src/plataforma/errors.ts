/**
 * apps/api · PLATAFORMA MULTIEMPRESA · Errores explícitos. Nada falla en silencio y NADA cae por
 * defecto en otra organización: cada error nombra exactamente qué falta y para qué organización.
 *
 * Regla invariable: la ausencia de negocio, perfil o fuente NUNCA se resuelve usando la
 * configuración de otra organización. Se lanza. FAIL-CLOSED.
 */
export class PlataformaError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** La organización no existe en el registro de negocios (no está configurada). */
export class OrganizacionNoRegistradaError extends PlataformaError {
  constructor(org: string) {
    super(
      `la organización '${org}' no está registrada como negocio en SOEC`,
      'ORGANIZATION_NOT_CONFIGURED',
      404,
    );
  }
}

/** La organización existe pero no tiene perfil de evaluación de negocio. */
export class BusinessProfileNoConfiguradoError extends PlataformaError {
  constructor(org: string) {
    super(
      `la organización '${org}' no tiene BusinessEvaluationProfile configurado`,
      'BUSINESS_PROFILE_NOT_CONFIGURED',
      409,
    );
  }
}

/** La organización no tiene ninguna fuente de datos registrada (no es lo mismo que "cero datos"). */
export class SinFuenteDeDatosError extends PlataformaError {
  constructor(org: string, detalle?: string) {
    super(
      `la organización '${org}' no tiene fuente de datos configurada${detalle ? `: ${detalle}` : ''}`,
      'NO_DATA_SOURCE_CONFIGURED',
      409,
    );
  }
}

/** Se usó un alias legado (businessKey / slug histórico) como identificador de tenant. */
export class IdentidadOrganizacionInvalidaError extends PlataformaError {
  constructor(valor: string, motivo: string) {
    super(
      `identificador de organización inválido '${valor}': ${motivo}`,
      'INVALID_ORGANIZATION_IDENTIFIER',
      400,
    );
  }
}

/** La organización autenticada no puede ejecutar esa experiencia (binding ausente o discordante). */
export class BindingDeExperienciaInvalidoError extends PlataformaError {
  constructor(org: string, experiencia: string, motivo: string) {
    super(
      `la organización '${org}' no puede ejecutar la experiencia '${experiencia}': ${motivo}`,
      'EXPERIENCE_BINDING_DENIED',
      403,
    );
  }
}
