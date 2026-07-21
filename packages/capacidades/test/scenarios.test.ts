import { describe, expect, it } from 'vitest';
import type { RequestContext } from '@soec/contracts';
import { CicloDetectadoError } from '../src/domain/errors';
import type { DefinicionInput } from '../src/app/registry';
import {
  attr,
  cmdBase,
  ctxFor,
  defDetectarOrientar,
  defEsclarecerSimple,
  eceConContradiccion,
  montar,
} from './helpers';

const vigencia = { desde: '2026-01-01T00:00:00.000Z', hasta: null };
async function preparar(e: ReturnType<typeof montar>, ctx: RequestContext, capId: string, def: DefinicionInput, version = 1) {
  const r = await e.registry.registrarVersion(ctx, capId, def);
  await e.registry.publicar(ctx, capId, r.version);
  return version;
}
const base = (extra: object) => ({ capabilityId: '', eceId: 'ece1', ...cmdBase, ...extra });

const defContradiccionOrientar: DefinicionInput = {
  nombre: 'contradiccion-y-orientacion',
  proposito: 'que la persona juzgue una contradicción abierta',
  familia: 'orientar-una-decision',
  pasos: [
    { stepId: 'e1', operacion: 'esclarecer', porque: 'esclarecer la contradicción', dependeDe: [], usaProductoDe: null, objetivoElementoId: null, horizonte: null, obligatorio: false },
    { stepId: 'o1', operacion: 'orientar', porque: 'orientar conservando la contradicción', dependeDe: ['e1'], usaProductoDe: 'e1', objetivoElementoId: null, horizonte: null, obligatorio: true },
  ],
  condicionesEntrada: [],
  condicionesAbstencion: [],
  contrato: { entrega: 'esclarecimiento + consideraciones', limite: 'no decide cuál lado prevalece' },
  componeCapacidades: [],
  vigencia,
  atribucion: attr,
};

describe('Escenarios sintéticos de capacidades (§23)', () => {
  it('A — Capacidad simple: producto atribuible, no vinculante y comprensible', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap', defEsclarecerSimple());
    const r = await e.orchestrator.ejecutar(ctx, 'x1', base({ capabilityId: 'cap', objetivos: { e1: 'der:contradiccion:MED:m1:a1' } }));
    expect(r.producto.bindingDecision).toBe(false);
    expect(r.producto.atribucion.source).toBe('fixture-sintetico');
    expect(r.producto.operacionesEjecutadas).toHaveLength(1);
  });

  it('B — Composición secuencial sin convertir detección en decisión', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap', defDetectarOrientar());
    const r = await e.orchestrator.ejecutar(ctx, 'x1', base({ capabilityId: 'cap' }));
    expect(r.producto.operacionesEjecutadas.map((p) => p.operacion)).toEqual(['detectar', 'orientar']);
    expect(r.producto.bindingDecision).toBe(false);
  });

  it('D — Abstención intermedia: paso obligatorio abstiene → la capacidad se abstiene', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap', defEsclarecerSimple());
    // Sin objetivos: esclarecer se abstiene (alcance insuficiente); el paso es obligatorio.
    const r = await e.orchestrator.ejecutar(ctx, 'x1', base({ capabilityId: 'cap' }));
    expect(r.producto.abstenido).toBe(true);
    expect(r.producto.pasoAfectado).toBe('e1');
    expect(r.producto.causaAbstencion).toContain('abstenida');
  });

  it('E — Contradicción abierta: se conserva y se remite al juicio humano', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap', defContradiccionOrientar);
    const r = await e.orchestrator.ejecutar(ctx, 'x1', base({ capabilityId: 'cap', objetivos: { e1: 'der:contradiccion:MED:m1:a1' } }));
    expect(r.producto.contradiccionesAbiertas.length).toBeGreaterThan(0);
    expect(r.producto.cuestionesJuicioHumano.join(' ')).toMatch(/persona/);
  });

  it('F — Versionado: v1 y v2 producen ejecuciones diferenciadas; la antigua no se recalcula', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap', defEsclarecerSimple()); // v1
    const v1 = await e.orchestrator.ejecutar(ctx, 'x1', base({ capabilityId: 'cap', objetivos: { e1: 'der:contradiccion:MED:m1:a1' } }));
    await preparar(e, ctx, 'cap', defDetectarOrientar()); // v2 (vigente)
    const v2 = await e.orchestrator.ejecutar(ctx, 'x2', base({ capabilityId: 'cap' }));
    expect(v1.producto.version).toBe(1);
    expect(v2.producto.version).toBe(2);
    // La ejecución antigua permanece consultable e intacta.
    const x1 = await e.capQuery.producto(ctx, 'x1');
    expect(x1?.version).toBe(1);
    expect(x1?.operacionesEjecutadas.map((p) => p.operacion)).toEqual(['esclarecer']);
  });

  it('G — Idempotencia: misma solicitud con misma clave no duplica', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap', defDetectarOrientar());
    const r1 = await e.orchestrator.ejecutar(ctx, 'x1', base({ capabilityId: 'cap', idempotencyKey: 'k1' }));
    const r2 = await e.orchestrator.ejecutar(ctx, 'x1', base({ capabilityId: 'cap', idempotencyKey: 'k1' }));
    expect(r2.state.version).toBe(r1.state.version);
    expect(r2.producto).toEqual(r1.producto);
  });

  it('H — No efecto: la ejecución no modifica MED, MDM ni ECE', async () => {
    const e = montar();
    const ctx = await eceConContradiccion(e);
    await preparar(e, ctx, 'cap', defDetectarOrientar());
    const v = {
      med: (await e.med.estadoActual(ctx, 'm1')).version,
      mdm: (await e.mdm.estadoActual(ctx, 'w1')).version,
      ece: (await e.eceQuery.estadoActual(ctx, 'ece1')).version,
    };
    await e.orchestrator.ejecutar(ctx, 'x1', base({ capabilityId: 'cap' }));
    expect((await e.med.estadoActual(ctx, 'm1')).version).toBe(v.med);
    expect((await e.mdm.estadoActual(ctx, 'w1')).version).toBe(v.mdm);
    expect((await e.eceQuery.estadoActual(ctx, 'ece1')).version).toBe(v.ece);
  });

  it('I — Rechazo de ciclo: una definición que se compone de sí misma es rechazada', async () => {
    const e = montar();
    const def = { ...defEsclarecerSimple(), componeCapacidades: ['capX'] };
    await expect(e.registry.registrarVersion(ctxFor('orgA'), 'capX', def)).rejects.toBeInstanceOf(CicloDetectadoError);
  });
});
