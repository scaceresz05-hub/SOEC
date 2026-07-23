#!/usr/bin/env node
/**
 * SOEC · arranque local con un solo comando.
 *
 *   npm run start-local     (o: node scripts/start-local.mjs)
 *
 * Deja SOEC accesible desde el navegador en una URL local. Levanta PostgreSQL (docker),
 * aplica migraciones, e inicia el backend (API) y el frontend (web). No implementa
 * funcionalidades: solo orquesta el arranque. Detener con Ctrl+C.
 *
 * Puertos (propios de SOEC, para no chocar con otros proyectos como SSR Control en 3000/3001):
 *   Web  → http://localhost:3080   (override: SOEC_WEB_PORT)
 *   API  → http://localhost:3081   (override: SOEC_API_PORT)
 *   DB   → PostgreSQL en 5544 (docker compose -p soec)
 *
 * No hay login: las experiencias usan un contexto sintético server-side; acceso abierto.
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
  console.log('\n  SOEC · arranque local\n  ─────────────────────');

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
  must('npx', ['tsx', 'packages/piloto/src/pg/migrate-cli.ts'], { env: { ...process.env, DATABASE_URL: DB_URL } });

  console.log(`  › Iniciando backend (API) → ${API_URL}`);
  const api = spawn('npx', ['tsx', 'apps/api/src/server.ts'], { stdio: 'inherit', shell: true, env: { ...process.env, DATABASE_URL: DB_URL, PORT: API_PORT } });

  console.log(`  › Iniciando frontend (web) → ${WEB_URL}`);
  const web = spawn('npx', ['pnpm@9.15.4', '-C', 'apps/web', 'exec', 'next', 'dev', '-p', WEB_PORT], { stdio: 'inherit', shell: true, env: { ...process.env, SOEC_API_URL: API_URL } });

  console.log('\n  ─────────────────────────────────────────────');
  console.log(`  ✓ Abra SOEC en el navegador:  ${WEB_URL}`);
  console.log('    (la primera carga compila unos segundos)');
  console.log('    Sin login — acceso abierto (demostración sintética).');
  console.log(`    Rutas: ${WEB_URL}/  ·  ${WEB_URL}/control  ·  ${WEB_URL}/piloto`);
  console.log('    Detener todo: Ctrl+C\n');

  const parar = () => { try { api.kill(); } catch { /* noop */ } try { web.kill(); } catch { /* noop */ } process.exit(0); };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);
  api.on('exit', (c) => { if (c) { console.error('  ✗ El backend terminó inesperadamente.'); try { web.kill(); } catch { /* noop */ } process.exit(c || 1); } });
  web.on('exit', (c) => { if (c) { console.error('  ✗ El frontend terminó inesperadamente.'); try { api.kill(); } catch { /* noop */ } process.exit(c || 1); } });
}

main();
