/**
 * apps/api · SCRIPT · MODO SOMBRA de autonomía sobre datos REALES (FASE A0). SIN efecto externo.
 *
 *   npx tsx apps/api/scripts/autonomia-shadow.ts [organizationId] [--persistir]
 *
 * Lee la situación publicitaria real (campaña + search terms) desde la API de medición (solo lectura),
 * deriva un mandato conservador del perfil de la organización, y decide en SOMBRA qué haría SOEC con
 * los mismos gates que usaría la ejecución real. NO llama a ningún adaptador de escritura: las
 * mutaciones externas son 0. Con `--persistir`, guarda el informe de auditoría en `autonomia-sombra:<org>`.
 */
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { makePool, PgEventStore, runMigrations } from '@soec/event-store/pg';
import {
  INTERRUPTORES_TODOS_ON,
  ejecutarCicloCertificacion,
  evaluarElegibilidadMandato,
  type AccionPropuesta,
} from '@soec/autonomia';
import { construirMandatoConservador, evaluarSombraAds, type Termino } from '../src/autonomia/shadow-ads';
import { ORG_SMILEFLOW } from '../src/plataforma';
import {
  buscarFuentes,
  buscarPerfilComercial,
  buscarProfile,
  evaluarFundamentos,
  getBusiness,
  getProfile,
  getRecursoGoogleAds,
} from '../src/plataforma';

const ORG = process.argv.find((a) => a.startsWith('org-')) ?? ORG_SMILEFLOW;
const PERSISTIR = process.argv.includes('--persistir');
const API = process.env.SOEC_API_URL ?? 'http://localhost:3081';

interface Panel {
  ads?: { impressions: number; clicks: number; cost: number };
  searchTerms?: { termino: string; impresiones: number; clics: number }[];
}

async function main(): Promise<void> {
  const negocio = getBusiness(ORG);
  const ahora = new Date().toISOString();

  // ── Elegibilidad: ¿puede este negocio recibir autonomía de ejecución? ──────────
  const perfil = buscarProfile(ORG);
  const fundamentos = evaluarFundamentos(negocio, buscarFuentes(ORG), buscarPerfilComercial(ORG), perfil !== null, null);
  const adsConectado = buscarFuentes(ORG).some((f) => f.tipo === 'ADS' && (f.estado === 'CONNECTED_READ_ONLY' || f.estado === 'OBSERVED'));
  const elegibilidad = evaluarElegibilidadMandato({
    nivelSolicitado: 'LEVEL_3_AUTONOMOUS',
    fundamentosVeredicto: fundamentos.veredicto,
    cuentaPublicitariaConectada: adsConectado,
    motivosFundamentos: fundamentos.motivos.map((m) => m.codigo),
  });

  // SOMBRA es elegible cuando hay cuenta publicitaria conectada con evidencia real (aunque los
  // fundamentos para la ejecución REAL todavía falten). C Y P, sin Ads, no es elegible ni para sombra.
  const shadowElegible = adsConectado && perfil !== null;
  if (!shadowElegible) {
    console.log(JSON.stringify({
      organizationId: ORG, negocio: negocio.displayName,
      SHADOW_ELIGIBLE: 'NO', AUTONOMOUS_ELIGIBLE: 'NO', nivelConcedido: elegibilidad.nivelConcedido,
      blockers: elegibilidad.motivos, veredictoFundamentos: fundamentos.veredicto,
      REAL_MUTATIONS: 0,
    }, null, 2));
    return;
  }

  // ── Datos reales (solo lectura) desde la API de medición ───────────────────────
  const r = await fetch(`${API}/medicion/panel`, { headers: { 'x-organization-id': ORG, 'x-actor-id': 'autonomia-shadow', 'x-scope': 'events:read' } });
  const panel = (await r.json()) as Panel;
  const terminos: Termino[] = (panel.searchTerms ?? []).map((t) => ({ termino: t.termino, impresiones: t.impresiones, clics: t.clics }));

  const mandato = construirMandatoConservador({
    organizationId: ORG,
    businessKey: negocio.businessKey,
    externalAccountId: getRecursoGoogleAds(ORG).customerId,
    limites: getProfile(ORG).limitesAutonomia,
    nivel: 'LEVEL_3_AUTONOMOUS',
    ahora,
    diasVigencia: 30,
  });

  const sombra = evaluarSombraAds({
    mandato,
    interruptores: INTERRUPTORES_TODOS_ON,
    ahora,
    gastoDiario: panel.ads?.cost ?? 0,
    gastoMensual: panel.ads?.cost ?? 0,
    gastoDiarioPrevio: panel.ads?.cost ?? 0,
    cambiosHoy: 0,
    terminos,
  });

  const informe = {
    organizationId: ORG,
    negocio: negocio.displayName,
    SHADOW_ELIGIBLE: 'SI',
    REAL_LEVEL_3_ELIGIBLE: elegibilidad.elegible ? 'SI' : 'NO',
    blockersParaReal: elegibilidad.elegible ? [] : elegibilidad.motivos,
    nivelMandato: mandato.nivel,
    mandatoVigenteHasta: mandato.validUntil,
    SITUACIONES_EVALUADAS: sombra.situacionesEvaluadas,
    WOULD_EXECUTE: sombra.reporte.wouldExecute,
    WOULD_REQUIRE_APPROVAL: sombra.reporte.wouldRequireApproval,
    WOULD_OBSERVE_MORE: sombra.reporte.wouldObserveMore,
    WOULD_DENY: sombra.reporte.wouldDeny,
    REVISAR_MENSAJE: sombra.revisarMensaje,
    EXTERNAL_MUTATIONS: sombra.reporte.mutacionesExternas,
    dentalink_agenda: sombra.evaluacionesTermino.find((e) => e.termino.includes('dentalink'))?.accion ?? 'N/A',
    AUTONOMOUS_REAL: false,
  };
  console.log('\n=== REAL_COMMERCIAL_SHADOW (decisión con datos reales, 0 efecto externo) ===');
  console.log(JSON.stringify(informe, null, 2));

  // ── CERTIFICATION_SIMULATION — separada, ficticia, jamás una decisión comercial ────────────────
  if (process.argv.includes('--certificacion')) {
    const accionFicticia: AccionPropuesta = {
      actionId: 'CERT:FIXTURE:termino-ficticio-irrelevante',
      organizationId: ORG,
      businessKey: negocio.businessKey,
      externalAccountId: getRecursoGoogleAds(ORG).customerId,
      targetId: getRecursoGoogleAds(ORG).customerId,
      tipo: 'SEARCH_TERM_EXCLUDE',
      desiredState: 'excluded',
      evidencia: { muestra: 999, ventanaHoras: 168 },
      credentialRefOwnerOrg: ORG,
      rollbackDisponible: true,
      aprobacion: null,
      mandateVersionVista: mandato.version,
    };
    const ciclo = ejecutarCicloCertificacion(
      accionFicticia,
      { mandato, interruptores: INTERRUPTORES_TODOS_ON, ahora, gastoDiario: 0, gastoMensual: 0, gastoDiarioPrevio: 0, cambiosUltimaHora: 0, cambiosHoy: 0, cambiosCampaniaHoy: 0, enCooldown: false, accionesYaEjecutadas: [] },
      'EXITO',
      { muestra: 200, muestraMinima: 30, mejora: true },
    );
    console.log('\n=== CERTIFICATION_SIMULATION · SIMULATION_ONLY — NO ES UNA DECISIÓN COMERCIAL ===');
    console.log(JSON.stringify({
      LIFECYCLE: ciclo.estados,
      DECISION_GATE: ciclo.decisionGate,
      READ_BACK: ciclo.readBackVerificado,
      MEASUREMENT: ciclo.medicion,
      EXTERNAL_MUTATIONS: ciclo.mutacionesExternas,
      BLIND_RETRY: ciclo.reintentoCiego,
    }, null, 2));
  }

  if (PERSISTIR) {
    const pool = makePool();
    try {
      await runMigrations(pool);
      const store = new PgEventStore(pool);
      const o = OrganizationId(ORG);
      const ctx: RequestContext = { organizationId: o, actor: ActorId('autonomia-shadow'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `autonomia-shadow-${ORG}` };
      const attribution: Attribution = { source: 'autonomia-shadow', purpose: 'decisión en modo sombra, sin efecto externo', assumptions: ['AUTONOMOUS_REAL=false', 'sin adaptador de escritura', 'mutaciones externas = 0'], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
      const streamId = `autonomia-sombra:${ORG}`;
      const eventos = await store.readStream(ctx, streamId);
      await store.append(ctx, streamId, eventos.length, [{ type: 'autonomia.sombra.evaluada', payload: { ...informe, mandato, decisiones: sombra.reporte.decisiones, at: ahora }, attribution, occurredAt: ahora }]);
      console.log(`\nAuditoría persistida en ${streamId} (sin efecto externo).`);
    } finally {
      await pool.end();
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
