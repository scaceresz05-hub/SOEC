/**
 * Orquestador del piloto SmileFlow (Bloque J). Ejecuta el ciclo COMPLETO del Director de
 * Marketing Autónomo V1 sobre un único event-store, con `@soec/autonomia` gobernando cada
 * acción con efecto. Encadena y devuelve todos los identificadores para verificar la
 * trazabilidad hacia atrás hasta la evidencia inicial:
 *
 *   objetivo → decisión → campaña → contenido → autorización → ejecución(simulada) →
 *   medición → experimento → aprendizaje → siguiente decisión
 *
 * No hay efectos externos reales: la ejecución es simulada y toda acción pasa por autorización.
 */
import { type EventStore, type RequestContext, ActorId, OrganizationId } from '@soec/contracts';
import { DecisionMktService } from '@soec/decisiones-mkt';
import { CampaniaService, POLITICA_CAMPANIA_CONSERVADORA } from '@soec/campanias';
import { ContenidoGobernadoService } from '@soec/contenido-gobernado';
import { AdaptadorSimuladoDeterminista, EjecucionService, type EscenarioEjecucion } from '@soec/ejecucion-simulada';
import { evaluarExperimento, evaluarResultadoCampania, type Experimento, type ResultadoCampania } from '@soec/medicion';
import { AprendizajeService, observadoDesdeExperimento } from '@soec/aprendizaje';
import { AutonomiaService } from '@soec/autonomia';
import { componerVistaDirector, type VistaCicloDirector } from '@soec/director-workspace';
import { AHORA, ATRIBUCION, FUTURO, OBJETIVO_ID, ORG_SMILEFLOW, T0, campaniaSmileFlow, contenidoSmileFlow, decisionSmileFlow } from './fixture';

export interface TrazaPiloto {
  readonly objetivoId: string;
  readonly decisionId: string;
  readonly campaignId: string;
  readonly contentId: string;
  readonly approvalId: string;
  readonly executionId: string;
  readonly measurementId: string;
  readonly experimentId: string;
  readonly learningId: string;
  readonly nextDecisionId: string;
  readonly resultado: ResultadoCampania;
  readonly vista: VistaCicloDirector;
}

function ctx(org: string): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('soec-director'), scope: { organizationId: o, permissions: ['events:append', 'events:read', 'decisiones:decidir'] }, correlationId: `piloto-${org}` };
}

/** Ejecuta el ciclo completo y devuelve la traza. `escenarioEjecucion` permite forzar fallos. */
export async function ejecutarPiloto(store: EventStore, escenarioEjecucion: EscenarioEjecucion = 'SUCCESS'): Promise<TrazaPiloto> {
  const org = ORG_SMILEFLOW;
  const c = ctx(org);

  const decisiones = new DecisionMktService(store);
  const campanias = new CampaniaService(store);
  const contenidos = new ContenidoGobernadoService(store);
  const autonomia = new AutonomiaService(store);
  const ejecuciones = new EjecucionService(store, new AdaptadorSimuladoDeterminista('adaptador-piloto', escenarioEjecucion));
  const aprendizajes = new AprendizajeService(store);

  // Política de autonomía: el humano fija el nivel (SOEC no puede subirlo).
  await autonomia.establecerPolitica(c, 2, ATRIBUCION, T0);

  // 1) Decisión aprobada (deriva del objetivo estratégico).
  const decisionId = 'd1';
  await decisiones.crear(c, decisionId, decisionSmileFlow(org), ATRIBUCION, T0);
  await decisiones.transicionar(c, decisionId, 'PENDIENTE_APROBACION', ATRIBUCION, T0);
  await decisiones.transicionar(c, decisionId, 'APROBADA', ATRIBUCION, T0);

  // 2) Campaña gobernada derivada de la decisión.
  const campaignId = 'camp1';
  const campania = await campanias.crearDesdeDecision(c, campaignId, campaniaSmileFlow(org, decisionId), POLITICA_CAMPANIA_CONSERVADORA, ATRIBUCION, T0);

  // 3) Contenido gobernado derivado de la campaña, revisado y aprobado.
  const contentId = 'cont1';
  await contenidos.derivarDeCampania(c, contentId, campania, contenidoSmileFlow(), ATRIBUCION, T0);
  await contenidos.transicionar(c, contentId, 'EN_REVISION', ATRIBUCION, T0);
  await contenidos.transicionar(c, contentId, 'APROBADO', ATRIBUCION, T0);

  // 4) Autorización humana para programar y publicar (simulado). Sin esto, nada corre.
  await autonomia.otorgarAutorizacion(c, { accion: 'PROGRAMAR', entidadRef: contentId, actorHumano: 'director-humano', otorgadaEn: T0, expiraEn: FUTURO }, ATRIBUCION, T0);
  await autonomia.otorgarAutorizacion(c, { accion: 'PUBLICAR_SIMULADO', entidadRef: contentId, actorHumano: 'director-humano', otorgadaEn: T0, expiraEn: FUTURO }, ATRIBUCION, T0);

  const trasProgramar = await autonomia.puedeEjecutar(c, 'PROGRAMAR', contentId, AHORA);
  if (!trasProgramar.permitida) throw new Error(`el piloto no pudo programar: ${trasProgramar.motivo}`);
  await contenidos.transicionar(c, contentId, 'PROGRAMADO', ATRIBUCION, T0);

  // 5) Ejecución SIMULADA, gobernada por autonomía (iniciar → ejecutar → finalizar).
  const accionId = 'acc-publicar-1';
  await autonomia.iniciarAccion(c, accionId, 'PUBLICAR_SIMULADO', contentId, AHORA, ATRIBUCION, AHORA);
  const ejec = await ejecuciones.ejecutar(c, { organizacionId: org, contenidoId: contentId, campaniaId: campaignId, canal: 'correo', idempotencyKey: `pub:${contentId}`, escenario: escenarioEjecucion }, ATRIBUCION, AHORA);
  const puedeSeguir = await autonomia.puedeContinuar(c, accionId);
  if (puedeSeguir.permitida && ejec.registro.resultado === 'PUBLICADA_SIMULADA') {
    await autonomia.finalizarAccion(c, accionId, ATRIBUCION, AHORA);
    await contenidos.transicionar(c, contentId, 'PUBLICADO_SIMULADO', ATRIBUCION, T0);
  }
  const approval = (await autonomia.cargar(c)).autorizaciones.find((a) => a.accion === 'PUBLICAR_SIMULADO')!;

  // 6) Medición: la campaña se ejecutó de forma SIMULADA (Bloque E), por lo que su gasto y sus
  // ingresos son SIMULADOS. Coherencia con Bloque F: el ROI se clasifica SIMULADO, jamás REAL.
  // Una campaña productiva con ingresos observados y atribuidos sería otro camino (ver tests F/I).
  const measurementId = `med:${campaignId}`;
  const resultado = evaluarResultadoCampania({
    organizacionId: org,
    campaignRef: campaignId,
    ventana: '2026-08',
    gasto: { valor: 100000, procedencia: 'SIMULADA' },
    ingresos: { valor: 260000, procedencia: 'SIMULADA' },
    conversiones: [{ id: 'v1', externalRef: null, campaignRef: campaignId, valor: 260000, ocurridoEn: '2026-08-15T00:00:00.000Z' }],
    periodoCompleto: true,
  });

  // 7) Experimento A/B: la variante con prueba social gana con evidencia suficiente.
  const experimentId = 'exp1';
  const exp: Experimento = {
    experimentoId: experimentId,
    hipotesis: 'la prueba social aumenta la conversión',
    metricaPrincipal: 'conversiones',
    control: { actividadId: 'a1', publicationId: 'p1' },
    variante: { actividadId: 'a2', publicationId: 'p2' },
    minimoObservaciones: 100,
    margenMinimo: 0.1,
  };
  const resultadoExp = evaluarExperimento(exp, 40, 500, 60, 500);

  // 8) Aprendizaje estructurado sobre el experimento.
  const learningId = 'apr1';
  await aprendizajes.registrar(
    c,
    learningId,
    {
      observado: observadoDesdeExperimento(experimentId, resultadoExp, 1000),
      interpretacion: { texto: 'la prueba social parece impulsar la conversión', supuestos: ['audiencia comparable'], confianza: 'media' },
      conclusion: { enunciado: 'incluir prueba social en el mensaje principal', soporte: 'evidencia_suficiente', accionRecomendada: 'adoptar la variante' },
      reutilizable: { enunciado: 'la prueba social mejora conversión en clínicas dentales pyme', condiciones: ['audiencia pyme'], ambitoSugerido: [org] },
    },
    ATRIBUCION,
    AHORA,
  );

  // 9) Siguiente decisión: cierra el lazo, referenciando el aprendizaje que la origina.
  const nextDecisionId = 'd2';
  await decisiones.crear(c, nextDecisionId, decisionSmileFlow(org, { objetivo: `${OBJETIVO_ID}: consolidar prueba social`, aprendizajeQueLaCambio: learningId }), ATRIBUCION, AHORA);

  // Vista del ciclo (Bloque I) con la evidencia real del piloto.
  const estadoAutonomia = await autonomia.cargar(c);
  const ejecucionEstado = await ejecuciones.cargar(c, contentId);
  const contenidoEstado = await contenidos.cargar(c, contentId);
  const aprendizajeEstado = await aprendizajes.cargar(c, learningId);
  const vista = componerVistaDirector({
    organizacionActiva: org,
    autonomia: estadoAutonomia,
    objetivo: { texto: `${OBJETIVO_ID}: generar solicitudes de demostración`, decisionId },
    justificacion: 'la señal activa es POCAS_SOLICITUDES',
    evaluable: true,
    faltantes: [],
    campanias: [campania],
    contenidos: [contenidoEstado],
    ejecuciones: [ejecucionEstado],
    resultado,
    aprendizajes: [aprendizajeEstado],
  });

  return {
    objetivoId: OBJETIVO_ID,
    decisionId,
    campaignId,
    contentId,
    approvalId: approval.id,
    executionId: ejec.registro.requestId,
    measurementId,
    experimentId,
    learningId,
    nextDecisionId,
    resultado,
    vista,
  };
}
