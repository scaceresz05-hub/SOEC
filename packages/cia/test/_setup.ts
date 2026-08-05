/**
 * @soec/cia · tests · SETUP compartido (no contiene tests). Monta los servicios del CIA sobre un
 * `InMemoryEventStore`, en modo SIMULADO. Sin red, sin proveedores reales.
 */
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  AutorizacionesService, KillSwitchService, PlanificadorService, LecturaIntegracionesService, CatalogoService, PresupuestoService,
} from '../src/index';

export { InMemoryEventStore, AutorizacionesService, KillSwitchService, PlanificadorService, LecturaIntegracionesService, CatalogoService, PresupuestoService };

export const attr: Attribution = { source: 'cia', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
export const O = '2026-08-04T00:00:00.000Z';
export const HUMANO = 'humano-1';

export function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}

export interface Montaje {
  readonly store: InMemoryEventStore;
  readonly autorizaciones: AutorizacionesService;
  readonly kill: KillSwitchService;
  readonly presupuesto: PresupuestoService;
  readonly planificador: PlanificadorService;
  readonly lectura: LecturaIntegracionesService;
  readonly catalogo: CatalogoService;
}

export function montar(store: InMemoryEventStore = new InMemoryEventStore()): Montaje {
  const autorizaciones = new AutorizacionesService(store);
  const kill = new KillSwitchService(store);
  const presupuesto = new PresupuestoService(store, autorizaciones);
  const planificador = new PlanificadorService(store, autorizaciones, kill, undefined, presupuesto);
  const lectura = new LecturaIntegracionesService(autorizaciones, planificador);
  const catalogo = new CatalogoService();
  return { store, autorizaciones, kill, presupuesto, planificador, lectura, catalogo };
}
