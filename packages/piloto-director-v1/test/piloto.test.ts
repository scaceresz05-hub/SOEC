/**
 * Piloto SmileFlow completo y adversarial (Bloque J). Valida el ciclo end-to-end del Director
 * de Marketing Autónomo V1 con TRAZABILIDAD HACIA ATRÁS hasta la evidencia inicial, y ocho
 * escenarios adversariales que el gobierno debe rechazar o clasificar honestamente.
 *
 * Comando reproducible: `npx pnpm@9.15.4 exec vitest run packages/piloto-director-v1`.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type EventStore, type RequestContext } from '@soec/contracts';
import { DecisionMktService } from '@soec/decisiones-mkt';
import { CampaniaService, CampaniaInvalidaError, POLITICA_CAMPANIA_CONSERVADORA } from '@soec/campanias';
import { EjecucionService, AdaptadorSimuladoDeterminista } from '@soec/ejecucion-simulada';
import { evaluarResultadoCampania } from '@soec/medicion';
import { AutonomiaService, AutonomiaInvalidaError } from '@soec/autonomia';
import { ejecutarPiloto } from '../src/piloto';
import { ATRIBUCION, AHORA, T0, FUTURO, ORG_SMILEFLOW, campaniaSmileFlow, decisionSmileFlow } from '../src/fixture';

function ctx(org = ORG_SMILEFLOW): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('soec-director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
}

async function decisionAprobada(store: EventStore, org: string, id: string): Promise<void> {
  const svc = new DecisionMktService(store);
  await svc.crear(ctx(org), id, decisionSmileFlow(org), ATRIBUCION, T0);
  await svc.transicionar(ctx(org), id, 'PENDIENTE_APROBACION', ATRIBUCION, T0);
  await svc.transicionar(ctx(org), id, 'APROBADA', ATRIBUCION, T0);
}

describe('@soec/piloto-director-v1 · ciclo completo con trazabilidad hacia atrás', () => {
  it('encadena objetivo→decisión→campaña→contenido→autorización→ejecución→medición→experimento→aprendizaje→siguiente decisión', async () => {
    const store = new InMemoryEventStore();
    const t = await ejecutarPiloto(store);

    // La cadena existe en su totalidad.
    for (const id of [t.objetivoId, t.decisionId, t.campaignId, t.contentId, t.approvalId, t.executionId, t.measurementId, t.experimentId, t.learningId, t.nextDecisionId]) {
      expect(id).toBeTruthy();
    }

    // Trazabilidad hacia atrás: cada eslabón referencia al anterior hasta la evidencia inicial.
    const campania = await new CampaniaService(store).cargar(ctx(), t.campaignId);
    expect(campania.decisionId).toBe(t.decisionId); // campaña → decisión

    const contenidos = await import('@soec/contenido-gobernado');
    const contenido = await new contenidos.ContenidoGobernadoService(store).cargar(ctx(), t.contentId);
    expect(contenido.campaniaId).toBe(t.campaignId); // contenido → campaña
    expect(contenido.decisionId).toBe(t.decisionId); // contenido → decisión
    expect(contenido.estado).toBe('PUBLICADO_SIMULADO');

    const ejec = await new EjecucionService(store, new AdaptadorSimuladoDeterminista()).cargar(ctx(), t.contentId);
    expect(ejec.registros[0]!.contenidoId).toBe(t.contentId); // ejecución → contenido
    expect(ejec.registros[0]!.campaniaId).toBe(t.campaignId); // ejecución → campaña
    expect(ejec.publicacionesSimuladas).toBe(1);

    expect(t.resultado.campaignRef).toBe(t.campaignId); // medición → campaña
    // COHERENCIA: la campaña se ejecutó de forma simulada ⇒ su ROI es SIMULADO, nunca REAL.
    expect(t.resultado.clasificacion).toBe('SIMULADO');
    expect(t.resultado.concluyente).toBe(false);
    expect(t.resultado.roiReal).toBeNull();

    const aprendizajes = await import('@soec/aprendizaje');
    const aprendizaje = await new aprendizajes.AprendizajeService(store).cargar(ctx(), t.learningId);
    expect(aprendizaje.observado?.experimentoId).toBe(t.experimentId); // aprendizaje → experimento

    const next = await new DecisionMktService(store).cargar(ctx(), t.nextDecisionId);
    expect(next.aprendizajeQueLaCambio).toBe(t.learningId); // siguiente decisión → aprendizaje (cierre del lazo)

    // La vista del Director declara el ROI como SIMULADO (no REAL) y no está en modo seguro.
    expect(t.vista.resultado.naturaleza).toBe('SIMULADO');
    expect(t.vista.modoSeguro).toBe(false);
    expect(t.vista.proximaRecomendacion).toContain('no es concluyente');
  });
});

describe('@soec/piloto-director-v1 · escenarios adversariales', () => {
  it('1. falta público (decisión NO_EVALUABLE) ⇒ no puede derivarse campaña', async () => {
    const store = new InMemoryEventStore();
    await new DecisionMktService(store).crear(ctx(), 'd1', decisionSmileFlow(ORG_SMILEFLOW, { faltantesObligatorios: ['público'] }), ATRIBUCION, T0);
    await expect(new CampaniaService(store).crearDesdeDecision(ctx(), 'camp1', campaniaSmileFlow(), POLITICA_CAMPANIA_CONSERVADORA, ATRIBUCION, T0)).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('2. falta presupuesto (monto 0) ⇒ campaña rechazada', async () => {
    const store = new InMemoryEventStore();
    await decisionAprobada(store, ORG_SMILEFLOW, 'd1');
    await expect(
      new CampaniaService(store).crearDesdeDecision(ctx(), 'camp1', campaniaSmileFlow(ORG_SMILEFLOW, 'd1', { presupuesto: { monto: 0, moneda: 'CLP' } }), POLITICA_CAMPANIA_CONSERVADORA, ATRIBUCION, T0),
    ).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('3. evidencia contradictoria (ingresos declarados sin conversiones atribuidas) ⇒ resultado no concluyente', () => {
    const r = evaluarResultadoCampania({
      organizacionId: ORG_SMILEFLOW,
      campaignRef: 'camp1',
      ventana: '2026-08',
      gasto: { valor: 100000, procedencia: 'OBSERVADA' },
      ingresos: { valor: 300000, procedencia: 'OBSERVADA' },
      conversiones: [{ id: 'v1', externalRef: null, campaignRef: null, valor: 300000, ocurridoEn: '2026-08-10T00:00:00.000Z' }],
      periodoCompleto: true,
    });
    expect(r.concluyente).toBe(false);
    expect(r.roiReal).toBeNull();
  });

  it('4. autonomía insuficiente (sin autorización) ⇒ no se puede iniciar la publicación', async () => {
    const store = new InMemoryEventStore();
    const autonomia = new AutonomiaService(store);
    await autonomia.establecerPolitica(ctx(), 2, ATRIBUCION, T0);
    await expect(autonomia.iniciarAccion(ctx(), 'acc1', 'PUBLICAR_SIMULADO', 'cont1', AHORA, ATRIBUCION, AHORA)).rejects.toBeInstanceOf(AutonomiaInvalidaError);
  });

  it('5. campaña de otra organización ⇒ rechazada', async () => {
    const store = new InMemoryEventStore();
    await decisionAprobada(store, 'otra-org', 'd1'); // decisión aprobada, pero en otra org
    await expect(new CampaniaService(store).crearDesdeDecision(ctx(ORG_SMILEFLOW), 'camp1', campaniaSmileFlow(ORG_SMILEFLOW, 'd1'), POLITICA_CAMPANIA_CONSERVADORA, ATRIBUCION, T0)).rejects.toBeInstanceOf(CampaniaInvalidaError);
  });

  it('6. publicación duplicada ⇒ una sola publicación simulada', async () => {
    const store = new InMemoryEventStore();
    const svc = new EjecucionService(store, new AdaptadorSimuladoDeterminista('a', 'SUCCESS'));
    const cmd = { organizacionId: ORG_SMILEFLOW, contenidoId: 'cont1', campaniaId: 'camp1', canal: 'correo', idempotencyKey: 'k1' };
    await svc.ejecutar(ctx(), cmd, ATRIBUCION, AHORA);
    const segunda = await svc.ejecutar(ctx(), cmd, ATRIBUCION, AHORA);
    expect(segunda.duplicada).toBe(true);
    expect(segunda.estado.publicacionesSimuladas).toBe(1);
  });

  it('7. error transitorio ⇒ fallo temporal reintentable, sin publicación', async () => {
    const store = new InMemoryEventStore();
    const svc = new EjecucionService(store, new AdaptadorSimuladoDeterminista('a', 'TEMPORARY_FAILURE'));
    const r = await svc.ejecutar(ctx(), { organizacionId: ORG_SMILEFLOW, contenidoId: 'cont1', campaniaId: 'camp1', canal: 'correo', idempotencyKey: 'k1' }, ATRIBUCION, AHORA);
    expect(r.registro.resultado).toBe('FALLIDA_TEMPORAL');
    expect(r.registro.reintentable).toBe(true);
    expect(r.estado.publicacionesSimuladas).toBe(0);
  });

  it('8. PAUSA durante la ejecución ⇒ la acción en vuelo no puede continuar', async () => {
    const store = new InMemoryEventStore();
    const autonomia = new AutonomiaService(store);
    await autonomia.establecerPolitica(ctx(), 2, ATRIBUCION, T0);
    await autonomia.otorgarAutorizacion(ctx(), { accion: 'PUBLICAR_SIMULADO', entidadRef: 'cont1', actorHumano: 'director-humano', otorgadaEn: T0, expiraEn: FUTURO }, ATRIBUCION, T0);
    await autonomia.iniciarAccion(ctx(), 'acc1', 'PUBLICAR_SIMULADO', 'cont1', AHORA, ATRIBUCION, AHORA);
    await autonomia.pausar(ctx(), 'anomalía en vuelo', ATRIBUCION, AHORA);
    const v = await autonomia.puedeContinuar(ctx(), 'acc1');
    expect(v.permitida).toBe(false);
  });
});
