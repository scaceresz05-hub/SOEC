/**
 * @soec/motor-creativo · tests · VALIDACIÓN AUTORITATIVA (gate epistémico). Intenta romper: contenido
 * inválido que avanza, afirmaciones con evidencia retirada, respaldo no VERDADERO, y falsos positivos/
 * negativos del validador. Composición real: validador A-3 (texto) + resolución contra M5.
 */
import { describe, expect, it } from 'vitest';
import { ActorId, OrganizationId, type Attribution, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { MotorEstrategicoService } from '@soec/motor-estrategico';
import type { EntradaValidacionContenido, VeredictoContenido } from '@soec/estrategia-creativa';
import {
  MotorCreativoService,
  combinarVeredicto,
  requiereRespaldo,
  validarMensaje,
  type RespaldoAfirmacion,
} from '../src/index';

const attr: Attribution = { source: 'm6-test', purpose: 'test', assumptions: ['t'], claimType: 'observational', regime: 'empirical', uncertainty: 'media' };
const O = '2026-08-03T00:00:00.000Z';
function ctx(org = 'org-a'): RequestContext {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('director'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 't' };
}
const textoOK: VeredictoContenido = { resultado: 'VALIDO', razones: [], categorias: [], afirmacionesDetectadas: [], afirmacionesNoRespaldadas: [], restriccionesVioladas: [], evidenciaFaltante: [] };
const resp = (over: Partial<RespaldoAfirmacion>): RespaldoAfirmacion => ({ mensajeId: 'm1', afirmacionId: 'a1', existe: true, retirada: false, estado: 'VERDADERO', ...over });

describe('combinarVeredicto (puro)', () => {
  it('autoriza solo si el texto pasa A-3 y todos los respaldos son VERDADERO/existen/no-retirados', () => {
    expect(combinarVeredicto(textoOK, [resp({})]).autoriza).toBe(true);
  });
  it('texto inválido bloquea aunque el respaldo sea VERDADERO', () => {
    const malo: VeredictoContenido = { ...textoOK, resultado: 'INVALIDO', razones: ['x'] };
    expect(combinarVeredicto(malo, [resp({})]).autoriza).toBe(false);
  });
  it('respaldo retirado ⇒ bloquea (RETIRADA)', () => {
    const v = combinarVeredicto(textoOK, [resp({ retirada: true })]);
    expect(v.autoriza).toBe(false);
    expect(v.respaldosInvalidos[0]!.motivo).toBe('RETIRADA');
  });
  it('respaldo NO VERDADERO (GRIS/NO_EVALUABLE/FALSO) ⇒ bloquea (NO_VERDADERA)', () => {
    for (const estado of ['GRIS', 'NO_EVALUABLE', 'FALSO'] as const) {
      const v = combinarVeredicto(textoOK, [resp({ estado })]);
      expect(v.autoriza).toBe(false);
      expect(v.respaldosInvalidos[0]!.motivo).toBe('NO_VERDADERA');
    }
  });
  it('respaldo inexistente ⇒ bloquea (INEXISTENTE)', () => {
    const v = combinarVeredicto(textoOK, [resp({ existe: false, estado: 'NO_EVALUABLE' })]);
    expect(v.respaldosInvalidos[0]!.motivo).toBe('INEXISTENTE');
  });
});

describe('validarMensaje (estructural)', () => {
  it('un mensaje que afirma un hecho (PROBLEMA/BENEFICIO/…) exige respaldo; CTA/EDUCATIVO no', () => {
    expect(requiereRespaldo('BENEFICIO')).toBe(true);
    expect(requiereRespaldo('CTA')).toBe(false);
    expect(validarMensaje({ mensajeId: 'm', tipo: 'BENEFICIO', texto: 'ahorra tiempo', afirmacionRespaldoId: null, evidenciaRef: null, audienciaId: null, condicionesNoUso: [] }).ok).toBe(false);
    expect(validarMensaje({ mensajeId: 'm', tipo: 'CTA', texto: 'escríbenos', afirmacionRespaldoId: null, evidenciaRef: null, audienciaId: null, condicionesNoUso: [] }).ok).toBe(true);
  });
});

describe('validarContenido (integración M5→M6)', () => {
  function montar() {
    const store = new InMemoryEventStore();
    const m5 = new MotorEstrategicoService(store);
    return { m5, m6: new MotorCreativoService(store, m5) };
  }
  const entrada = (cuerpo: string): EntradaValidacionContenido => ({ cuerpo, afirmacionesPermitidas: [], restricciones: [], pruebaSocialPermitida: false });

  it('autoriza con texto limpio y respaldo VERDADERO en M5', async () => {
    const { m5, m6 } = montar();
    const c = ctx();
    await m5.registrar(c, 'benef', 'PROPUESTA_VALOR', 'ahorra tiempo', attr, O);
    await m5.agregarEvidencia(c, 'benef', { evidenciaId: 'e', enunciado: 'medido', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
    const v = await m6.validarContenido(c, entrada('Ayudamos a las pymes a ordenar su operación.'), [{ mensajeId: 'm1', afirmacionRespaldoId: 'benef' }]);
    expect(v.autoriza).toBe(true);
  });

  it('bloquea si la afirmación de respaldo fue RETIRADA en M5 (evidencia retirada)', async () => {
    const { m5, m6 } = montar();
    const c = ctx();
    await m5.registrar(c, 'benef', 'PROPUESTA_VALOR', 'ahorra tiempo', attr, O);
    await m5.agregarEvidencia(c, 'benef', { evidenciaId: 'e', enunciado: 'medido', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
    await m5.retirar(c, 'benef', 'dato caducado', attr, O);
    const v = await m6.validarContenido(c, entrada('Ayudamos a las pymes a ordenar su operación.'), [{ mensajeId: 'm1', afirmacionRespaldoId: 'benef' }]);
    expect(v.autoriza).toBe(false);
    expect(v.respaldosInvalidos[0]!.motivo).toBe('RETIRADA');
  });

  it('bloquea texto con afirmación de riesgo no respaldada aunque el respaldo epistémico exista', async () => {
    const { m5, m6 } = montar();
    const c = ctx();
    await m5.registrar(c, 'benef', 'PROPUESTA_VALOR', 'ahorra tiempo', attr, O);
    await m5.agregarEvidencia(c, 'benef', { evidenciaId: 'e', enunciado: 'medido', origen: 'DATO_IMPORTADO', sentido: 'A_FAVOR', pertinente: true }, attr, O);
    const v = await m6.validarContenido(c, entrada('El mejor software con 50% de descuento garantizado.'), [{ mensajeId: 'm1', afirmacionRespaldoId: 'benef' }]);
    expect(v.autoriza).toBe(false);
    expect(v.veredictoTextual.resultado).toBe('INVALIDO');
  });

  it('bloquea si el respaldo declarado no es evaluable en M5 (NO_EVALUABLE)', async () => {
    const { m5, m6 } = montar();
    const c = ctx();
    await m5.registrar(c, 'flojo', 'PROPUESTA_VALOR', 'sin evidencia', attr, O); // NO_EVALUABLE
    const v = await m6.validarContenido(c, entrada('Ayudamos a las pymes a ordenar su operación.'), [{ mensajeId: 'm1', afirmacionRespaldoId: 'flojo' }]);
    expect(v.autoriza).toBe(false);
    expect(v.respaldosInvalidos[0]!.motivo).toBe('NO_VERDADERA');
  });
});
