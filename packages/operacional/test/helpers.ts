import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import type { AccionPropuesta, ContenidoPolitica } from '../src';
import { OperationalService, PolicyService, AdaptadorSimulado } from '../src';

export const attr: Attribution = {
  source: 'directiva-operativa',
  purpose: 'ejecutar marketing autorizado por política',
  assumptions: ['fixture sintético; efectos simulados; ningún efecto real'],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};
export const now = '2026-03-01T00:00:00.000Z';

export function ctxFor(org: string, permissions: string[] = ['events:append', 'events:read']): RequestContext {
  const organizationId = OrganizationId(org);
  return { organizationId, actor: ActorId('soec'), scope: { organizationId, permissions }, correlationId: `corr-${org}` };
}

export const politicaBase: ContenidoPolitica = {
  empresa: 'Pyme de servicios (demo)',
  objetivo: 'aumentar el alcance orgánico',
  canalesAutorizados: ['blog', 'instagram'],
  presupuestoTotal: 1000,
  presupuestoDiario: 200,
  productosRestringidos: [],
  afirmacionesProhibidas: ['garantizado', 'cura'],
  accionesProhibidas: ['enviar_masivo'],
  accionesRequierenAprobacion: ['modificar_landing'],
  nivelAutonomia: 3,
  riesgoPorAccion: { publicar_organico: 'bajo', enviar_campania: 'medio', afirmacion_medica: 'alto' },
};

export const accionOk: AccionPropuesta = {
  tipo: 'publicar_organico',
  canal: 'blog',
  contenido: 'Nuevo artículo sobre mantención preventiva',
  costo: 0,
  productoIntelectualRef: 'ce-comprender-estado-1',
};

export function montar(store: EventStore = new InMemoryEventStore()) {
  return {
    store,
    policies: new PolicyService(store),
    op: new OperationalService(store, [new AdaptadorSimulado()]),
  };
}

export async function politicaVigente(m: ReturnType<typeof montar>, ctx: RequestContext, policyId = 'pol-1', contenido = politicaBase) {
  const r = await m.policies.registrarVersion(ctx, policyId, contenido, attr, now);
  await m.policies.publicar(ctx, policyId, r.version, attr, now);
  return policyId;
}
