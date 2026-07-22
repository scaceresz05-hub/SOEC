import { makePool, PgOutbox, PgEventStore } from '@soec/event-store/pg';
import { MedService, MdmService, aplicarEventoAProyeccion } from '@soec/models';
import { PgProjectionStore } from '@soec/models/pg';
import { EceBuildService } from '@soec/ece';
import { PgEceProjectionStore, procesarEventoParaEce } from '@soec/ece/pg';
import { proyectarEventoOi } from '@soec/operaciones';
import { PgOiProjectionStore } from '@soec/operaciones/pg';
import { aplicarEventoAProyeccionCap } from '@soec/capacidades';
import { PgCapDefProjectionStore, PgCapExecProjectionStore } from '@soec/capacidades/pg';
import { aplicarEventoAProyeccionOperacional } from '@soec/operacional';
import { PgPolicyProjectionStore, PgAccionProjectionStore } from '@soec/operacional/pg';
import { aplicarEventoAProyeccionMarketing } from '@soec/marketing';
import { PgObjetivoProjectionStore, PgPlanProjectionStore } from '@soec/marketing/pg';
import { aplicarEventoAProyeccionContenido } from '@soec/contenido';
import { PgBriefProjectionStore, PgPaqueteProjectionStore } from '@soec/contenido/pg';
import { aplicarEventoAProyeccionCanales } from '@soec/canales';
import { PgPublicationProjectionStore } from '@soec/canales/pg';
import { aplicarEventoAProyeccionMedicion } from '@soec/medicion';
import { PgMedProjectionStore, PgOptProjectionStore } from '@soec/medicion/pg';
import { drainOutbox } from './index';

/**
 * Worker de proyecciones: un ÚNICO consumidor del outbox que actualiza las
 * proyecciones de MED, MDM, ECE y operaciones intelectuales, e invalida los ECE
 * cuyas entradas cambiaron. Idempotente; no ejecuta acciones empresariales ni
 * decisiones reservadas a la persona (#12/#13).
 */
const pool = makePool();
const outbox = new PgOutbox(pool);
const store = new PgEventStore(pool);
const modelProj = new PgProjectionStore(pool);
const eceProj = new PgEceProjectionStore(pool);
const oiProj = new PgOiProjectionStore(pool);
const capStores = { def: new PgCapDefProjectionStore(pool), exec: new PgCapExecProjectionStore(pool) };
const opStores = { policy: new PgPolicyProjectionStore(pool), accion: new PgAccionProjectionStore(pool) };
const mktStores = { objetivo: new PgObjetivoProjectionStore(pool), plan: new PgPlanProjectionStore(pool) };
const contStores = { brief: new PgBriefProjectionStore(pool), paquete: new PgPaqueteProjectionStore(pool) };
const chanStores = { publicacion: new PgPublicationProjectionStore(pool) };
const metStores = { medicion: new PgMedProjectionStore(pool), optimizacion: new PgOptProjectionStore(pool) };
const build = new EceBuildService(store, new MedService(store), new MdmService(store));

drainOutbox(outbox, async (event) => {
  await aplicarEventoAProyeccion(modelProj, event);
  await procesarEventoParaEce(event, { eceProjStore: eceProj, build });
  await proyectarEventoOi(oiProj, event);
  await aplicarEventoAProyeccionCap(capStores, event);
  await aplicarEventoAProyeccionOperacional(opStores, event);
  await aplicarEventoAProyeccionMarketing(mktStores, event);
  await aplicarEventoAProyeccionContenido(contStores, event);
  await aplicarEventoAProyeccionCanales(chanStores, event);
  await aplicarEventoAProyeccionMedicion(metStores, event);
})
  .then(async (n) => {
    console.log(JSON.stringify({ procesados: n }));
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
