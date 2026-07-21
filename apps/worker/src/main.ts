import { makePool, PgOutbox } from '@soec/event-store/pg';
import { MedService, MdmService } from '@soec/models';
import { PgProjectionStore } from '@soec/models/pg';
import { PgEventStore } from '@soec/event-store/pg';
import { EceBuildService } from '@soec/ece';
import { PgEceProjectionStore, drenarModelosYEce } from '@soec/ece/pg';

/**
 * Worker de proyecciones: un único consumidor del outbox que actualiza las
 * proyecciones de MED, MDM y ECE, e invalida los ECE cuyas entradas cambiaron.
 * Idempotente; no decide ni ejecuta acciones reservadas a la persona (#12).
 */
const pool = makePool();
const outbox = new PgOutbox(pool);
const store = new PgEventStore(pool);
const modelProj = new PgProjectionStore(pool);
const eceProj = new PgEceProjectionStore(pool);
const build = new EceBuildService(store, new MedService(store), new MdmService(store));

drenarModelosYEce(outbox, modelProj, { eceProjStore: eceProj, build })
  .then(async (r) => {
    console.log(JSON.stringify(r));
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
