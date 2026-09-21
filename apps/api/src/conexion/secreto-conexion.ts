/**
 * apps/api · CONEXIONES COMO DATO · depósito de credenciales de conexión.
 *
 * REUTILIZA, sin inventar nada nuevo, el mecanismo seguro que ya protege los tokens de Google Ads y Meta:
 * `EnvelopeSecretBackend` (AES-256-GCM con data key aleatoria por secreto, envuelta por una master key que
 * vive en un KMS real detrás de `KmsPort`). Lo único propio es la tabla de ciphertext.
 *
 * POR QUÉ IMPORTA: sin esto, conectar una empresa nueva exigiría una variable de entorno por empresa —y por
 * tanto un despliegue— que es exactamente la dependencia que esta fase elimina. El token del puente M2M de
 * una empresa creada desde la interfaz se cifra y se guarda por tenant, igual que un token OAuth.
 *
 * FAIL-CLOSED: sin KMS configurado (`AWS_REGION`, `SOEC_KMS_KEY_ID`, credenciales) NO se construye depósito.
 * No hay modo degradado que guarde el token en claro «mientras tanto»: no guardar es la respuesta correcta.
 */
import type { Pool } from 'pg';
import type { RequestContext } from '@soec/contracts';
import { SecretStoreEnv, type SecretStore, type SecretoResuelto } from '@soec/secretos';
import { AwsKmsPort, type ConfigAwsKms } from '../acquisition/aws-kms';
import { ClienteKmsSdk } from '../acquisition/aws-kms-sdk';
import { EnvelopeSecretBackend } from '../acquisition/meta-secret-backend';
import { PgConexionCiphertextStore } from './conexion-pg';

type Env = Record<string, string | undefined>;

function configKmsDesdeEnv(env: Env): ConfigAwsKms | null {
  const region = env['AWS_REGION'];
  const keyId = env['SOEC_KMS_KEY_ID'];
  if (!region || !keyId || !env['AWS_ACCESS_KEY_ID'] || !env['AWS_SECRET_ACCESS_KEY']) return null;
  const timeoutMs = Number(env['SOEC_KMS_TIMEOUT_MS'] ?? '5000');
  const maxAttempts = Number(env['SOEC_KMS_MAX_ATTEMPTS'] ?? '3');
  return {
    region,
    keyId,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts >= 1 ? maxAttempts : 3,
  };
}

/** Depósito de credenciales de conexión: escribe cifrado, resuelve por referencia y revoca. */
export interface DepositoSecretosConexion {
  readonly esProductivo: boolean;
  /** Guarda el valor cifrado y devuelve su REFERENCIA opaca. El valor nunca vuelve a salir de aquí. */
  almacenar(organizationId: string, nombreLogico: string, valor: string): Promise<{ readonly secretRef: string }>;
  resolver(ctx: RequestContext, secretRef: string): Promise<SecretoResuelto>;
  revocar(secretRef: string): Promise<void>;
}

/**
 * Compone el depósito sobre el MISMO KMS que el resto de la plataforma. Devuelve `null` si el KMS no está
 * configurado en este despliegue: quien lo llame debe decir «no se puede guardar la credencial», no guardarla.
 */
export function crearDepositoSecretosConexion(pool: Pool, env: Env): DepositoSecretosConexion | null {
  const cfg = configKmsDesdeEnv(env);
  if (cfg === null) return null;
  const backend = new EnvelopeSecretBackend(new AwsKmsPort(cfg, new ClienteKmsSdk(cfg)), new PgConexionCiphertextStore(pool));
  return {
    esProductivo: backend.esProductivo,
    almacenar: (org, nombre, valor) => backend.almacenar(org, nombre, valor),
    resolver: (ctx, ref) => backend.resolver(ctx, ref),
    revocar: (ref) => backend.revocar(ref),
  };
}

/**
 * SecretStore COMPUESTO: resuelve cada referencia con el backend que le corresponde por su esquema.
 *
 * Existe porque durante la transición conviven dos procedencias legítimas: las credenciales históricas
 * declaradas como `env:NOMBRE` (SmileFlow, CP) y las nuevas `secretstore:<org>/<nombre>` cifradas por tenant.
 * Una empresa nueva SIEMPRE cae en la segunda; la primera es compatibilidad, no diseño.
 *
 * Una referencia de esquema desconocido no se «intenta con el primero que haya»: se rechaza.
 */
export class SecretStoreCompuesto implements SecretStore {
  readonly nombre = 'compuesto';

  constructor(
    private readonly porEsquema: ReadonlyArray<{ readonly prefijo: string; readonly store: SecretStore }>,
  ) {}

  async resolver(ctx: RequestContext, secretRef: string): Promise<SecretoResuelto> {
    const elegido = this.porEsquema.find((e) => secretRef.startsWith(e.prefijo));
    if (!elegido) throw new Error(`no hay backend de secretos para la referencia '${secretRef.split(':')[0] ?? ''}:'`);
    return elegido.store.resolver(ctx, secretRef);
  }

  toString(): string {
    return `SecretStoreCompuesto(${this.porEsquema.map((e) => e.prefijo).join(',')} · [REDACTED])`;
  }
}

/**
 * Almacén de secretos que el runtime usa para LEER credenciales de fuentes: entorno (legado) + depósito
 * cifrado por tenant (nuevo). Si el KMS no está configurado, queda sólo el entorno — y una empresa nueva
 * simplemente no tiene fuente que leer, que es la verdad.
 */
export function crearAlmacenDeLecturaDeSecretos(deposito: DepositoSecretosConexion | null, env: Env): SecretStore {
  const partes: Array<{ prefijo: string; store: SecretStore }> = [
    { prefijo: 'env:', store: new SecretStoreEnv(env) },
  ];
  if (deposito !== null) {
    partes.push({
      prefijo: 'secretstore:',
      store: { nombre: 'envelope-kms', resolver: (ctx, ref) => deposito.resolver(ctx, ref) },
    });
  }
  return new SecretStoreCompuesto(partes);
}
