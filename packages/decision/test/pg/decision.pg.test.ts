import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, PgEventStore, PgOutbox } from '@soec/event-store/pg';
import { migracionesHastaCapacidades } from '@soec/capacidades/pg';
import { operacionalMigrations } from '@soec/operacional/pg';
import { marketingMigrations } from '@soec/marketing/pg';
import { contenidoMigrations } from '@soec/contenido/pg';
import { canalesMigrations } from '@soec/canales/pg';
import { medicionMigrations } from '@soec/medicion/pg';
import { controlMigrations } from '@soec/control/pg';
import { pilotoMigrations } from '@soec/piloto/pg';
import { DecisionService } from '../../src/index';
import {
  decisionMigrations,
  PgDecisionProjectionStore,
  drenarDecision,
  reconstruirProyeccionDecision,
} from '../../src/pg';
import { attr, ctxFor, now, propuestaReal } from '../helpers';
import { makeTestPool, ejecutarDestructivoDePrueba } from '@soec/event-store/test-db';

const CADENA = [
  ...migracionesHastaCapacidades,
  ...operacionalMigrations,
  ...marketingMigrations,
  ...contenidoMigrations,
  ...canalesMigrations,
  ...medicionMigrations,
  ...controlMigrations,
  ...pilotoMigrations,
  ...decisionMigrations,
];
const pool = makeTestPool();
const store = new PgEventStore(pool);
const DEP = 'marketing';

beforeAll(async () => {
  await runMigrations(pool, CADENA);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await ejecutarDestructivoDePrueba(
    pool,
    `truncate table events, outbox, projection_checkpoints, proj_objetivo_decision_current restart identity cascade`,
  );
});

describe('Decisión institucional sobre PostgreSQL real', () => {
  it('persiste la decisión (evento durable); proyecta vigente/historial y reconstruye idéntico', async () => {
    const svc = new DecisionService(store);
    const { snapshot, candidato } = propuestaReal();
    await svc.registrar(
      ctxFor('orgA'),
      DEP,
      {
        decisionId: 'd1',
        resultado: 'ACEPTADO',
        candidatoElegido: candidato,
        propuesta: snapshot,
        justificacion: { texto: 'atiende el cuello de botella', categoria: 'NEGOCIO' },
      },
      attr,
      now,
    );

    const outbox = new PgOutbox(pool);
    const proj = new PgDecisionProjectionStore(pool);
    const n = await drenarDecision(outbox, proj);
    expect(n).toBeGreaterThan(0);
    const lista = await proj.list('orgA');
    expect(lista.length).toBe(1);
    expect(lista[0]!.vigente?.candidato.objetivoId).toBe(candidato.objetivoId);

    const antes = await proj.list('orgA');
    await reconstruirProyeccionDecision(pool);
    expect(await proj.list('orgA')).toEqual(antes);
  });

  it('registro durable y aislado; migración idempotente', async () => {
    const svc = new DecisionService(store);
    const { snapshot, candidato } = propuestaReal();
    await svc.registrar(
      ctxFor('orgA'),
      DEP,
      {
        decisionId: 'd1',
        resultado: 'ACEPTADO',
        candidatoElegido: candidato,
        propuesta: snapshot,
        justificacion: { texto: 'x', categoria: 'NEGOCIO' },
      },
      attr,
      now,
    );
    // Reconstrucción desde el log durable.
    const cargado = await svc.cargar(ctxFor('orgA'), DEP);
    expect(cargado.vigente?.candidato.objetivoId).toBe(candidato.objetivoId);
    // Aislamiento multiempresa.
    expect((await svc.cargar(ctxFor('orgB'), DEP)).existe).toBe(false);
    // Migración idempotente.
    expect(await runMigrations(pool, CADENA)).toEqual([]);
  });
});
