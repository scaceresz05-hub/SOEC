import { ActorId, type Attribution, OrganizationId, type RequestContext } from '@soec/contracts';
import { FixedClock, InMemoryEventStore } from '@soec/event-store';
import { MedService, MdmService } from '@soec/models';
import { EceBuildService, EceQueryService } from '@soec/ece';
import { MecanismoDeterministico } from '../src/app/mechanisms/deterministic';
import { MecanismoSimuladoIA } from '../src/app/mechanisms/simulated';
import { OperacionesService, OperacionesQueryService } from '../src/app/operations-service';

export const attr: Attribution = {
  source: 'fixture-sintetico',
  purpose: 'prueba F1-OI-01',
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
export const ambitoMed = { proposito: 'p-med', representa: 'r', excluye: 'MDM', supuestos: [] };
export const ambitoMdm = { proposito: 'p-mdm', representa: 'r', excluye: 'MED', supuestos: [] };
export const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

export interface Entorno {
  store: InMemoryEventStore;
  clock: FixedClock;
  med: MedService;
  mdm: MdmService;
  eceBuild: EceBuildService;
  eceQuery: EceQueryService;
  op: OperacionesService;
  opQuery: OperacionesQueryService;
}

export function montar(): Entorno {
  const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
  const store = new InMemoryEventStore(clock);
  const med = new MedService(store);
  const mdm = new MdmService(store);
  const eceQuery = new EceQueryService(store, med, mdm);
  return {
    store,
    clock,
    med,
    mdm,
    eceBuild: new EceBuildService(store, med, mdm),
    eceQuery,
    op: new OperacionesService(store, eceQuery, [new MecanismoDeterministico(), new MecanismoSimuladoIA()]),
    opQuery: new OperacionesQueryService(store),
  };
}

export async function sembrar(e: Entorno, ctx = ctxFor('orgA')): Promise<RequestContext> {
  await e.med.crear(ctx, { instanceId: 'm1', ambito: ambitoMed, vigencia, ...cmdBase });
  await e.mdm.crear(ctx, { instanceId: 'w1', ambito: ambitoMdm, vigencia, ...cmdBase });
  return ctx;
}

/** MED con una afirmación de estado configurable (para producir el elemento derivado deseado). */
export async function afirmacionMed(
  e: Entorno,
  ctx: RequestContext,
  cfg: { id: string; sostiene?: boolean; debilita?: boolean; respaldada?: boolean },
): Promise<void> {
  await e.med.emitirAfirmacion(ctx, { instanceId: 'm1', afirmacionId: cfg.id, enunciado: `enunciado ${cfg.id}`, dimension: 'hace', incertidumbre: 'media', ...cmdBase });
  if (cfg.sostiene) await e.med.incorporarEvidencia(ctx, { instanceId: 'm1', evidenciaId: `${cfg.id}-si`, afirmacionId: cfg.id, relacion: 'sostiene', procedencia: 'A', contenido: 'c', ...cmdBase });
  if (cfg.debilita) await e.med.incorporarEvidencia(ctx, { instanceId: 'm1', evidenciaId: `${cfg.id}-no`, afirmacionId: cfg.id, relacion: 'debilita', procedencia: 'B', contenido: 'c', ...cmdBase });
  if (cfg.respaldada) await e.med.revisarAfirmacion(ctx, { instanceId: 'm1', afirmacionId: cfg.id, nuevoEstado: 'respaldada', motivo: 'ok', ...cmdBase });
}

export async function construirEce(e: Entorno, ctx: RequestContext, eceId = 'ece1'): Promise<void> {
  await e.eceBuild.construir(ctx, { eceId, medInstanceId: 'm1', mdmInstanceId: 'w1', ...cmdBase });
}

export async function registrarBrecha(e: Entorno, ctx: RequestContext, eceId = 'ece1', id = 'brecha1'): Promise<void> {
  await e.eceBuild.registrarElemento(ctx, {
    eceId,
    tipo: 'brecha',
    id,
    referencias: [
      { modelo: 'MED', instanceId: 'm1', elementoId: 'a1', elementoTipo: 'afirmacion' },
      { modelo: 'MDM', instanceId: 'w1', elementoId: 'b1', elementoTipo: 'afirmacion' },
    ],
    procedencia: 'distancia empresa↔mundo',
    alcance: 'capacidad vs demanda',
    incertidumbre: 'media',
    ...cmdBase,
  });
}

export function sol(operacion: 'esclarecer' | 'detectar' | 'proyectar' | 'orientar', extra: Record<string, unknown> = {}) {
  return { operacion, eceId: 'ece1', proposito: `probar ${operacion}`, ...cmdBase, ...extra };
}
