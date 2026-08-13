#!/usr/bin/env node
/**
 * SOEC · SUPERVISOR de runtime local persistente (API 3081 + web 3080).
 *
 * Lo lanza la tarea programada `SOEC-Runtime` (AtLogOn), de forma DESATENDIDA y sin terminal visible.
 * NO implementa funcionalidad ni toca lógica de producto: sólo ORQUESTA procesos que ya existen
 * (mismo `apps/api/src/server.ts` y `next start` que `start-soec.mjs`). La ingesta autónoma corre por su
 * propia tarea (`SOEC-Ingesta-Observacion`), independiente de este supervisor.
 *
 * Robustez desatendida:
 *  - Guard anti-duplicado: si 3080 y 3081 ya escuchan, sale (no levanta un segundo stack).
 *  - Espera a Docker (autostart configurado; tras el login tarda unos segundos) y levanta PostgreSQL.
 *  - Reinicia API/web si alguno cae (backoff). El supervisor permanece vivo.
 *  - node absoluto + tsx/next LOCALES (sin npx interactivo). Log sanitizado local (gitignored).
 *
 * Puertos: Web 3080 · API 3081 · DB PostgreSQL 5544 (docker compose -p soec).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const WEB_DIR = path.join(ROOT, 'apps', 'web');
const NEXT_BIN = path.join(WEB_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');

const API_PORT = process.env.SOEC_API_PORT || '3081';
const WEB_PORT = process.env.SOEC_WEB_PORT || '3080';
const API_URL = `http://localhost:${API_PORT}`;
const DB_URL = process.env.DATABASE_URL || 'postgres://soec:soec@localhost:5544/soec';

const out = createWriteStream(path.join(ROOT, 'soec-runtime.log'), { flags: 'a' });
const log = (m) => { const l = `[${new Date().toISOString()}] ${m}\n`; out.write(l); try { process.stdout.write(l); } catch { /* sin consola */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portListening(port) {
  return new Promise((res) => {
    const s = net.connect(port, '127.0.0.1');
    s.setTimeout(800);
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('timeout', () => { s.destroy(); res(false); });
    s.on('error', () => res(false));
  });
}
const dockerReady = () => spawnSync('docker', ['info'], { shell: true, stdio: 'ignore' }).status === 0;

let apiProc = null, webProc = null, apiRestarts = 0, webRestarts = 0, parando = false;

function superviseApi() {
  if (parando) return;
  log(`Iniciando API → ${API_URL}`);
  apiProc = spawn(NODE, [TSX, 'apps/api/src/server.ts'], {
    cwd: ROOT, shell: false,
    env: { ...process.env, DATABASE_URL: DB_URL, PORT: API_PORT, SOEC_LEGACY_DEMO_ACCESS_ENABLED: 'true', SOEC_API_URL: API_URL },
  });
  apiProc.stdout.pipe(out); apiProc.stderr.pipe(out);
  apiProc.on('exit', (c) => { if (parando) return; apiRestarts += 1; const d = apiRestarts > 5 ? 30000 : 3000; log(`API salió (code ${c}); reinicio en ${d / 1000}s (intentos ${apiRestarts}).`); setTimeout(superviseApi, d); });
}
function superviseWeb() {
  if (parando) return;
  log(`Iniciando web (next start) → http://localhost:${WEB_PORT}`);
  webProc = spawn(NODE, [NEXT_BIN, 'start', '-p', WEB_PORT], {
    cwd: WEB_DIR, shell: false, env: { ...process.env, SOEC_API_URL: API_URL },
  });
  webProc.stdout.pipe(out); webProc.stderr.pipe(out);
  webProc.on('exit', (c) => { if (parando) return; webRestarts += 1; const d = webRestarts > 5 ? 30000 : 3000; log(`web salió (code ${c}); reinicio en ${d / 1000}s (intentos ${webRestarts}).`); setTimeout(superviseWeb, d); });
}

async function main() {
  log('=== SOEC-Runtime supervisor arranca ===');

  if ((await portListening(Number(API_PORT))) && (await portListening(Number(WEB_PORT)))) {
    log(`Stack ya escuchando en ${API_PORT}/${WEB_PORT}: no duplico. Salgo 0.`);
    process.exit(0);
  }

  let dk = false;
  for (let i = 0; i < 60; i += 1) { if (dockerReady()) { dk = true; break; } if (i === 0) log('Esperando a Docker (autostart)…'); await sleep(5000); }
  if (!dk) { log('Docker no disponible tras ~5 min. Salgo 1 (la tarea reintentará).'); process.exit(1); }
  log('Docker disponible.');

  if (spawnSync('docker', ['compose', '-p', 'soec', '-f', 'infrastructure/docker-compose.yml', 'up', '-d'], { cwd: ROOT, shell: true, stdio: 'ignore' }).status !== 0) log('WARN: docker compose up devolvió no-cero (continúo).');
  for (let i = 0; i < 40; i += 1) { if (spawnSync('docker', ['exec', 'soec_postgres', 'pg_isready', '-U', 'soec'], { shell: true, stdio: 'ignore' }).status === 0) { log('PostgreSQL listo.'); break; } await sleep(1000); }

  log('Aplicando migraciones (idempotente)…');
  log('Migraciones: exit ' + spawnSync(NODE, [TSX, 'packages/decision/src/pg/migrate-cli.ts'], { cwd: ROOT, shell: false, stdio: 'ignore', env: { ...process.env, DATABASE_URL: DB_URL } }).status);

  if (!existsSync(path.join(WEB_DIR, '.next'))) {
    log('No hay build de la web; compilando (next build) una vez…');
    log('next build exit ' + spawnSync(NODE, [NEXT_BIN, 'build'], { cwd: WEB_DIR, shell: false, stdio: 'ignore', env: { ...process.env, SOEC_API_URL: API_URL } }).status);
  }

  superviseApi();
  superviseWeb();

  for (let i = 0; i < 60; i += 1) {
    if ((await portListening(Number(API_PORT))) && (await portListening(Number(WEB_PORT)))) {
      log(`HEALTH: API ${API_PORT}=UP · WEB ${WEB_PORT}=UP → http://localhost:${WEB_PORT}/resultados`);
      return;
    }
    await sleep(2000);
  }
  log('HEALTH: timeout esperando que API/WEB escuchen (siguen supervisados).');
}

const parar = () => { parando = true; log('Señal de cierre: terminando API/web.'); try { apiProc?.kill(); } catch { /* noop */ } try { webProc?.kill(); } catch { /* noop */ } process.exit(0); };
process.on('SIGTERM', parar);
process.on('SIGINT', parar);
main().catch((e) => { log('FATAL: ' + (e?.message ?? e)); process.exit(1); });
