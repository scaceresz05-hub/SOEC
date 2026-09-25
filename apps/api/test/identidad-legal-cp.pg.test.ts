/**
 * IDENTIDAD LEGAL DE CP · cómo se llama de verdad la empresa, y quién manda al decirlo.
 *
 * Durante meses SOEC dijo que la razón social de CP era «CENTRO E SALUD ODONTOLOGICO CP SPA». Ese valor era
 * fiel a SU fuente —el WHOIS de NIC Chile, erratas incluidas— y por eso se copiaba literal, que es la regla
 * correcta. El error estaba un nivel más arriba: para saber cómo se llama legalmente una sociedad manda el
 * Registro de Empresas y Sociedades, no el registro de dominios. Un nombre legal mal escrito no es cosmético:
 * es lo que acaba en un contrato o en una factura.
 *
 * Lo que estas pruebas fijan:
 *
 *   · el nombre comercial NO cambia: quien la conoce la conoce como «CP Odontología»;
 *   · la razón social y el RUT son los del Certificado de Vigencia;
 *   · el SSOT persistido manda sobre el registro TypeScript, así que la corrección tiene que llegar A LA
 *     FILA —arreglar sólo el código habría dejado la mentira intacta en producción—;
 *   · y la corrección es estrecha e idempotente: no pisa un valor distinto ni toca a nadie más.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@soec/event-store/pg';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';
import { negocioMigrations, RepositorioNegocios } from '../src/negocio/negocio-pg';
import { conexionMigrations } from '../src/conexion/conexion-pg';
import { construirSnapshotDeNegocios } from '../src/conexion/proyeccion';
import { configuracionHistorica } from '../src/plataforma/registro';

const pool = makeTestPool();
const CP = 'org-cp-odontologia';

const RAZON_SOCIAL = 'CENTRO DE SALUD ODONTOLÓGICA CP SpA';
const RUT = '77.214.436-9';
const NOMBRE_COMERCIAL = 'CP Odontología';
/** Lo que decía el WHOIS de NIC Chile. Se conserva aquí para poder exigir que ya NO aparezca. */
const RAZON_SOCIAL_VIEJA = 'CENTRO E SALUD ODONTOLOGICO CP SPA';

async function perfilCon(legalName: string | null): Promise<void> {
  await new RepositorioNegocios(pool).insertarPerfil(pool, {
    organizationId: CP, businessKey: 'bk-cp-odontologia', displayName: NOMBRE_COMERCIAL, legalName,
    businessType: 'CLINICA', description: 'clínica dental', website: null, country: 'CL',
    currency: 'CLP', timezone: 'America/Santiago', language: 'es', customerType: 'B2C',
    primaryObjective: 'captar pacientes', status: 'ACTIVE', origen: 'MIGRACION',
  });
}

const legalNamePersistido = async (): Promise<string | null> => {
  const { rows } = await pool.query('select legal_name from business_profile where organization_id = $1', [CP]);
  return rows[0]?.legal_name ?? null;
};

beforeEach(async () => {
  await runMigrations(pool);
  await runMigrations(pool, conexionMigrations);
  await ejecutarDestructivoDePrueba(pool, 'truncate business_connection_ciphertext, business_capability, business_connection, business_audit, business_restriction, business_geo_scope, business_offering, business_objective, business_governance, business_profile cascade');
  // La corrección se aplica al migrar; para poder observarla, cada caso siembra su fila antes.
  await pool.query("delete from schema_migrations where id = '0002_identidad_legal_cp_desde_certificado_de_vigencia'");
});
afterAll(async () => { await pool.end(); });

describe('el registro declara la identidad del Certificado de Vigencia', () => {
  it('razón social y RUT son los oficiales; el nombre comercial no se toca', () => {
    const cfg = configuracionHistorica(CP);
    expect(cfg?.negocio.legalName).toBe(RAZON_SOCIAL);
    expect(cfg?.negocio.rut).toBe(RUT);
    expect(cfg?.negocio.displayName).toBe(NOMBRE_COMERCIAL);
  });

  it('el RUT deja de figurar como dato humano pendiente', () => {
    const pendientes = configuracionHistorica(CP)?.negocio.datosHumanosPendientes ?? [];
    expect(pendientes.some((p) => /RUT/i.test(p))).toBe(false);
  });
});

describe('la corrección llega a la fila persistida, que es la que manda', () => {
  it('sustituye el nombre viejo por el oficial', async () => {
    await perfilCon(RAZON_SOCIAL_VIEJA);
    await runMigrations(pool, negocioMigrations);
    expect(await legalNamePersistido()).toBe(RAZON_SOCIAL);
  });

  it('es idempotente: repetirla no vuelve a tocar nada', async () => {
    await perfilCon(RAZON_SOCIAL_VIEJA);
    await runMigrations(pool, negocioMigrations);
    const { rows: antes } = await pool.query('select legal_name, updated_at from business_profile where organization_id = $1', [CP]);

    await pool.query("delete from schema_migrations where id = '0002_identidad_legal_cp_desde_certificado_de_vigencia'");
    await runMigrations(pool, negocioMigrations);
    const { rows: despues } = await pool.query('select legal_name, updated_at from business_profile where organization_id = $1', [CP]);
    expect(despues).toEqual(antes);
  });

  it('NO pisa un valor distinto: si alguien ya lo editó, se respeta', async () => {
    await perfilCon('OTRA RAZON SOCIAL QUE ALGUIEN CORRIGIO A MANO');
    await runMigrations(pool, negocioMigrations);
    expect(await legalNamePersistido()).toBe('OTRA RAZON SOCIAL QUE ALGUIEN CORRIGIO A MANO');
  });

  it('no toca a ninguna otra empresa', async () => {
    await perfilCon(RAZON_SOCIAL_VIEJA);
    await new RepositorioNegocios(pool).insertarPerfil(pool, {
      organizationId: 'org-otra', businessKey: 'bk-otra', displayName: 'Otra', legalName: RAZON_SOCIAL_VIEJA,
      businessType: 'CLINICA', description: 'x', website: null, country: 'CL', currency: 'CLP',
      timezone: 'America/Santiago', language: 'es', customerType: 'B2C', primaryObjective: 'x',
      status: 'ACTIVE', origen: 'UI',
    });
    await runMigrations(pool, negocioMigrations);
    const { rows } = await pool.query("select legal_name from business_profile where organization_id = 'org-otra'");
    expect(rows[0].legal_name).toBe(RAZON_SOCIAL_VIEJA); // su identidad no es asunto de esta corrección
  });
});

describe('lo que acaba viendo quien pregunta por el negocio', () => {
  it('la proyección del runtime devuelve la identidad oficial completa', async () => {
    await perfilCon(RAZON_SOCIAL_VIEJA);
    await runMigrations(pool, negocioMigrations);

    const snap = await construirSnapshotDeNegocios(pool);
    const cp = snap.configs.find((c) => c.negocio.organizationId === CP);
    expect(cp?.negocio.displayName).toBe(NOMBRE_COMERCIAL);
    expect(cp?.negocio.legalName).toBe(RAZON_SOCIAL);
    expect(cp?.negocio.rut).toBe(RUT);
    expect(JSON.stringify(cp)).not.toContain(RAZON_SOCIAL_VIEJA);
  });
});
