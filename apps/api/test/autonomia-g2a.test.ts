/**
 * G2-A — cadena WRITE GOBERNADA en DRY-RUN. Todos los gates adversariales. AUTONOMOUS_REAL=false ⇒ 0 mutate real.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '@soec/event-store';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { AutonomiaService } from '@soec/autonomia';
import { KillSwitchService } from '@soec/cia';
import { G2AService } from '../src/autonomia-ads/g2a-service';
// La organización ya no es una constante del servicio: es la identidad canónica registrada.
import { ORG_SMILEFLOW as ORG_REAL } from '../src/plataforma';
import { IntencionService, intencionId, type IntencionDeCambio } from '../src/autonomia-ads/intencion-cambio';
import { AprobacionService, AutoaprobacionProhibidaError } from '../src/autonomia-ads/aprobacion-service';
import { ExecutorGovernado } from '../src/autonomia-ads/executor-governado';
import { CONFINAMIENTO } from '../src/autonomia-ads/capacidad-negativa';

const AHORA = '2026-08-12T12:00:00.000Z';
const FUTURO = '2026-08-20T12:00:00.000Z';
const ATR: Attribution = { source: 't', purpose: 't', assumptions: [], claimType: 'observational', regime: 'empirical', uncertainty: 'baja' };
const CAMP = '24120966895';
function ctx(org = ORG_REAL): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('t'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'c' };
}
function intencionValida(over: Partial<IntencionDeCambio> = {}): IntencionDeCambio {
  const termino = over.entityRef ?? 'reparacion de autos';
  return {
    id: intencionId(ORG_REAL, CONFINAMIENTO.customerId, 'ADD_NEGATIVE_KEYWORD', termino),
    org: ORG_REAL, customerId: CONFINAMIENTO.customerId, campaignId: CAMP, lever: 'negativa_termino',
    entityRef: termino, actionType: 'ADD_NEGATIVE_KEYWORD', before: 'muestra el anuncio', after: 'excluida',
    reason: 'irrelevante', evidence: { resumen: '40 impresiones, 0 clics', muestra: 40, suficiente: true, sinConversionAtribuible: true, ventana: 'acumulado' },
    confidence: 'alta', risk: 'bajo', authorizationRef: null, createdAt: AHORA, status: 'PROPUESTA', ...over,
  };
}
/** Registra + aprueba (humano) una intención; devuelve su id. */
async function registrarYAprobar(store: InMemoryEventStore, over: Partial<IntencionDeCambio> = {}, actor = 'Dra. Ana'): Promise<string> {
  const g2a = new G2AService(store);
  const intencion = intencionValida(over);
  await g2a.registrarIntencion(ORG_REAL, intencion, AHORA);
  const aprob = await new AprobacionService(store).aprobar(ctx(), intencion.id, actor, AHORA, ATR, AHORA);
  await new IntencionService(store).aprobar(ctx(), intencion.id, aprob.authorizationRef!, ATR, AHORA);
  return intencion.id;
}

describe('G2-A — aprobación humana', () => {
  it('SOEC no puede aprobarse a sí mismo (ni actor vacío)', async () => {
    const store = new InMemoryEventStore();
    const g2a = new G2AService(store);
    await g2a.registrarIntencion(ORG_REAL, intencionValida(), AHORA);
    const id = intencionValida().id;
    const aprob = new AprobacionService(store);
    await expect(aprob.aprobar(ctx(), id, 'soec', AHORA, ATR, AHORA)).rejects.toBeInstanceOf(AutoaprobacionProhibidaError);
    await expect(aprob.aprobar(ctx(), id, '  ', AHORA, ATR, AHORA)).rejects.toBeInstanceOf(AutoaprobacionProhibidaError);
  });

  it('aprobación expirada se rechaza', async () => {
    const store = new InMemoryEventStore();
    const g2a = new G2AService(store);
    await g2a.registrarIntencion(ORG_REAL, intencionValida(), AHORA, 0); // expira ya
    const id = intencionValida().id;
    await expect(new AprobacionService(store).aprobar(ctx(), id, 'Dra. Ana', FUTURO, ATR, FUTURO)).rejects.toThrow(/expir/);
  });
});

describe('G2-A — Executor gobernado (DRY-RUN, AUTONOMOUS_REAL=false)', () => {
  it('camino feliz: aprobada + read-back OK ⇒ VERIFICADA, ejecutadoReal=false, sin poder ejecutar real', async () => {
    const store = new InMemoryEventStore();
    const id = await registrarYAprobar(store);
    const r = await new ExecutorGovernado(store).ejecutar(ORG_REAL, id, AHORA);
    expect(r.ejecutadoReal).toBe(false);
    expect(r.puedeEjecutarReal).toBe(false); // interruptor maestro cerrado
    expect(r.bloqueos).toContain('INTERRUPTOR_MAESTRO_REAL');
    expect(r.mutateDescrito?.operacion).toContain('negative keyword');
    expect(r.estadoFinalIntencion).toBe('VERIFICADA');
  });

  it('KILL SWITCH bloquea aunque esté aprobada (fail-closed)', async () => {
    const store = new InMemoryEventStore();
    const id = await registrarYAprobar(store);
    await new KillSwitchService(store).activar(ctx(), 'ORG', ATR, AHORA);
    const r = await new ExecutorGovernado(store).ejecutar(ORG_REAL, id, AHORA);
    expect(r.bloqueos).toContain('KILL_SWITCH');
    expect(r.mutateDescrito).toBeNull(); // ni siquiera se describe/ejecuta
  });

  it('PAUSA (modo seguro) bloquea aunque esté aprobada', async () => {
    const store = new InMemoryEventStore();
    const id = await registrarYAprobar(store);
    await new AutonomiaService(store).pausar(ctx(), 'test', ATR, AHORA);
    const r = await new ExecutorGovernado(store).ejecutar(ORG_REAL, id, AHORA);
    expect(r.bloqueos).toContain('MODO_SEGURO');
  });

  it('sin autorización humana ⇒ bloqueado', async () => {
    const store = new InMemoryEventStore();
    // registrar pero NO aprobar
    await new G2AService(store).registrarIntencion(ORG_REAL, intencionValida(), AHORA);
    const id = intencionValida().id;
    const r = await new ExecutorGovernado(store).ejecutar(ORG_REAL, id, AHORA);
    expect(r.bloqueos).toEqual(expect.arrayContaining(['AUTORIZACION_HUMANA']));
  });

  it('confianza baja / evidencia insuficiente ⇒ bloqueado (no ejecuta ni simula)', async () => {
    const store = new InMemoryEventStore();
    const id = await registrarYAprobar(store, { entityRef: 'termino x', confidence: 'media' });
    const r = await new ExecutorGovernado(store).ejecutar(ORG_REAL, id, AHORA);
    expect(r.bloqueos).toContain('EVIDENCIA_CONFIANZA');
    expect(r.mutateDescrito).toBeNull();
  });

  it('read-back MISMATCH ⇒ ROLLBACK simulado ⇒ REVERTIDA', async () => {
    const store = new InMemoryEventStore();
    const id = await registrarYAprobar(store);
    const r = await new ExecutorGovernado(store).ejecutar(ORG_REAL, id, AHORA, { readBackCoincide: false, rollbackExitoso: true });
    expect(r.rollback.requerido).toBe(true);
    expect(r.rollback.exitoso).toBe(true);
    expect(r.estadoFinalIntencion).toBe('REVERTIDA');
  });

  it('rollback FALLIDO ⇒ PAUSA activada + FALLIDA (fail-safe)', async () => {
    const store = new InMemoryEventStore();
    const id = await registrarYAprobar(store);
    const r = await new ExecutorGovernado(store).ejecutar(ORG_REAL, id, AHORA, { readBackCoincide: false, rollbackExitoso: false });
    expect(r.rollback.pausaActivada).toBe(true);
    expect(r.estadoFinalIntencion).toBe('FALLIDA');
    expect((await new AutonomiaService(store).cargar(ctx())).pausado).toBe(true);
  });
});

describe('G2-A — confinamiento de tenant + idempotencia + propuesta honesta', () => {
  it('rechaza intención de OTRO customerId/tenant', async () => {
    const store = new InMemoryEventStore();
    const g2a = new G2AService(store);
    await expect(g2a.registrarIntencion(ORG_REAL, intencionValida({ customerId: '9999999999' }), AHORA)).rejects.toThrow(/confinamiento/);
    await expect(g2a.registrarIntencion(ORG_REAL, intencionValida({ org: 'otro-tenant' }), AHORA)).rejects.toThrow(/confinamiento/);
  });

  it('intención duplicada es idempotente (no se duplica)', async () => {
    const store = new InMemoryEventStore();
    const g2a = new G2AService(store);
    await g2a.registrarIntencion(ORG_REAL, intencionValida(), AHORA);
    await g2a.registrarIntencion(ORG_REAL, intencionValida(), AHORA);
    expect(await new IntencionService(store).listarIds(ctx())).toHaveLength(1);
  });

  it('con evidencia insuficiente NO propone (veredicto OBSERVAR)', async () => {
    const store = new InMemoryEventStore();
    // sin observaciones de términos ⇒ planificador honesto ⇒ 0
    const r = await new G2AService(store).proponerDesdeReal(ORG_REAL, AHORA);
    expect(r.veredicto).toBe('OBSERVAR');
    expect(r.intencionesCreadas).toBe(0);
  });
});
