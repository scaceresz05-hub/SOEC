/**
 * Fixtures del plano de canales (F2-CHAN-01). Cuenta lógica y credencial de
 * DESARROLLO (contra el proveedor emulado), y canales del piloto. Ningún dato real
 * ni credencial real.
 */
export const IDS_CHAN = {
  org: 'pyme-chan-demo',
  cuentaLogica: 'cuenta-demo',
  credencialId: 'cred-demo',
} as const;

/** Canales que el piloto intenta publicar (deben estar autorizados por la política). */
export const CANALES_PILOTO = ['blog', 'linkedin', 'correo', 'instagram'] as const;
