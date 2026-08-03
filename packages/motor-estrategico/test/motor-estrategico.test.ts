/**
 * @soec/motor-estrategico · servicio + agregado · tests adversariales.
 *
 * Cubre las dimensiones de autoauditoría del Bloque Maestro M5: event-sourcing, replay, SSOT, evidencia,
 * consultas, multi-tenant, concurrencia, contratos y explicabilidad end-to-end. Busca romper el
 * aislamiento entre organizaciones, la integridad de los enlaces y la derivación (no almacenamiento)
 * del veredicto.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, ConcurrencyError, OrganizationId, type Attribution, type RecordedEvent, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import {
  EVENTOS_AFIRMACION,
  MotorEstrategicoService,
  type EntradaEvidencia,
  type LecturaConocimiento,
  afirmacionStreamId,
  aplicarAfirmacion,
  estadoInicialAfirmacion,
  reconstruirAfirmacion,
} from '../src/index';

const attr: Attribution = {
  source: 'motor-estrategico-test',
  purpose: 'test',
  assumptions: ['test'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};
const O = '2026-08-03T00:00:00.000Z';
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `t-${org}` };
}
const svc = () => new MotorEstrategicoService(new InMemoryEventStore());
const evd = (id: string, sentido: 'A_FAVOR' | 'EN_CONTRA', pertinente = true): EntradaEvidencia => ({
  evidenciaId: id,
  enunciado: `evidencia ${id}`,
  origen: 'DATO_IMPORTADO',
  sentido,
  pertinente,
});

describe('motor-estratégico · escritura + evaluación derivada', () => {
  it('registra una afirmación, acumula evidencia y DERIVA el veredicto (no lo almacena)', async () => {
    const store = new InMemoryEventStore();
    const s = new MotorEstrategicoService(store);
    const c = ctx();
    await s.registrar(c, 'icp-1', 'ICP', 'el cliente ideal son pymes de servicios', attr, O);
    await s.agregarEvidencia(c, 'icp-1', evd('ev1', 'A_FAVOR'), attr, O);
    const r = await s.evaluar(c, 'icp-1');
    expect(r.afirmacion.clase).toBe('ICP');
    expect(r.afirmacion.evidencias).toHaveLength(1);
    expect(r.evaluacion.estado).toBe('VERDADERO'); // derivado, no persistido
    // El stream NO contiene ningún evento de veredicto: solo conocimiento (enunciado + evidencia).
    const eventos = await store.readStream(c, afirmacionStreamId('org-a', 'icp-1'));
    expect(eventos.length).toBeGreaterThan(0);
    expect(eventos.every((e) => !e.type.includes('veredicto') && !e.type.includes('estado'))).toBe(true);
  });

  it('afirmación inexistente ⇒ evaluar lanza; sin evidencia ⇒ NO_EVALUABLE', async () => {
    const s = svc();
    const c = ctx();
    await expect(s.evaluar(c, 'noexiste')).rejects.toThrow();
    await s.registrar(c, 'obj-1', 'OBJETIVO', 'crecer 20% en 6 meses', attr, O);
    const r = await s.evaluar(c, 'obj-1');
    expect(r.evaluacion.estado).toBe('NO_EVALUABLE');
  });

  it('evidencia idempotente por id: reingresar el mismo id no duplica', async () => {
    const s = svc();
    const c = ctx();
    await s.registrar(c, 'a', 'MERCADO', 'mercado en expansión', attr, O);
    await s.agregarEvidencia(c, 'a', evd('x', 'A_FAVOR'), attr, O);
    await s.agregarEvidencia(c, 'a', evd('x', 'EN_CONTRA'), attr, O); // mismo id ⇒ ignorado
    const st = await s.cargar(c, 'a');
    expect(st.evidencias).toHaveLength(1);
    expect(st.evidencias[0]!.sentido).toBe('A_FAVOR');
  });

  it('retirar ⇒ la afirmación deja de computar evidencia ⇒ NO_EVALUABLE, conservando historia', async () => {
    const s = svc();
    const c = ctx();
    await s.registrar(c, 'e', 'ESTRATEGIA', 'liderar en precio', attr, O);
    await s.agregarEvidencia(c, 'e', evd('ev', 'A_FAVOR'), attr, O);
    expect((await s.evaluar(c, 'e')).evaluacion.estado).toBe('VERDADERO');
    await s.retirar(c, 'e', 'estrategia descartada por la dirección', attr, O);
    const r = await s.evaluar(c, 'e');
    expect(r.afirmacion.retirada).toBe(true);
    expect(r.afirmacion.evidencias).toHaveLength(1); // historia conservada
    expect(r.evaluacion.estado).toBe('NO_EVALUABLE');
    // Explicación HONESTA: declara el retiro, no finge ausencia de evidencia.
    expect(r.evaluacion.explicacion.porQue).toContain('retirada');
    expect(r.evaluacion.explicacion.queImpediriaConcluir.join(' ')).toContain('retirada');
  });
});

describe('motor-estratégico · enlaces (relaciones tipadas, nunca al vacío ni cross-tenant)', () => {
  it('enlaza BUYER_PERSONA → ICP (varias por ICP); exige que el destino exista', async () => {
    const s = svc();
    const c = ctx();
    await s.registrar(c, 'icp', 'ICP', 'pymes de servicios', attr, O);
    await s.registrar(c, 'bp1', 'BUYER_PERSONA', 'gerente comercial', attr, O);
    await s.registrar(c, 'bp2', 'BUYER_PERSONA', 'dueño-fundador', attr, O);
    await s.enlazar(c, 'bp1', 'PERTENECE_A', 'icp', attr, O);
    await s.enlazar(c, 'bp2', 'PERTENECE_A', 'icp', attr, O);
    expect((await s.cargar(c, 'bp1')).enlaces).toEqual([{ tipo: 'PERTENECE_A', hacia: 'icp', nota: null }]);
    expect((await s.cargar(c, 'bp2')).enlaces[0]!.hacia).toBe('icp');
  });

  it('enlazar hacia un destino inexistente ⇒ error (nunca se enlaza al vacío)', async () => {
    const s = svc();
    const c = ctx();
    await s.registrar(c, 'bp', 'BUYER_PERSONA', 'x', attr, O);
    await expect(s.enlazar(c, 'bp', 'PERTENECE_A', 'icp-fantasma', attr, O)).rejects.toThrow();
  });

  it('no se permite auto-enlace; enlace idempotente por (tipo, destino)', async () => {
    const s = svc();
    const c = ctx();
    await s.registrar(c, 'k', 'KPI', 'CAC', attr, O);
    await s.registrar(c, 'o', 'OBJETIVO', 'bajar CAC', attr, O);
    await expect(s.enlazar(c, 'k', 'MIDE', 'k', attr, O)).rejects.toThrow();
    await s.enlazar(c, 'k', 'MIDE', 'o', attr, O);
    await s.enlazar(c, 'k', 'MIDE', 'o', attr, O); // idempotente
    expect((await s.cargar(c, 'k')).enlaces).toHaveLength(1);
  });
});

describe('motor-estratégico · multi-tenant (aislamiento total)', () => {
  it('lo registrado en org-a no es visible ni enlazable desde org-b', async () => {
    const store = new InMemoryEventStore();
    const s = new MotorEstrategicoService(store);
    await s.registrar(ctx('org-a'), 'x', 'EMPRESA', 'empresa A', attr, O);
    // org-b: no existe
    expect((await s.cargar(ctx('org-b'), 'x')).existe).toBe(false);
    expect(await s.listar(ctx('org-b'))).toEqual([]);
    // org-b no puede enlazar hacia una afirmación de org-a (no existe en SU tenant)
    await s.registrar(ctx('org-b'), 'y', 'EMPRESA', 'empresa B', attr, O);
    await expect(s.enlazar(ctx('org-b'), 'y', 'SUSTENTA', 'x', attr, O)).rejects.toThrow();
  });
});

describe('motor-estratégico · consultas (índice por clase)', () => {
  it('lista el conocimiento y filtra por clase', async () => {
    const s = svc();
    const c = ctx();
    await s.registrar(c, 'icp', 'ICP', 'pymes', attr, O);
    await s.registrar(c, 'comp', 'COMPETENCIA', 'competidor X', attr, O);
    await s.registrar(c, 'mkt', 'MERCADO', 'mercado Y', attr, O);
    expect((await s.listar(c)).length).toBe(3);
    const soloIcp = await s.listar(c, 'ICP');
    expect(soloIcp.map((e) => e.afirmacionId)).toEqual(['icp']);
  });
});

describe('motor-estratégico · replay determinista y concurrencia optimista', () => {
  it('reconstruir el mismo stream dos veces da estados idénticos', async () => {
    const store = new InMemoryEventStore();
    const s = new MotorEstrategicoService(store);
    const c = ctx();
    await s.registrar(c, 'a', 'PLAN', 'plan 2026', attr, O);
    await s.agregarEvidencia(c, 'a', evd('e1', 'A_FAVOR'), attr, O);
    await s.agregarEvidencia(c, 'a', evd('e2', 'EN_CONTRA'), attr, O);
    const eventos = await store.readStream(c, afirmacionStreamId('org-a', 'a'));
    const s1 = reconstruirAfirmacion('org-a', 'a', eventos);
    const s2 = reconstruirAfirmacion('org-a', 'a', eventos);
    expect(s1).toEqual(s2);
    expect(s1.evidencias).toHaveLength(2);
  });

  it('dos escrituras concurrentes sobre el mismo agregado ⇒ una gana, la otra ConcurrencyError', async () => {
    const s = svc();
    const c = ctx();
    await s.registrar(c, 'a', 'OBJETIVO', 'meta', attr, O);
    const resultados = await Promise.allSettled([
      s.agregarEvidencia(c, 'a', evd('c1', 'A_FAVOR'), attr, O),
      s.agregarEvidencia(c, 'a', evd('c2', 'A_FAVOR'), attr, O),
    ]);
    const rechazos = resultados.filter((r) => r.status === 'rejected');
    expect(rechazos).toHaveLength(1);
    expect((rechazos[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError);
  });
});

describe('motor-estratégico · agregado puro (reducer)', () => {
  it('re-registro idempotente: no sobrescribe la clase/enunciado originales', () => {
    const base = estadoInicialAfirmacion('org-a', 'a');
    const rec = (type: string, payload: unknown, seq: number): RecordedEvent => ({
      eventId: `ev-${seq}`, streamId: afirmacionStreamId('org-a', 'a'), sequence: seq, organizationId: OrganizationId('org-a'), actor: ActorId('d'),
      type, payload, attribution: attr, occurredAt: O, recordedAt: O, correlationId: 't', causationId: null, idempotencyKey: null,
    });
    const s1 = aplicarAfirmacion(base, rec(EVENTOS_AFIRMACION.registrada, { clase: 'ICP', enunciado: 'original' }, 1));
    const s2 = aplicarAfirmacion(s1, rec(EVENTOS_AFIRMACION.registrada, { clase: 'EMPRESA', enunciado: 'intruso' }, 2));
    expect(s2.clase).toBe('ICP');
    expect(s2.enunciado).toBe('original');
    expect(s2.version).toBe(2); // la versión avanza aunque el evento sea idempotente
  });

  it('un evento desconocido no rompe el replay (solo avanza la versión)', () => {
    const base = estadoInicialAfirmacion('org-a', 'a');
    const rec: RecordedEvent = {
      eventId: 'ev-x', streamId: afirmacionStreamId('org-a', 'a'), sequence: 1, organizationId: OrganizationId('org-a'), actor: ActorId('d'),
      type: 'estrategico.evento_de_version_futura', payload: {}, attribution: attr, occurredAt: O, recordedAt: O, correlationId: 't', causationId: null, idempotencyKey: null,
    };
    const st = aplicarAfirmacion(base, rec);
    expect(st.existe).toBe(false);
    expect(st.version).toBe(1);
  });
});

describe('motor-estratégico · contrato de lectura (M6–M9 consumen sin mutar)', () => {
  it('el servicio satisface LecturaConocimiento y expone solo lectura/evaluación/consulta', async () => {
    const s = svc();
    const c = ctx();
    await s.registrar(c, 'a', 'EMPRESA', 'empresa', attr, O);
    await s.agregarEvidencia(c, 'a', evd('e', 'A_FAVOR'), attr, O);
    const lectura: LecturaConocimiento = s; // asignable ⇒ el puerto de lectura no incluye escritura
    const r = await lectura.evaluar(c, 'a');
    expect(r.evaluacion.estado).toBe('VERDADERO');
    expect((await lectura.listar(c)).length).toBe(1);
    expect((await lectura.cargar(c, 'a')).existe).toBe(true);
  });
});
