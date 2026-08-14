/**
 * SOEC · DEPÓSITO LOCAL DE CREDENCIALES — pruebas adversariales (FASE 7.1).
 *
 * El depósito es la puerta por la que entrarán las credenciales REALES de WooCommerce de C Y P.
 * Estas pruebas verifican que esa puerta no se pueda usar para cruzar tenants, ni para filtrar el
 * valor de un secreto por una excepción, un log o una serialización.
 *
 * Ningún secreto real aparece aquí: los valores son ficticios y sólo viven en memoria.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import {
  SecretStoreArchivo,
  SecretoDeOtraOrganizacionError,
  SecretoInvalidoError,
  SecretoNoEncontradoError,
  interpretarReferenciaLocal,
} from '@soec/secretos';
import {
  estadoDeposito,
  interpretarDeposito,
  lectorDeDepositoLocal,
  rutaDeposito,
} from '../src/plataforma/deposito-secretos';
import { buscarFuente, buscarFuentes, ORG_SMILEFLOW } from '../src/plataforma';
import { CREDENCIALES_WOO_CYP, ORG_CYP } from '../src/plataforma/negocios/org-cyp';

/** Valor FICTICIO. No es una credencial real y no existe fuera de esta prueba. */
const VALOR_FICTICIO = 'ck_valor-de-prueba-no-real';
const CLAVE = 'woocommerce-cyp-consumer-key';

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return {
    organizationId: o,
    actor: ActorId('t'),
    scope: { organizationId: o, permissions: ['events:read'] },
    correlationId: 'c',
  };
}

/** Crea una raíz temporal con depósitos de las organizaciones indicadas. */
function raizConDepositos(depositos: Record<string, string>): string {
  const raiz = mkdtempSync(resolve(tmpdir(), 'soec-deposito-'));
  mkdirSync(resolve(raiz, '.secrets'));
  for (const [org, contenido] of Object.entries(depositos)) {
    writeFileSync(resolve(raiz, '.secrets', `${org}.env`), contenido, 'utf8');
  }
  return raiz;
}

// ─────────────────────────────────────────────────────────────────────────────
// AISLAMIENTO MULTIEMPRESA DEL DEPÓSITO
// ─────────────────────────────────────────────────────────────────────────────
describe('DEPÓSITO · ninguna organización alcanza la credencial de otra', () => {
  it('org-cyp resuelve SU credencial', async () => {
    const raiz = raizConDepositos({ [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\n` });
    const store = new SecretStoreArchivo(ORG_CYP, lectorDeDepositoLocal(raiz));
    const resuelto = await store.resolver(ctx(ORG_CYP), `file:${ORG_CYP}/${CLAVE}`);
    // El valor sólo existe dentro de `usar`; lo que sale es una longitud, no el secreto.
    expect(resuelto.usar((v) => v.length)).toBe(VALOR_FICTICIO.length);
  });

  it('CYP_CREDENTIALS_NEVER_RESOLVE_FOR_SMILEFLOW — el contexto ajeno se rechaza', async () => {
    const raiz = raizConDepositos({
      [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\n`,
      [ORG_SMILEFLOW]: 'otro=valor-ficticio\n',
    });
    const storeCyp = new SecretStoreArchivo(ORG_CYP, lectorDeDepositoLocal(raiz));
    // SmileFlow pidiendo, con su propio contexto, la credencial de C Y P.
    await expect(
      storeCyp.resolver(ctx(ORG_SMILEFLOW), `file:${ORG_CYP}/${CLAVE}`),
    ).rejects.toBeInstanceOf(SecretoDeOtraOrganizacionError);
  });

  it('SMILEFLOW_CREDENTIALS_NEVER_RESOLVE_FOR_CYP — la dirección inversa también', async () => {
    const raiz = raizConDepositos({
      [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\n`,
      [ORG_SMILEFLOW]: 'smileflow-growth-token=valor-ficticio\n',
    });
    const storeCyp = new SecretStoreArchivo(ORG_CYP, lectorDeDepositoLocal(raiz));
    await expect(
      storeCyp.resolver(ctx(ORG_CYP), `file:${ORG_SMILEFLOW}/smileflow-growth-token`),
    ).rejects.toBeInstanceOf(SecretoDeOtraOrganizacionError);
  });

  it('UNKNOWN_ORGANIZATION_FAILS_CLOSED — sin depósito no hay fallback', async () => {
    const raiz = raizConDepositos({ [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\n` });
    const store = new SecretStoreArchivo('org-inexistente-de-prueba', lectorDeDepositoLocal(raiz));
    await expect(
      store.resolver(ctx('org-inexistente-de-prueba'), 'file:org-inexistente-de-prueba/lo-que-sea'),
    ).rejects.toBeInstanceOf(SecretoNoEncontradoError);
  });

  it('un nombre lógico ausente falla explícitamente, no devuelve vacío', async () => {
    const raiz = raizConDepositos({ [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\n` });
    const store = new SecretStoreArchivo(ORG_CYP, lectorDeDepositoLocal(raiz));
    await expect(
      store.resolver(ctx(ORG_CYP), `file:${ORG_CYP}/woocommerce-cyp-consumer-secret`),
    ).rejects.toBeInstanceOf(SecretoNoEncontradoError);
  });

  it('un valor depositado vacío NO cuenta como credencial', async () => {
    const raiz = raizConDepositos({ [ORG_CYP]: `${CLAVE}=\n` });
    const store = new SecretStoreArchivo(ORG_CYP, lectorDeDepositoLocal(raiz));
    await expect(store.resolver(ctx(ORG_CYP), `file:${ORG_CYP}/${CLAVE}`)).rejects.toBeInstanceOf(
      SecretoNoEncontradoError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REDACCIÓN — el valor no se filtra por ninguna vía
// ─────────────────────────────────────────────────────────────────────────────
describe('REDACCIÓN · el valor de un secreto no escapa', () => {
  it('SECRET_REDACTION — ni por toString, ni por JSON, ni por inspect', async () => {
    const raiz = raizConDepositos({ [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\n` });
    const store = new SecretStoreArchivo(ORG_CYP, lectorDeDepositoLocal(raiz));
    const resuelto = await store.resolver(ctx(ORG_CYP), `file:${ORG_CYP}/${CLAVE}`);

    for (const representacion of [
      String(resuelto),
      JSON.stringify(resuelto),
      inspect(resuelto),
      inspect({ credencial: resuelto }, { depth: 5 }),
      String(store),
      JSON.stringify(store),
      inspect(store),
    ]) {
      expect(representacion).not.toContain(VALOR_FICTICIO);
    }
    expect(JSON.stringify(resuelto)).toContain('[REDACTADO]');
    // La referencia sí es segura de registrar: identifica sin revelar.
    expect(resuelto.secretRef).toBe(`file:${ORG_CYP}/${CLAVE}`);
  });

  it('los mensajes de error nombran la referencia, jamás el valor', async () => {
    const raiz = raizConDepositos({ [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\n` });
    const store = new SecretStoreArchivo(ORG_CYP, lectorDeDepositoLocal(raiz));
    try {
      await store.resolver(ctx(ORG_SMILEFLOW), `file:${ORG_CYP}/${CLAVE}`);
      throw new Error('debió lanzar');
    } catch (e) {
      const texto = `${(e as Error).message}\n${(e as Error).stack ?? ''}`;
      expect(texto).not.toContain(VALOR_FICTICIO);
    }
  });

  it('`usar` rechaza devolver el propio secreto en claro', async () => {
    const raiz = raizConDepositos({ [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\n` });
    const store = new SecretStoreArchivo(ORG_CYP, lectorDeDepositoLocal(raiz));
    const resuelto = await store.resolver(ctx(ORG_CYP), `file:${ORG_CYP}/${CLAVE}`);
    expect(() => resuelto.usar((v) => v)).toThrow(); // FugaDeSecretoError
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FORMA DE LA REFERENCIA
// ─────────────────────────────────────────────────────────────────────────────
describe('REFERENCIA · opaca y bien formada', () => {
  it('interpreta `file:<org>/<nombre>` y rechaza cualquier otra forma', () => {
    expect(interpretarReferenciaLocal(`file:${ORG_CYP}/${CLAVE}`)).toEqual({
      organizationId: ORG_CYP,
      nombreLogico: CLAVE,
    });
    for (const mala of [
      'env:ALGO',
      `file:${ORG_CYP}`,
      'file:/sin-org',
      `file:${ORG_CYP}/`,
      'no-es-ref',
    ]) {
      expect(() => interpretarReferenciaLocal(mala)).toThrow(SecretoInvalidoError);
    }
  });

  it('una referencia con FORMA de secreto se rechaza (no se puede camuflar un valor)', () => {
    expect(() => interpretarReferenciaLocal('file:org-cyp/ck-abc123def456ghi789jkl')).toThrow(
      SecretoInvalidoError,
    );
  });

  it('la configuración de C Y P declara referencias, nunca valores', () => {
    const refs = buscarFuentes(ORG_CYP).flatMap((f) => f.credenciales);
    expect(refs.length).toBeGreaterThan(0);
    for (const c of refs) {
      expect(c.secretRef).toMatch(new RegExp(`^file:${ORG_CYP}/`));
      expect(c.secretRef).not.toMatch(/ck_|cs_|=/); // ninguna forma de credencial WooCommerce
    }
    // La fuente de ventas exige exactamente las dos credenciales de la API privada.
    expect(buscarFuente(ORG_CYP, 'woocommerce-rest-api')?.credenciales).toEqual(
      CREDENCIALES_WOO_CYP,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DEL DEPÓSITO — informa sin revelar
// ─────────────────────────────────────────────────────────────────────────────
describe('ESTADO · qué falta depositar, sin filtrar nada', () => {
  it('distingue ausente / incompleto / completo', () => {
    const nombres = CREDENCIALES_WOO_CYP.map((c) => c.nombreLogico);

    const sinDeposito = raizConDepositos({});
    expect(estadoDeposito(ORG_CYP, nombres, sinDeposito).depositoPresente).toBe(false);
    expect(estadoDeposito(ORG_CYP, nombres, sinDeposito).completo).toBe(false);

    const incompleto = raizConDepositos({ [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\n` });
    const e1 = estadoDeposito(ORG_CYP, nombres, incompleto);
    expect(e1.depositoPresente).toBe(true);
    expect(e1.completo).toBe(false);
    expect(e1.credenciales.find((c) => c.nombreLogico === CLAVE)?.presente).toBe(true);

    const completo = raizConDepositos({
      [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\nwoocommerce-cyp-consumer-secret=cs_ficticio\n`,
    });
    expect(estadoDeposito(ORG_CYP, nombres, completo).completo).toBe(true);
  });

  it('el estado NO contiene valores, longitudes ni fragmentos', () => {
    const raiz = raizConDepositos({ [ORG_CYP]: `${CLAVE}=${VALOR_FICTICIO}\n` });
    const estado = estadoDeposito(ORG_CYP, [CLAVE], raiz);
    const serializado = JSON.stringify(estado);
    expect(serializado).not.toContain(VALOR_FICTICIO);
    expect(serializado).not.toContain(VALOR_FICTICIO.slice(0, 6));
    expect(serializado).not.toMatch(/"longitud"|"length"|"prefijo"/);
  });

  it('la ruta del depósito está bajo `.secrets/` y lleva el nombre de la organización', () => {
    const ruta = rutaDeposito(ORG_CYP, 'C:/ejemplo').replace(/\\/g, '/');
    expect(ruta).toContain('/.secrets/');
    expect(ruta.endsWith(`${ORG_CYP}.env`)).toBe(true);
  });

  it('el analizador ignora comentarios y líneas vacías', () => {
    expect(interpretarDeposito('# comentario\n\nuno=1\n  dos = 2  \nmalformada\n')).toEqual({
      uno: '1',
      dos: '2',
    });
  });
});
