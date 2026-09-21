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

/**
 * La organización no declara embudo de conversión y su perfil tampoco aporta `directorContext`.
 * NO se hereda el embudo de otra organización: se lanza.
 */
export class EmbudoNoConfiguradoError extends PlataformaError {
  constructor(org: string) {
    super(
      `la organización '${org}' no tiene embudo de conversión configurado`,
      'CONVERSION_FUNNEL_NOT_CONFIGURED',
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

/**
 * La CAPACIDAD que exige la experiencia no está habilitada para el negocio (Autonomy Fase B).
 *
 * Es distinto de «el negocio no existe» y de «falta la conexión»: el negocio existe, es válido y alguien
 * —una persona— decidió no habilitar esto. La respuesta nombra la capacidad para que la interfaz pueda
 * ofrecer habilitarla, en lugar de decir que la organización «no está en el registro».
 */
export class CapacidadNoHabilitadaError extends PlataformaError {
  constructor(
    readonly org: string,
    readonly capacidad: string,
    readonly experiencia: string,
  ) {
    super(
      `el negocio '${org}' no tiene habilitada la capacidad '${capacidad}' que requiere '${experiencia}'`,
      'CAPABILITY_NOT_ENABLED',
      403,
    );
  }
}

/**
 * La capacidad está habilitada, pero falta la CONEXIÓN que necesita para operar. Un negocio recién creado
 * está exactamente aquí: es válido y no le falta permiso — le falta conectar su cuenta.
 */
export class ConexionRequeridaError extends PlataformaError {
  constructor(
    readonly org: string,
    readonly requerida: string,
    readonly detalle: string,
  ) {
    super(
      `el negocio '${org}' necesita ${detalle} antes de ejecutar esta operación`,
      'CONNECTION_REQUIRED',
      409,
    );
  }
}

/**
 * El negocio existe y tiene la capacidad, pero su PERFIL DE EVALUACIÓN está incompleto (sin objetivo,
 * criterio ni política). No es un fallo de configuración de la plataforma: es información del negocio que
 * todavía no se ha aportado, y se dice así.
 */
export class PerfilIncompletoError extends PlataformaError {
  constructor(
    readonly org: string,
    readonly faltantes: readonly string[],
  ) {
    super(
      `el negocio '${org}' tiene el perfil de evaluación incompleto: falta ${faltantes.join(', ')}`,
      'PROFILE_INCOMPLETE',
      409,
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
