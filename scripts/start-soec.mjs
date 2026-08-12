#!/usr/bin/env node
/**
 * SOEC · arranque local PRODUCTIVO estable (next build + next start).
 *
 *   node scripts/start-soec.mjs
 *
 * A diferencia de start-local.mjs (que usa `next dev`, cómodo pero con `.next` corruptible),
 * este modo compila la web una vez (`next build`) y la sirve con `next start` — régimen estable
 * para demostrar/consultar sin recompilaciones en caliente. NO implementa funcionalidad:
 * la UI solo CONSULTA datos ya persistidos; la ingesta autónoma (Google Ads / SmileFlow Growth)
 * corre por la tarea programada independiente, no desde aquí.
 *
 * Puertos (propios de SOEC): Web → 3080 · API → 3081 · DB → PostgreSQL 5544 (docker compose -p soec).
 * Detener con Ctrl+C.
 */
import { spawn, spawnSync } from 'node:child_process';

const DB_URL = process.env.DATABASE_URL || 'postgres://soec:soec@localhost:5544/soec';
const API_PORT = process.env.SOEC_API_PORT || '3081';
const WEB_PORT = process.env.SOEC_WEB_PORT || '3080';
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function must(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ Falló: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
}

async function main() {
  console.log('\n  SOEC · arranque local estable (build + start)\n  ──────────────────────────────────────────────');

  console.log('  › Levantando PostgreSQL (docker compose -p soec)…');
  must('docker', ['compose', '-p', 'soec', '-f', 'infrastructure/docker-compose.yml', 'up', '-d']);

  process.stdout.write('  › Esperando la base de datos');
  let ok = false;
  for (let i = 0; i < 40; i += 1) {
    const r = spawnSync('docker', ['exec', 'soec_postgres', 'pg_isready', '-U', 'soec'], { shell: true, stdio: 'ignore' });
    if (r.status === 0) { ok = true; break; }
    process.stdout.write('.');
    await sleep(1000);
  }
  console.log(ok ? ' lista' : ' (sin respuesta; continúo)');

  console.log('  › Aplicando migraciones…');
  must('npx', ['tsx', 'packages/decision/src/pg/migrate-cli.ts'], { env: { ...process.env, DATABASE_URL: DB_URL } });

  console.log('  › Compilando la web (next build)… esto tarda un poco.');
  must('npx', ['pnpm@9.15.4', '-C', 'apps/web', 'exec', 'next', 'build'], { env: { ...process.env, SOEC_API_URL: API_URL } });

  console.log(`  › Iniciando backend (API) → ${API_URL}`);
  // Acceso demo LOCAL abierto (sin login) para consultar la superficie /medicion (panel de resultados).
  // `server.ts` ABORTA si esto se usara en producción; aquí es un arranque local de demostración.
  const api = spawn('npx', ['tsx', 'apps/api/src/server.ts'], { stdio: 'inherit', shell: true, env: { ...process.env, DATABASE_URL: DB_URL, PORT: API_PORT, SOEC_LEGACY_DEMO_ACCESS_ENABLED: 'true' } });

  console.log(`  › Sirviendo frontend compilado (next start) → ${WEB_URL}`);
  const web = spawn('npx', ['pnpm@9.15.4', '-C', 'apps/web', 'exec', 'next', 'start', '-p', WEB_PORT], { stdio: 'inherit', shell: true, env: { ...process.env, SOEC_API_URL: API_URL } });

  console.log('\n  ─────────────────────────────────────────────');
  console.log(`  ✓ Abra SOEC en el navegador:  ${WEB_URL}`);
  console.log(`    Resultados reales:  ${WEB_URL}/resultados`);
  console.log('    Régimen estable: web pre-compilada (sin recompilación en caliente).');
  console.log('    La UI solo CONSULTA datos persistidos; la ingesta corre por la tarea programada.');
  console.log('    Detener todo: Ctrl+C\n');

  const parar = () => { try { api.kill(); } catch { /* noop */ } try { web.kill(); } catch { /* noop */ } process.exit(0); };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);
  api.on('exit', (c) => { if (c) { console.error('  ✗ El backend terminó inesperadamente.'); try { web.kill(); } catch { /* noop */ } process.exit(c || 1); } });
  web.on('exit', (c) => { if (c) { console.error('  ✗ El frontend terminó inesperadamente.'); try { api.kill(); } catch { /* noop */ } process.exit(c || 1); } });
}

main();
