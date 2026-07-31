/**
 * Avisos permanentes de la vista de Programas. Extraídos como constantes para poder verificar en
 * pruebas que contienen los conceptos inequívocos (piloto, sin autenticación multi-tenant,
 * simulado, pausa por organización) sin snapshots frágiles de toda la página.
 */
export const AVISO_SIMULACION =
  'No se ejecutan campañas reales. No se realiza gasto real. Todos los resultados de esta versión son simulados.';

export const AVISO_PILOTO_SIN_AUTH =
  'Entorno piloto con datos sintéticos. Esta versión no dispone de autenticación multi-tenant.';

export const AVISO_PAUSA_ORG =
  'La autonomía se controla por organización en esta versión. Pausar detendrá la ejecución de todos los programas de esta organización.';

export const MSG_ORG_PAUSADA = 'Organización pausada';
export const MSG_ORG_REANUDADA = 'Organización reanudada';
