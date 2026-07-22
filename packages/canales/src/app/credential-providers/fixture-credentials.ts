/**
 * Proveedor de credenciales FIXTURE de desarrollo (F2-CHAN-01 §8). No usa
 * credenciales reales: mantiene tokens de desarrollo en memoria (nunca en eventos ni
 * logs), distingue organización/canal/cuenta, impide uso cruzado entre organizaciones
 * y soporta revocación. NO inventa tokens válidos externamente: el token solo sirve
 * contra el proveedor emulado.
 */
import type { CanalCredentialProvider, CredencialResuelta, ReferenciaCredencial } from '../../domain/credentials';

/** Token de desarrollo aceptado por el proveedor emulado. No es una credencial real. */
const TOKEN_EMULADO_DEV = 'emu-token-valido-dev';

export class FixtureCredentialProvider implements CanalCredentialProvider {
  /** clave org::canal::cuenta::credId → { token, vigente } */
  private readonly registro = new Map<string, { token: string; vigente: boolean }>();

  constructor() {
    // Credencial de desarrollo por defecto para la cuenta demo (solo contra el emulador).
    this.registrar({ organizationId: 'pyme-chan-demo', canal: 'blog', cuentaLogica: 'cuenta-demo', credencialId: 'cred-demo' });
  }

  private clave(ref: ReferenciaCredencial): string {
    return `${ref.organizationId}::${ref.canal}::${ref.cuentaLogica}::${ref.credencialId}`;
  }

  /** Registra una credencial de desarrollo para cualquier canal de una organización/cuenta. */
  registrar(ref: Omit<ReferenciaCredencial, 'canal'> & { canal: string }): void {
    this.registro.set(this.clave(ref), { token: TOKEN_EMULADO_DEV, vigente: true });
  }
  registrarTodosLosCanales(organizationId: string, cuentaLogica: string, credencialId: string, canales: readonly string[]): void {
    for (const canal of canales) this.registrar({ organizationId, canal, cuentaLogica, credencialId });
  }
  revocar(ref: ReferenciaCredencial): void {
    const v = this.registro.get(this.clave(ref));
    if (v) v.vigente = false;
  }

  async resolver(ref: ReferenciaCredencial): Promise<CredencialResuelta | null> {
    const v = this.registro.get(this.clave(ref));
    if (!v) return null;
    return { ref, token: v.token, vigente: v.vigente };
  }
}
