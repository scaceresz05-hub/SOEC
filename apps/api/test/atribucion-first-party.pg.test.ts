/**
 * ATRIBUCIÓN FIRST-PARTY sobre PostgreSQL real — una intención, una atribución.
 *
 * El `ref` lo genera el sitio en el mismo gesto del clic. Si la ingesta se repite, si alguien reintenta o si
 * un redespliegue reprocesa la cola, la misma intención NO puede convertirse en dos atribuciones: la clave
 * primaria lo impide en la base, no un `if` que alguien pueda olvidar.
 *
 * Y lo que se guarda es lo que se necesita para evaluar el piloto: de qué campaña vino un clic. Ni teléfono,
 * ni nombre, ni correo, ni IP, ni el texto del mensaje.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { atribucionMigrations, RepositorioAtribucion } from '../src/atribucion/atribucion-pg';

const pool = makeTestPool();
const repo = new RepositorioAtribucion(pool);
const ORG = 'org-qa-atribucion';
const OTRA = 'org-qa-atribucion-b';
const AHORA = '2026-09-27T12:00:00.000Z';

beforeEach(async () => {
  await runMigrations(pool, atribucionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate first_party_attribution');
});
afterAll(async () => { await pool.end(); });

const intencion = (org: string, ref: string, gclid: string | null = 'EAIaIQobChMI1234567890abcdefg') => ({
  organizationId: org, ref, gclid, eventTimestamp: '2026-09-27T11:00:00.000Z',
});

describe('una intención, una atribución', () => {
  it('el mismo ref dos veces produce UNA fila, y la segunda vez se sabe que ya estaba', async () => {
    expect(await repo.registrarSiNueva(intencion(ORG, 'K7M2QX9P'))).toBe(true);
    expect(await repo.registrarSiNueva(intencion(ORG, 'K7M2QX9P'))).toBe(false);
    const { rows } = await pool.query('select count(*)::int as n from first_party_attribution where organization_id = $1', [ORG]);
    expect(rows[0].n).toBe(1);
  });

  it('una intención nace PENDIENTE: registrar no es atribuir', async () => {
    await repo.registrarSiNueva(intencion(ORG, 'REF-NUEVA'));
    const a = await repo.obtener(ORG, 'REF-NUEVA');
    expect(a?.estado).toBe('PENDIENTE');
    expect(a?.campaignId).toBeNull();
    expect(a?.resueltoEn).toBeNull();
  });

  it('resolver guarda de qué campaña vino y cuenta el intento', async () => {
    await repo.registrarSiNueva(intencion(ORG, 'REF-OK'));
    await repo.resolver(ORG, 'REF-OK', {
      estado: 'ATTRIBUTED', campaignId: '111', campaignName: 'CP · búsqueda', adGroupId: '222',
      adGroupName: 'clínica dental', keyword: 'dentista curico', matchType: 'PHRASE', device: 'MOBILE',
      clickDate: '2026-09-27', resueltoEn: AHORA,
    });
    const a = await repo.obtener(ORG, 'REF-OK');
    expect(a?.estado).toBe('ATTRIBUTED');
    expect(a?.campaignId).toBe('111');
    expect(a?.keyword).toBe('dentista curico');
    expect(a?.intentos).toBe(1);
  });

  it('un fallo del proveedor también cuenta como intento, y queda reintentable', async () => {
    await repo.registrarSiNueva(intencion(ORG, 'REF-FALLO'));
    await repo.resolver(ORG, 'REF-FALLO', { estado: 'PROVIDER_UNAVAILABLE', error: 'no se pudo consultar', resueltoEn: AHORA });
    const a = await repo.obtener(ORG, 'REF-FALLO');
    expect(a?.estado).toBe('PROVIDER_UNAVAILABLE');
    expect(a?.intentos).toBe(1);
    expect((await repo.pendientes(ORG)).map((x) => x.ref)).toContain('REF-FALLO');
  });

  it('lo ya resuelto en firme no vuelve a la cola de pendientes', async () => {
    await repo.registrarSiNueva(intencion(ORG, 'REF-CERRADA'));
    await repo.resolver(ORG, 'REF-CERRADA', { estado: 'GCLID_NOT_FOUND', resueltoEn: AHORA });
    expect((await repo.pendientes(ORG)).map((x) => x.ref)).not.toContain('REF-CERRADA');
  });
});

describe('lo que NO se guarda', () => {
  it('la tabla no tiene ninguna columna de datos personales', async () => {
    const { rows } = await pool.query(
      "select column_name from information_schema.columns where table_name = 'first_party_attribution'",
    );
    const columnas = rows.map((r: { column_name: string }) => r.column_name);
    for (const prohibida of ['telefono', 'phone', 'email', 'correo', 'nombre', 'name', 'ip', 'ip_address', 'user_agent', 'mensaje', 'message']) {
      expect(columnas, `«${prohibida}» no puede existir en esta tabla`).not.toContain(prohibida);
    }
    expect(columnas).toContain('gclid');
    expect(columnas).toContain('campaign_id');
  });

  it('una intención sin identificador de clic se guarda igual, sin inventarle uno', async () => {
    await repo.registrarSiNueva(intencion(ORG, 'REF-SIN-GCLID', null));
    await repo.resolver(ORG, 'REF-SIN-GCLID', { estado: 'NO_GCLID', resueltoEn: AHORA });
    const a = await repo.obtener(ORG, 'REF-SIN-GCLID');
    expect(a?.gclid).toBeNull();
    expect(a?.estado).toBe('NO_GCLID');
    expect(a?.campaignId).toBeNull();
  });
});

describe('aislamiento entre negocios', () => {
  it('el mismo ref en dos organizaciones son dos intenciones distintas', async () => {
    expect(await repo.registrarSiNueva(intencion(ORG, 'MISMO-REF'))).toBe(true);
    expect(await repo.registrarSiNueva(intencion(OTRA, 'MISMO-REF'))).toBe(true);
    expect(await repo.obtener(ORG, 'MISMO-REF')).not.toBeNull();
    expect(await repo.obtener(OTRA, 'MISMO-REF')).not.toBeNull();
  });

  it('el resumen de una organización no ve las atribuciones de otra', async () => {
    await repo.registrarSiNueva(intencion(ORG, 'A1'));
    await repo.resolver(ORG, 'A1', { estado: 'ATTRIBUTED', campaignId: '111', campaignName: 'de CP', resueltoEn: AHORA });
    await repo.registrarSiNueva(intencion(OTRA, 'B1'));
    await repo.resolver(OTRA, 'B1', { estado: 'ATTRIBUTED', campaignId: '999', campaignName: 'de la otra', resueltoEn: AHORA });

    const r = await repo.resumen(ORG);
    expect(r.porCampana.map((c) => c.campaignId)).toEqual(['111']);
    expect(JSON.stringify(r)).not.toContain('999');
    expect(r.porEstado.ATTRIBUTED).toBe(1);
  });
});
