import { makePool, PgEventStore } from '@soec/event-store/pg';
import { DeterministicIntelligenceProvider } from '@soec/intelligence';
import { buildApp } from './app';

const pool = makePool();
const app = buildApp({
  store: new PgEventStore(pool),
  intelligence: new DeterministicIntelligenceProvider(),
});

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: '0.0.0.0' })
  .then((addr) => console.log(JSON.stringify({ listening: addr })))
  .catch(async (err: unknown) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
