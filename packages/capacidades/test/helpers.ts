import { ActorId, type Attribution, OrganizationId, type RequestContext } from '@soec/contracts';
import { FixedClock, InMemoryEventStore } from '@soec/event-store';
import { MedService, MdmService } from '@soec/models';
import { EceBuildService, EceQueryService } from '@soec/ece';
import { MecanismoDeterministico, MecanismoSimuladoIA, OperacionesService } from '@soec/operaciones';
import { CapabilityRegistry } from '../src/app/registry';
import { CapabilitiesOrchestrator } from '../src/app/orchestrator';
import { CapabilityQueryService } from '../src/app/query-service';
import type { DefinicionInput } from '../src/app/registry';

export const attr: Attribution = {
  source: 'fixture-sintetico',
  purpose: 'prueba F1-CAP-01',
  assumptions: ['dato sintético; ninguna empresa real'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};
export function ctxFor(org: string, permissions: string[] = ['events:append', 'events:read']): RequestContext {
  const organizationId = OrganizationId(org);
  return { organizationId, actor: ActorId('tester'), scope: { organizationId, permissions }, correlationId: `corr-${org}` };
}
export const cmdBase = { attribution: attr, occurredAt: '2026-03-01T00:00:00.000Z' };
const ambitoMed = { proposito: 'p', representa: 'r', excluye: 'MDM', supuestos: [] };
const ambitoMdm = { proposito: 'p', representa: 'r', excluye: 'MED', supuestos: [] };
const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

export interface Entorno {
  store: InMemoryEventStore;
  clock: FixedClock;
  med: MedService;
  mdm: MdmService;
  eceBuild: EceBuildService;
  eceQuery: EceQueryService;
  operaciones: OperacionesService;
  registry: CapabilityRegistry;
  orchestrator: CapabilitiesOrchestrator;
  capQuery: CapabilityQueryService;
}

export function montar(): Entorno {
  const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
  const store = new InMemoryEventStore(clock);
  const med = new MedService(store);
  const mdm = new MdmService(store);
  const eceQuery = new EceQueryService(store, med, mdm);
  const operaciones = new OperacionesService(store, eceQuery, [new MecanismoDeterministico(), new MecanismoSimuladoIA()]);
  const registry = new CapabilityRegistry(store);
  return {
    store,
    clock,
    med,
    mdm,
    eceBuild: new EceBuildService(store, med, mdm),
    eceQuery,
    operaciones,
    registry,
    orchestrator: new CapabilitiesOrchestrator(store, registry, operaciones),
    capQuery: new CapabilityQueryService(store),
  };
}

/** Siembra un ECE 'ece1' con una contradicción intra-MED. */
export async function eceConContradiccion(e: Entorno, ctx = ctxFor('orgA')): Promise<RequestContext> {
  await e.med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...cmdBase });
  await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'media', ...cmdBase });
  await e.med.incorporarEvidencia(ctx, { instanceId: 'm1', evidenciaId: 'a1-si', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'A', contenido: 'c', ...cmdBase });
  await e.med.incorporarEvidencia(ctx, { instanceId: 'm1', evidenciaId: 'a1-no', afirmacionId: 'a1', relacion: 'debilita', procedencia: 'B', contenido: 'c', ...cmdBase });
  await e.mdm.crear(ctx, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...cmdBase });
  await e.eceBuild.construir(ctx, { eceId: 'ece1', medInstanceId: 'm1', mdmInstanceId: 'w1', ...cmdBase });
  return ctx;
}

/** Siembra un ECE 'ece1' con solo coherencia (sin tensiones). */
export async function eceConCoherencia(e: Entorno, ctx = ctxFor('orgA')): Promise<RequestContext> {
  await e.med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...cmdBase });
  await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', enunciado: 'x', dimension: 'hace', incertidumbre: 'baja', ...cmdBase });
  await e.med.incorporarEvidencia(ctx, { instanceId: 'm1', evidenciaId: 'a1-si', afirmacionId: 'a1', relacion: 'sostiene', procedencia: 'A', contenido: 'c', ...cmdBase });
  await e.med.revisarAfirmacion(ctx, { instanceId: 'm1', afirmacionId: 'a1', nuevoEstado: 'respaldada', motivo: 'ok', ...cmdBase });
  await e.mdm.crear(ctx, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...cmdBase });
  await e.eceBuild.construir(ctx, { eceId: 'ece1', medInstanceId: 'm1', mdmInstanceId: 'w1', ...cmdBase });
  return ctx;
}

// ── Definiciones sintéticas de capacidad (FIXTURES; no taxonomía permanente) ──
export function defEsclarecerSimple(): DefinicionInput {
  return {
    nombre: 'esclarecer-estado',
    proposito: 'que la persona comprenda un elemento del estado',
    familia: 'comprender-el-estado',
    pasos: [{ stepId: 'e1', operacion: 'esclarecer', porque: 'hacer comprensible un elemento', dependeDe: [], usaProductoDe: null, objetivoElementoId: null, horizonte: null, obligatorio: true }],
    condicionesEntrada: ['existe un ECE con el elemento objetivo'],
    condicionesAbstencion: ['sin elemento objetivo'],
    contrato: { entrega: 'un esclarecimiento atribuible', limite: 'no decide' },
    componeCapacidades: [],
    vigencia,
    atribucion: attr,
  };
}
export function defDetectarOrientar(): DefinicionInput {
  return {
    nombre: 'detectar-y-orientar',
    proposito: 'que la persona sepa qué merece atención y qué considerar',
    familia: 'orientar-una-decision',
    pasos: [
      { stepId: 'd1', operacion: 'detectar', porque: 'hacer visible lo no visto', dependeDe: [], usaProductoDe: null, objetivoElementoId: null, horizonte: null, obligatorio: true },
      { stepId: 'o1', operacion: 'orientar', porque: 'ofrecer consideraciones a partir de lo detectado', dependeDe: ['d1'], usaProductoDe: 'd1', objetivoElementoId: null, horizonte: null, obligatorio: true },
    ],
    condicionesEntrada: [],
    condicionesAbstencion: ['detección sin sustento'],
    contrato: { entrega: 'señales y consideraciones', limite: 'no decide ni ejecuta' },
    componeCapacidades: [],
    vigencia,
    atribucion: attr,
  };
}
export function defAnticipar(): DefinicionInput {
  return {
    nombre: 'anticipar',
    proposito: 'que la persona se prepare ante lo que tendería a ocurrir',
    familia: 'anticipar',
    pasos: [
      { stepId: 'p1', operacion: 'proyectar', porque: 'extender la comprensión al futuro', dependeDe: [], usaProductoDe: null, objetivoElementoId: null, horizonte: '12 meses', obligatorio: false },
      { stepId: 'e1', operacion: 'esclarecer', porque: 'esclarecer un elemento del estado en paralelo', dependeDe: [], usaProductoDe: null, objetivoElementoId: null, horizonte: null, obligatorio: false },
    ],
    condicionesEntrada: [],
    condicionesAbstencion: [],
    contrato: { entrega: 'proyecciones y esclarecimientos', limite: 'no son hechos futuros' },
    componeCapacidades: [],
    vigencia,
    atribucion: attr,
  };
}
