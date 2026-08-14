/**
 * apps/api · PLATAFORMA · COMPOSICIÓN del depósito local de secretos.
 *
 * Único punto del sistema que toca el sistema de archivos para leer credenciales. Aporta el lector
 * que `@soec/secretos` exige inyectado, de modo que el paquete de dominio siga siendo neutral.
 *
 * UBICACIÓN DEL DEPÓSITO
 *
 *     <raíz del repo>/.secrets/<organizationId>.env
 *
 * Formato, una línea por credencial (`nombre-logico=valor`), con `#` para comentarios:
 *
 *     woocommerce-cyp-consumer-key=...
 *     woocommerce-cyp-consumer-secret=...
 *
 * `.secrets/` está en `.gitignore`. NADA de este directorio se versiona, se registra ni se imprime.
 *
 * REGLAS
 *  · un archivo POR ORGANIZACIÓN: leer el de otra es estructuralmente imposible;
 *  · el contenido nunca se devuelve al dominio: sólo dentro de `SecretoResuelto.usar`;
 *  · si el archivo no existe, se devuelve `null` y el `SecretStore` falla EXPLÍCITAMENTE.
 *    No hay fallback a variables de entorno, ni a otra organización, ni a un valor por defecto.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SecretStoreArchivo, type LectorDeDeposito } from '@soec/secretos';
import { assertTenantIdCanonico } from './identidad-organizacion';

/** Directorio del depósito, relativo a la raíz del repositorio. */
export const DIRECTORIO_DEPOSITO = '.secrets';

/** Ruta del depósito de una organización. Se expone para poder INDICARLA, nunca para volcarla. */
export function rutaDeposito(organizationId: string, raiz: string = process.cwd()): string {
  const org = assertTenantIdCanonico(organizationId);
  return resolve(raiz, DIRECTORIO_DEPOSITO, `${org}.env`);
}

/** ¿La persona ya depositó el archivo de esta organización? No revela su contenido. */
export function existeDeposito(organizationId: string, raiz?: string): boolean {
  return existsSync(rutaDeposito(organizationId, raiz));
}

/** Analiza `nombre-logico=valor`. Ignora comentarios y líneas vacías. No registra nada. */
export function interpretarDeposito(contenido: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const cruda of contenido.split('\n')) {
    const linea = cruda.replace(/\r/g, '').trim();
    if (!linea || linea.startsWith('#')) continue;
    const i = linea.indexOf('=');
    if (i <= 0) continue;
    const nombre = linea.slice(0, i).trim();
    const valor = linea.slice(i + 1).trim();
    if (nombre) out[nombre] = valor;
  }
  return out;
}

/** Lector de depósitos respaldado por el sistema de archivos. */
export function lectorDeDepositoLocal(raiz?: string): LectorDeDeposito {
  return (organizationId: string) => {
    const ruta = rutaDeposito(organizationId, raiz);
    if (!existsSync(ruta)) return null;
    return interpretarDeposito(readFileSync(ruta, 'utf8'));
  };
}

/** `SecretStore` del depósito local de UNA organización. Una instancia = un tenant. */
export function depositoDe(organizationId: string, raiz?: string): SecretStoreArchivo {
  return new SecretStoreArchivo(
    assertTenantIdCanonico(organizationId),
    lectorDeDepositoLocal(raiz),
  );
}

/**
 * Estado del depósito para la UI/informe: qué nombres lógicos exige una fuente y cuáles ya están.
 * Devuelve SÓLO nombres y booleanos. Jamás longitudes, prefijos ni fragmentos del valor.
 */
export function estadoDeposito(
  organizationId: string,
  nombresLogicos: readonly string[],
  raiz?: string,
): {
  readonly organizationId: string;
  readonly depositoPresente: boolean;
  readonly ruta: string;
  readonly credenciales: readonly { readonly nombreLogico: string; readonly presente: boolean }[];
  readonly completo: boolean;
} {
  const ruta = rutaDeposito(organizationId, raiz);
  const deposito = lectorDeDepositoLocal(raiz)(organizationId);
  const credenciales = nombresLogicos.map((nombreLogico) => ({
    nombreLogico,
    presente: Boolean(deposito?.[nombreLogico]?.trim()),
  }));
  return {
    organizationId,
    depositoPresente: deposito !== null,
    ruta,
    credenciales,
    completo: credenciales.length > 0 && credenciales.every((c) => c.presente),
  };
}
