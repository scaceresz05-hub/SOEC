/**
 * Pre-flight check del Sprint 0 (F2-PILOT-00 · Nivel 1 — verificación técnica automática).
 *
 *   pnpm sprint0:preflight            (desde la raíz)
 *   SOEC_API_URL=... SOEC_WEB_URL=... DATABASE_URL=... pnpm sprint0:preflight
 *
 * Ejecuta ~30 comprobaciones DETERMINÍSTICAS del entorno y del estado funcional, escribe
 * `docs/piloto/PRE-FLIGHT-REPORT.md` y declara APTO / NO APTO. Si algo crítico falla, sale
 * con código ≠ 0 (bloquea el inicio del Sprint 0). NO evalúa usabilidad ni comprensión: eso
 * es observación humana (Nivel 2). No modifica los casos A/B/C; su prueba de flujo usa una
 * evaluación efímera propia que deja CERRADA. No cambia producto, motores ni experiencia.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- script de verificación: recorre JSON de respuestas de forma laxa */
import { writeFileSync } from 'node:fs';
import { makePool } from '@soec/event-store/pg';

const API = process.env.SOEC_API_URL ?? 'http://127.0.0.1:3081';
const WEB = process.env.SOEC_WEB_URL ?? 'http://127.0.0.1:3080';
process.env.DATABASE_URL ??= 'postgres://soec:soec@localhost:5544/soec';
const H = { 'content-type': 'application/json' };
const SELLO = process.env.PREFLIGHT_STAMP ?? new Date().toISOString();

type Estado = 'ok' | 'fail' | 'skip';
interface Check {
  grupo: string;
  nombre: string;
  estado: Estado;
  detalle: string;
}
const checks: Check[] = [];
let grupo = '';
function add(nombre: string, estado: Estado, detalle = '') {
  checks.push({ grupo, nombre, estado, detalle });
}
async function verificar(nombre: string, fn: () => Promise<{ ok: boolean; detalle?: string }>) {
  try {
    const r = await fn();
    add(nombre, r.ok ? 'ok' : 'fail', r.detalle ?? '');
  } catch (e) {
    add(nombre, 'fail', (e as Error).message);
  }
}

async function jget(base: string, path: string) {
  const res = await fetch(base + path);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* respuesta no-JSON (HTML) */
  }
  return { status: res.status, text, json: json as any };
}
async function jpost(path: string, body: unknown) {
  const res = await fetch(API + path, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as any;
  return { status: res.status, json };
}

const CASOS = [
  { caso: 'A', org: 'clinica-brille', espera: 'candidatos con confianza' },
  { caso: 'B', org: 'clinica-nova', espera: 'cobertura parcial / faltantes' },
  { caso: 'C', org: 'clinica-aurora', espera: 'no normalizable + 2 generaciones' },
];
const DEP = 'marketing';
async function evaluacionActiva(org: string): Promise<any | null> {
  // La evaluación de demostración de cada caso está GENERADA. Filtrar por ese estado hace
  // el check inmune al sandbox efímero de la prueba de flujo (que queda CERRADA).
  const r = await jget(API, `/experience/evaluacion/lista?org=${org}&departamento=${DEP}`);
  const generadas = (r.json?.evaluaciones ?? []).filter((e: any) => e.estado === 'GENERADA');
  return generadas[generadas.length - 1] ?? null;
}

async function main() {
  // ---------------------------------------------------------------- ENTORNO
  grupo = 'Entorno';
  await verificar('API /health responde 200', async () => {
    const r = await jget(API, '/health');
    return { ok: r.status === 200 && r.json?.status === 'ok', detalle: `HTTP ${r.status}` };
  });
  await verificar('API catálogo devuelve 3 organizaciones', async () => {
    const r = await jget(API, '/experience/catalogo');
    const n = r.json?.organizaciones?.length ?? 0;
    return { ok: r.status === 200 && n >= 3, detalle: `${n} organizaciones` };
  });
  await verificar('WEB raíz responde 200', async () => {
    const r = await jget(WEB, '/');
    return { ok: r.status === 200, detalle: `HTTP ${r.status}` };
  });
  await verificar('WEB /evaluacion responde 200 y renderiza', async () => {
    const r = await jget(WEB, '/evaluacion');
    return { ok: r.status === 200 && r.text.includes('Evaluación del Director'), detalle: `HTTP ${r.status}` };
  });
  await verificar('WEB /director-workspace responde 200', async () => {
    const r = await jget(WEB, '/director-workspace');
    return { ok: r.status === 200 && r.text.includes('Director Workspace'), detalle: `HTTP ${r.status}` };
  });
  await verificar('WEB proxy /api/catalogo llega a la API', async () => {
    const r = await jget(WEB, '/api/catalogo');
    return { ok: r.status === 200 && (r.json?.organizaciones?.length ?? 0) >= 3, detalle: `HTTP ${r.status}` };
  });

  // ---------------------------------------------------------------- POSTGRES
  grupo = 'PostgreSQL';
  const pool = makePool();
  await verificar('Conexión a PostgreSQL (SELECT 1)', async () => {
    const r = await pool.query('SELECT 1 AS uno');
    return { ok: r.rows[0]?.uno === 1, detalle: 'conectado' };
  });
  await verificar('Migraciones aplicadas (tabla events existe)', async () => {
    const r = await pool.query("SELECT to_regclass('public.events') AS t");
    return { ok: r.rows[0]?.t != null, detalle: String(r.rows[0]?.t) };
  });
  await verificar('Hay eventos persistidos (seed cargado)', async () => {
    const r = await pool.query('SELECT count(*)::int AS n FROM events');
    const n = r.rows[0]?.n ?? 0;
    return { ok: n > 0, detalle: `${n} eventos` };
  });

  // ------------------------------------------------------------ ESTADO / CASOS
  grupo = 'Escenarios de demostración';
  for (const c of CASOS) {
    const act = await evaluacionActiva(c.org);
    await verificar(`Caso ${c.caso} (${c.org}) tiene evaluación GENERADA`, async () => ({
      ok: !!act && act.estado === 'GENERADA',
      detalle: act ? act.estado : 'sin evaluación activa',
    }));
    if (!act) continue;
    const w = await jget(API, `/experience/director-workspace/estado?org=${c.org}&departamento=${DEP}&evaluacionId=${act.evaluacionId}`);
    if (c.caso === 'A') {
      await verificar('Caso A propone candidatos con confianza', async () => ({ ok: w.json?.propuestaDisponible && (w.json?.candidatos?.length ?? 0) >= 1, detalle: `${w.json?.candidatos?.length ?? 0} candidato(s)` }));
      await verificar('Caso A: trazabilidad abre (cadena no vacía)', async () => ({ ok: (w.json?.candidatos?.[0]?.trazabilidad?.cadena?.length ?? 0) > 0, detalle: 'cadena presente' }));
      await verificar('Caso A: transparencia abre (supuestos presentes)', async () => ({ ok: (w.json?.transparencia?.supuestos?.length ?? 0) > 0, detalle: `${w.json?.transparencia?.supuestos?.length ?? 0} supuestos` }));
    }
    if (c.caso === 'B') {
      await verificar('Caso B: faltantes visibles', async () => ({ ok: (w.json?.comprension?.faltantes?.length ?? 0) > 0, detalle: `${w.json?.comprension?.faltantes?.length ?? 0} faltantes` }));
      await verificar('Caso B: cobertura parcial o abstención', async () => {
        const cob = w.json?.cobertura;
        const parcial = cob && cob.candidatosFundados < cob.candidatosEsperados;
        return { ok: !w.json?.propuestaDisponible || parcial, detalle: cob ? `${cob.candidatosFundados}/${cob.candidatosEsperados}` : 'abstención' };
      });
    }
    if (c.caso === 'C') {
      const e = await jget(API, `/experience/evaluacion/estado?org=${c.org}&departamento=${DEP}&evaluacionId=${act.evaluacionId}`);
      await verificar('Caso C: ≥2 generaciones (regeneración)', async () => ({ ok: (e.json?.generaciones ?? 0) >= 2, detalle: `${e.json?.generaciones} generaciones` }));
      await verificar('Caso C: ≥1 respuesta no normalizable', async () => ({ ok: (e.json?.resumen?.noNormalizables ?? 0) >= 1, detalle: `${e.json?.resumen?.noNormalizables} no normalizable(s)` }));
    }
  }

  // -------------------------------------------------- FLUJO (evaluación efímera)
  grupo = 'Flujo completo (sandbox efímero, no toca A/B/C)';
  const org = 'clinica-brille';
  let ev = '';
  await verificar('Selección inválida es rechazada (400)', async () => {
    const r = await jpost('/experience/evaluacion/iniciar', { org: 'org-inexistente', departamento: DEP });
    return { ok: r.status === 400, detalle: `HTTP ${r.status}` };
  });
  await verificar('Iniciar evaluación → BORRADOR con id', async () => {
    const r = await jpost('/experience/evaluacion/iniciar', { org, departamento: DEP, titulo: 'preflight-check' });
    ev = r.json?.evaluacionId ?? '';
    return { ok: r.status === 201 && !!ev && r.json?.estado === 'BORRADOR', detalle: r.json?.estado };
  });
  const est = await jget(API, `/experience/evaluacion/estado?org=${org}&departamento=${DEP}&evaluacionId=${ev}`);
  const pPocas = est.json?.preguntas?.find((p: any) => p.senalNombre === 'POCAS_SOLICITUDES')?.preguntaId;
  const pNoShow = est.json?.preguntas?.find((p: any) => p.senalNombre === 'ALTO_NO_SHOW')?.preguntaId;
  await verificar('Cuestionario gobernado presente (≥8 preguntas)', async () => ({ ok: (est.json?.preguntas?.length ?? 0) >= 8, detalle: `${est.json?.preguntas?.length} preguntas` }));
  await verificar('Responder cerrada «sí» → RESPONDIDA', async () => {
    const r = await jpost('/experience/evaluacion/responder', { org, departamento: DEP, evaluacionId: ev, preguntaId: pPocas, entrada: { clase: 'CERRADA', valorCrudo: 'sí' } });
    return { ok: r.json?.preguntas?.find((p: any) => p.preguntaId === pPocas)?.estado === 'RESPONDIDA', detalle: 'ok' };
  });
  await verificar('Normalización segura: «a veces» → NO_NORMALIZABLE', async () => {
    const r = await jpost('/experience/evaluacion/responder', { org, departamento: DEP, evaluacionId: ev, preguntaId: pNoShow, entrada: { clase: 'CERRADA', valorCrudo: 'a veces' } });
    return { ok: r.json?.preguntas?.find((p: any) => p.preguntaId === pNoShow)?.estado === 'NO_NORMALIZABLE', detalle: 'ok' };
  });
  await verificar('Generar comprensión → GENERADA con huella', async () => {
    const r = await jpost('/experience/evaluacion/generar', { org, departamento: DEP, evaluacionId: ev });
    return { ok: r.json?.estado === 'GENERADA' && /^[0-9a-f]{12}/.test(r.json?.ultimaGeneracion?.huella ?? ''), detalle: r.json?.ultimaGeneracion?.huella?.slice(0, 12) };
  });
  const w = await jget(API, `/experience/director-workspace/estado?org=${org}&departamento=${DEP}&evaluacionId=${ev}`);
  const obj = w.json?.candidatos?.[0]?.objetivoId;
  await verificar('Workspace propone candidato sobre la evaluación', async () => ({ ok: !!obj, detalle: obj ?? 'sin candidato' }));
  await verificar('Aceptar → objetivo vigente', async () => {
    const r = await jpost('/experience/director-workspace/decidir', { org, departamento: DEP, evaluacionId: ev, decisionId: 'preflight-accept', resultado: 'ACEPTADO', objetivoId: obj, justificacion: { texto: 'preflight', categoria: 'NEGOCIO' } });
    return { ok: r.json?.gobierno?.vigente?.objetivoId === obj, detalle: r.json?.gobierno?.vigente?.objetivoId };
  });
  await verificar('Persistencia + recarga: el vigente persiste en lectura fresca', async () => {
    const r = await jget(API, `/experience/director-workspace/estado?org=${org}&departamento=${DEP}&evaluacionId=${ev}`);
    return { ok: r.json?.gobierno?.vigente?.objetivoId === obj, detalle: 'persistido' };
  });
  await verificar('Revocar → sin objetivo vigente', async () => {
    const r = await jpost('/experience/director-workspace/revocar', { org, departamento: DEP, evaluacionId: ev, decisionId: 'preflight-accept', motivo: 'preflight' });
    return { ok: r.json?.gobierno?.vigente === null, detalle: 'revocado' };
  });
  await verificar('Cerrar el sandbox efímero (no queda editable)', async () => {
    const r = await jpost('/experience/evaluacion/cerrar', { org, departamento: DEP, evaluacionId: ev });
    return { ok: r.json?.estado === 'CERRADA', detalle: r.json?.estado };
  });

  // ---------------------------------------------------------- INTEGRIDAD / RENDER
  grupo = 'Integridad de render';
  const ERR = /Cannot find module|Application error|Internal Server Error|__NEXT_ERROR|Unhandled Runtime Error/i;
  for (const ruta of ['/evaluacion', '/director-workspace']) {
    await verificar(`Sin marcadores de error de Next en ${ruta}`, async () => {
      const r = await jget(WEB, ruta);
      return { ok: !ERR.test(r.text), detalle: ERR.test(r.text) ? 'marcador de error detectado' : 'HTML limpio' };
    });
  }
  add('Consola del navegador / errores JS-React', 'skip', 'requiere verificación en navegador (Nivel 1.b); no automatizable desde Node');
  const logPath = process.env.SOEC_LOG;
  if (logPath) {
    await verificar('Logs de backend sin errores reales', async () => {
      const { readFileSync } = await import('node:fs');
      const txt = readFileSync(logPath, 'utf8');
      // Ruido conocido del dev-server (no son fallas): HMR de Next, warnings de Node/npm.
      const RUIDO = /Fast Refresh|full reload|DeprecationWarning|ExperimentalWarning|npm warn|punycode/i;
      // Firmas de error REAL: excepciones, rechazos no manejados, fallos de red/PG.
      const ERROR_REAL = /(Error:|\bERR_[A-Z]|UnhandledPromiseRejection|unhandledRejection|ECONNREFUSED|EADDRINUSE|ETIMEDOUT|\bFATAL\b|500 Internal)/;
      const errores = txt.split('\n').filter((l) => ERROR_REAL.test(l) && !RUIDO.test(l));
      return { ok: errores.length === 0, detalle: errores.length ? `${errores.length} error(es) real(es): ${errores[0]?.slice(0, 60)}` : 'limpios (ruido de HMR/warnings ignorado)' };
    });
  } else {
    add('Logs de backend', 'skip', 'define SOEC_LOG=<ruta> para escanear el log del proceso API');
  }

  await pool.end().catch(() => undefined);

  // ------------------------------------------------------------------ INFORME
  const fails = checks.filter((c) => c.estado === 'fail');
  const skips = checks.filter((c) => c.estado === 'skip');
  const apto = fails.length === 0;
  const icono = (e: Estado) => (e === 'ok' ? '✔' : e === 'fail' ? '✖' : '⚠');

  const grupos = [...new Set(checks.map((c) => c.grupo))];
  let md = `# PRE-FLIGHT REPORT — Sprint 0\n\n`;
  md += `- **Sello:** ${SELLO}\n- **API:** ${API} · **WEB:** ${WEB}\n`;
  md += `- **Total:** ${checks.length} · ✔ ${checks.filter((c) => c.estado === 'ok').length} · ✖ ${fails.length} · ⚠ ${skips.length}\n\n`;
  md += `## Resultado: ${apto ? '**APTO PARA SPRINT 0** ✅' : '**NO APTO** ⛔ — corregir las fallas antes de iniciar'}\n\n`;
  for (const g of grupos) {
    md += `### ${g}\n\n`;
    for (const c of checks.filter((x) => x.grupo === g)) {
      md += `- ${icono(c.estado)} ${c.nombre}${c.detalle ? ` — ${c.detalle}` : ''}\n`;
    }
    md += `\n`;
  }
  md += `> Nivel 1 (técnico, automático) verificado. **Nivel 2 (observación humana)** — ¿la experiencia se entiende, el Director confía, alguna palabra confunde? — NO lo cubre este check: lo responden los usuarios reales.\n`;
  md += `> El sandbox efímero de la prueba de flujo queda como evaluación CERRADA «preflight-check» en ${'`clinica-brille`'}; re-ejecuta el seed si quieres una lista impecable.\n`;

  const destino = new URL('../../../docs/piloto/PRE-FLIGHT-REPORT.md', import.meta.url);
  writeFileSync(destino, md, 'utf8');

  // Salida por consola
  console.log(`\n  PRE-FLIGHT CHECK — Sprint 0  (${SELLO})`);
  console.log('  ' + '─'.repeat(48));
  for (const g of grupos) {
    console.log(`  ${g}`);
    for (const c of checks.filter((x) => x.grupo === g)) console.log(`    ${icono(c.estado)} ${c.nombre}${c.detalle ? `  (${c.detalle})` : ''}`);
  }
  console.log('  ' + '─'.repeat(48));
  console.log(`  Resultado: ${apto ? 'APTO PARA SPRINT 0' : 'NO APTO — ' + fails.length + ' falla(s)'}`);
  console.log(`  Informe: docs/piloto/PRE-FLIGHT-REPORT.md\n`);

  process.exit(apto ? 0 : 1);
}

main().catch((e) => {
  console.error('Pre-flight abortado:', e);
  process.exit(2);
});
