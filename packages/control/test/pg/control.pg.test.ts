import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { migracionesHastaCapacidades } from '@soec/capacidades/pg';
import { operacionalMigrations } from '@soec/operacional/pg';
import { marketingMigrations } from '@soec/marketing/pg';
import { contenidoMigrations } from '@soec/contenido/pg';
import { canalesMigrations } from '@soec/canales/pg';
import { medicionMigrations } from '@soec/medicion/pg';
import {
  DecisionService,
  InboxService,
  PausaService,
  pausaTotalActiva,
  reconstruirPausa,
} from '../../src';
import {
  controlMigrations,
  PgDecisionProjectionStore,
  PgInboxProjectionStore,
  PgPausaProjectionStore,
  drenarControl,
  reconstruirProyeccionesControl,
} from '../../src/pg';
import { attr, ctxFor, now } from '../helpers';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const CADENA = [
  ...migracionesHastaCapacidades,
  ...operacionalMigrations,
  ...marketingMigrations,
  ...contenidoMigrations,
  ...canalesMigrations,
  ...medicionMigrations,
  ...controlMigrations,
];
const pool = makeTestPool();
const store = new PgEventStore(pool);
const pausa = new PausaService(store);
const decisiones = new DecisionService(store);
const inbox = new InboxService(store);

beforeAll(async () => {
  await runMigrations(pool, CADENA);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await ejecutarDestructivoDePrueba(
    pool,
    `truncate table events, outbox, projection_checkpoints, proj_pausa_current, proj_decision_current, proj_inbox_current restart identity cascade`,
  );
});

describe('Centro de Control sobre PostgreSQL real', () => {
  it('persiste pausa, decisiones y buzón; proyecta y reconstruye idéntico', async () => {
    const ctx = ctxFor('orgA');
    await pausa.pausar(
      ctx,
      { tipo: 'departamento', valor: '*' },
      'pausa total',
      'propietario',
      attr,
      now,
    );
    await decisiones.registrar(
      ctx,
      'dec-1',
      {
        tipo: 'escalamiento_frecuencia',
        razon: 'r',
        alcance: 'blog/act',
        efectoEsperado: 'e',
        riesgo: 'medio',
        presupuestoImplicado: 0,
        evidencia: 'ev',
        alternativas: [],
        recomendacionSistema: 'rec',
        politica: 'pol',
        refPlan: 'plan',
      },
      attr,
      now,
    );
    await inbox.registrarAlerta(
      ctx,
      {
        clave: 'gasto:pub-1',
        tipo: 'gasto_anomalo',
        severidad: 'critico',
        origen: 'medicion',
        entidad: 'pub-1',
        evidencia: 'e',
        impacto: 'i',
        accionAutomatica: 'a',
        accionHumana: 'h',
      },
      attr,
      now,
    );

    const outbox = new PgOutbox(pool);
    const stores = {
      pausa: new PgPausaProjectionStore(pool),
      decision: new PgDecisionProjectionStore(pool),
      inbox: new PgInboxProjectionStore(pool),
    };
    const n = await drenarControl(outbox, stores);
    expect(n).toBeGreaterThan(0);
    expect(
      (await stores.pausa.get('orgA'))?.state &&
        pausaTotalActiva((await stores.pausa.get('orgA'))!.state),
    ).toBe(true);
    expect((await stores.decision.list('orgA')).length).toBe(1);

    const antes = await stores.decision.list('orgA');
    await reconstruirProyeccionesControl(pool);
    expect(await stores.decision.list('orgA')).toEqual(antes);
  });

  it('aislamiento organizacional y migración idempotente', async () => {
    const ctx = ctxFor('orgA');
    await pausa.pausar(ctx, { tipo: 'departamento', valor: '*' }, 'x', 'p', attr, now);
    const otra = reconstruirPausa('orgB', await store.readStream(ctxFor('orgB'), 'pausa:orgB'));
    expect(pausaTotalActiva(otra)).toBe(false);
    expect(await runMigrations(pool, CADENA)).toEqual([]);
  });
});
