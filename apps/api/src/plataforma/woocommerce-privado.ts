/**
 * apps/api · PLATAFORMA · COMPOSICIÓN del adaptador PRIVADO de WooCommerce por organización.
 *
 * Es el único lugar donde la credencial de una organización se convierte en una cabecera de
 * autorización. Reglas:
 *   · las credenciales se resuelven del DEPÓSITO de esa organización (`file:<org>/…`), nunca del
 *     entorno compartido ni del depósito de otra;
 *   · el valor sólo existe dentro de `SecretoResuelto.usar`; la cabecera se construye ahí dentro y
 *     no se devuelve, ni se registra, ni se guarda en ninguna estructura observable;
 *   · la cabecera viaja SOLO por `Authorization`, jamás en la URL.
 *
 * SEUDONIMIZACIÓN: la clave HMAC con la que se derivan las huellas de cliente es un secreto MÁS de
 * la organización, guardado en su mismo depósito bajo `customer-fingerprint-pepper`. Si no existe,
 * SOEC la GENERA (32 bytes aleatorios) y la añade al depósito: es una clave propia de SOEC, no una
 * credencial de la persona, y sin ella no hay forma de medir recurrencia sin conservar PII.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import {
  WooCommerceRestAdapter,
  type ProveedorDeAutorizacion,
} from '../ingesta/woocommerce-rest-adapter';
import { depositoDe, lectorDeDepositoLocal, rutaDeposito } from './deposito-secretos';
import { buscarFuente, buscarPerfilComercial, getBusiness } from './registro';
import { assertTenantIdCanonico } from './identidad-organizacion';

/** Nombre lógico de la clave de seudonimización. Vive en el depósito de cada organización. */
export const NOMBRE_PEPPER = 'customer-fingerprint-pepper';

function ctxDe(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('ingesta-ventas'),
    scope: { organizationId: o, permissions: ['events:read'] },
    correlationId: `ventas-${org}`,
  };
}

/**
 * Clave HMAC de la organización. La crea si falta, con material aleatorio, y la deja en el depósito.
 * Devuelve el valor porque HMAC lo exige — el llamador NO debe registrarlo ni serializarlo.
 */
export function claveDeHuellaDe(
  organizationId: string,
  raiz?: string,
): { clave: string; generada: boolean } {
  const org = assertTenantIdCanonico(organizationId);
  const ruta = rutaDeposito(org, raiz);
  const existente = lectorDeDepositoLocal(raiz)(org)?.[NOMBRE_PEPPER]?.trim();
  if (existente) return { clave: existente, generada: false };

  if (!existsSync(ruta)) {
    throw new Error(
      `no existe depósito para '${org}': no puede generarse la clave de seudonimización`,
    );
  }
  const clave = randomBytes(32).toString('base64url');
  appendFileSync(
    ruta,
    `\n# Clave de seudonimización de clientes generada por SOEC. No la borres: si cambia, las\n` +
      `# huellas de cliente cambian y la recurrencia histórica deja de coincidir.\n` +
      `${NOMBRE_PEPPER}=${clave}\n`,
    'utf8',
  );
  return { clave, generada: true };
}

/**
 * Base de la REST API privada. Se DERIVA del sitio declarado en el perfil comercial de la
 * organización: este módulo no fija ninguna URL, de modo que sirve a cualquier tienda WooCommerce.
 */
export function baseRestDe(organizationId: string): string {
  const negocio = getBusiness(organizationId); // lanza si no está registrada
  if (!buscarFuente(organizationId, 'woocommerce-rest-api')) {
    throw new Error(
      `la organización '${negocio.organizationId}' no declara fuente 'woocommerce-rest-api'`,
    );
  }
  const sitio = buscarPerfilComercial(organizationId)?.sitio;
  if (!sitio) {
    throw new Error(
      `la organización '${negocio.organizationId}' no declara sitio en su perfil comercial`,
    );
  }
  return `${sitio.replace(/\/+$/, '')}/wp-json/wc/v3`;
}

/**
 * Proveedor de la cabecera `Authorization: Basic`. El valor de las credenciales sólo existe dentro
 * de `usar`; lo que sale es la cabecera ya construida, que el adaptador usa y nunca registra.
 */
export function autorizacionBasicaDe(
  organizationId: string,
  raiz?: string,
): ProveedorDeAutorizacion {
  const org = assertTenantIdCanonico(organizationId);
  const store = depositoDe(org, raiz);
  const ctx = ctxDe(org);
  const fuente = buscarFuente(org, 'woocommerce-rest-api');
  if (!fuente) throw new Error(`la organización '${org}' no declara fuente 'woocommerce-rest-api'`);

  const refDe = (nombreLogico: string): string => {
    const c = fuente.credenciales.find((x) => x.nombreLogico === nombreLogico);
    if (!c) throw new Error(`la fuente no declara la credencial '${nombreLogico}'`);
    return c.secretRef;
  };

  return async () => {
    const clave = await store.resolver(ctx, refDe('woocommerce-cyp-consumer-key'));
    const secreto = await store.resolver(ctx, refDe('woocommerce-cyp-consumer-secret'));
    // Los dos valores viven sólo aquí dentro. El resultado es la cabecera, nunca un secreto suelto.
    return clave.usar((k) =>
      secreto.usar((s) => `Basic ${Buffer.from(`${k}:${s}`).toString('base64')}`),
    );
  };
}

/** Adaptador privado de lectura de ventas para UNA organización. */
export function adaptadorVentasDe(organizationId: string, raiz?: string): WooCommerceRestAdapter {
  const org = assertTenantIdCanonico(organizationId);
  const { clave } = claveDeHuellaDe(org, raiz);
  return new WooCommerceRestAdapter({
    baseUrl: baseRestDe(org),
    autorizacion: autorizacionBasicaDe(org, raiz),
    claveDeHuella: clave,
  });
}

/** ¿Está el depósito completo para leer ventas? Sólo booleanos; jamás valores. */
export function credencialesDeVentasListas(organizationId: string, raiz?: string): boolean {
  const fuente = buscarFuente(organizationId, 'woocommerce-rest-api');
  if (!fuente) return false;
  const deposito = lectorDeDepositoLocal(raiz)(organizationId);
  if (!deposito) return false;
  return fuente.credenciales.every((c) => Boolean(deposito[c.nombreLogico]?.trim()));
}

/** Utilidad de diagnóstico: nunca devuelve el contenido del depósito. */
export function rutaDelDeposito(organizationId: string, raiz?: string): string {
  return rutaDeposito(organizationId, raiz);
}

/** Lectura defensiva del depósito para comprobaciones: devuelve sólo los nombres presentes. */
export function nombresDepositados(organizationId: string, raiz?: string): readonly string[] {
  const ruta = rutaDeposito(organizationId, raiz);
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => l.slice(0, l.indexOf('=')).trim())
    .filter(Boolean);
}
