/**
 * Semilla de escenarios de demostración del Sprint 0 (F2-PILOT-00).
 *
 *   npx tsx apps/api/scripts/seed-piloto.ts            # crea/repone los 3 casos
 *   DATABASE_URL=... npx tsx apps/api/scripts/seed-piloto.ts
 *
 * Crea tres evaluaciones de demostración (Caso A/B/C) sobre organizaciones del catálogo.
 * Es REPRODUCIBLE y NO DESTRUCTIVO: al re-ejecutarse, ARCHIVA las evaluaciones anteriores
 * (append-only, sin borrar eventos ni perder procedencia) y crea unas nuevas, de modo que
 * cada participante recibe un escenario limpio sin contaminar al anterior. No toma
 * decisiones: deja las evaluaciones listas para que el Director las gobierne.
 */
import { makePool, PgEventStore } from '@soec/event-store/pg';
import { systemClock } from '@soec/event-store';
import { ActorId, type Attribution, OrganizationId, type RequestContext } from '@soec/contracts';
import { crearBibliotecaClinicaDental } from '@soec/rubros';
import { EvaluacionService, type EntradaRespuesta, type TipoPregunta } from '@soec/evaluacion';

const DEP = 'marketing';
const RUBRO_ID = 'clinica-dental';
const ATRIB: Attribution = {
  source: 'seed-piloto',
  purpose: 'preparar escenarios de demostración del Sprint 0',
  assumptions: ['datos sintéticos de demostración'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};

const rubro = crearBibliotecaClinicaDental();
const senalPregunta = (nombre: string) => rubro.senales().find((s) => s.nombre === nombre)!.preguntaId;
const tipoDe = (preguntaId: string): TipoPregunta =>
  rubro.senales().some((s) => s.preguntaId === preguntaId && typeof s.condicionActivacion.valor === 'boolean') ? 'CERRADA_BOOLEAN' : 'ABIERTA';

const Q_POCAS = senalPregunta('POCAS_SOLICITUDES');
const Q_AGENDA = senalPregunta('BAJA_TASA_AGENDAMIENTO');
const Q_NOSHOW = senalPregunta('ALTO_NO_SHOW');
const Q_RECOMPRA = senalPregunta('POCA_RECOMPRA');

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('seed'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `seed-${org}` };
}

async function main() {
  const pool = makePool();
  const store = new PgEventStore(pool);
  const svc = new EvaluacionService(store);
  const now = () => systemClock.now();

  async function reponer(org: string): Promise<string> {
    // Archiva las evaluaciones no archivadas anteriores (reset seguro, no destructivo).
    for (const r of await svc.listar(ctx(org), DEP)) {
      if (r.estado !== 'ARCHIVADA') await svc.archivar(ctx(org), DEP, r.evaluacionId, ATRIB, now());
    }
    const evaluacionId = randomId();
    await svc.iniciar(ctx(org), DEP, evaluacionId, RUBRO_ID, 'Evaluación de demostración', ATRIB, now());
    return evaluacionId;
  }
  const responder = (org: string, id: string, preguntaId: string, entrada: EntradaRespuesta) =>
    svc.responder(ctx(org), DEP, id, { preguntaId, tipoPregunta: tipoDe(preguntaId), entrada }, ATRIB, now());
  const generar = (org: string, id: string) => svc.generar(ctx(org), DEP, id, randomId(), ATRIB, now());

  // Caso A — evidencia suficiente (clinica-brille): señales claras → candidatos con confianza.
  {
    const org = 'clinica-brille';
    const id = await reponer(org);
    await responder(org, id, Q_POCAS, { clase: 'CERRADA', valorCrudo: 'sí' });
    await responder(org, id, Q_NOSHOW, { clase: 'CERRADA', valorCrudo: 'sí' });
    await responder(org, id, '¿Qué tratamientos ofrece?', { clase: 'ABIERTA', texto: 'Ortodoncia, implantes y estética' });
    await responder(org, id, '¿Cuál es su ticket o sus tratamientos de alto valor?', { clase: 'ABIERTA', texto: 'Ticket medio-alto en implantes' });
    await responder(org, id, '¿Cuál es su capacidad de agenda?', { clase: 'ABIERTA', texto: 'Hay holgura en la agenda' });
    await generar(org, id);
    imprimir('A', org, id, 'evidencia suficiente → candidatos con confianza');
  }

  // Caso B — evidencia incompleta (clinica-nova): faltantes/incertidumbre; cobertura parcial.
  {
    const org = 'clinica-nova';
    const id = await reponer(org);
    await responder(org, id, Q_POCAS, { clase: 'CERRADA', valorCrudo: 'sí' });
    await responder(org, id, '¿De dónde vienen hoy sus pacientes?', { clase: 'SIN_INFORMACION' });
    await generar(org, id);
    imprimir('B', org, id, 'evidencia incompleta → faltantes y cobertura parcial');
  }

  // Caso C — información ambigua o corregida (clinica-aurora): no normalizable + corrección + 2 generaciones.
  {
    const org = 'clinica-aurora';
    const id = await reponer(org);
    await responder(org, id, Q_POCAS, { clase: 'CERRADA', valorCrudo: 'a veces' }); // NO_NORMALIZABLE
    await responder(org, id, Q_NOSHOW, { clase: 'CERRADA', valorCrudo: 'sí' });
    await generar(org, id); // primera generación (con POCAS indeterminada)
    await responder(org, id, Q_POCAS, { clase: 'CERRADA', valorCrudo: 'sí' }); // corrección
    await responder(org, id, Q_RECOMPRA, { clase: 'CERRADA', valorCrudo: 'sí' }); // activa otra señal
    await responder(org, id, Q_AGENDA, { clase: 'CERRADA', valorCrudo: 'quizás' }); // queda NO_NORMALIZABLE
    await generar(org, id); // segunda generación (la anterior se preserva)
    imprimir('C', org, id, 'no normalizable + corrección + 2 generaciones (procedencia preservada)');
  }

  await pool.end();
}

// Id pseudoaleatorio sin depender de crypto.randomUUID (suficiente para demo/seed).
let contador = 0;
function randomId(): string {
  contador += 1;
  return `seed-${Date.now().toString(36)}-${contador.toString(36)}`;
}

const WEB = process.env.SOEC_WEB_URL ?? 'http://localhost:3080';
function imprimir(caso: string, org: string, id: string, nota: string) {
  console.log(`  Caso ${caso} · ${org} — ${nota}`);
  console.log(`     Evaluación:  ${WEB}/evaluacion?org=${org}&departamento=${DEP}&evaluacionId=${id}`);
  console.log(`     Workspace:   ${WEB}/director-workspace?org=${org}&departamento=${DEP}&evaluacionId=${id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
