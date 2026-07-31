/**
 * @soec/identity — Fundación de identidad y autorización multi-tenant (Macrobloque 1).
 * Autenticación por sesión (cookie httpOnly), organizaciones/usuarios/membresías/roles/permisos,
 * modos operativos (AUTONOMOUS_REAL bloqueado), auditoría. La autoridad de organización proviene
 * de la sesión + membresía activa, NUNCA del identificador de URL. Ver ADR-005.
 */
export * from './domain/roles';
export * from './domain/modo';
export * from './domain/password';
export * from './domain/entities';
export * from './domain/errors';
export * from './application/identity-service';
export * from './application/bootstrap';
