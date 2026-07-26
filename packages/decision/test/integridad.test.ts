/**
 * Integridad criptográfica del snapshot congelado: la huella recomputada detecta
 * cualquier alteración de la unidad (comprensión + resultado + candidato + rubro).
 */
import { describe, it, expect } from 'vitest';
import { verificarIntegridadSnapshot } from '../src/index';
import { attr, ctxFor, montar, now, propuestaReal } from './helpers';

describe('@soec/decision · integridad del snapshot', () => {
  it('un registro no alterado verifica su huella', async () => {
    const { svc } = montar();
    const { snapshot, candidato } = propuestaReal();
    const st = await svc.registrar(
      ctxFor('orgA'),
      'marketing',
      {
        decisionId: 'd1',
        resultado: 'ACEPTADO',
        candidatoElegido: candidato,
        propuesta: snapshot,
        justificacion: { texto: 'x', categoria: 'NEGOCIO' },
      },
      attr,
      now,
    );
    expect(verificarIntegridadSnapshot(st.decisiones[0]!)).toBe(true);
  });

  it('detecta una alteración del snapshot (huella no coincide)', async () => {
    const { svc } = montar();
    const { snapshot, candidato } = propuestaReal();
    const st = await svc.registrar(
      ctxFor('orgA'),
      'marketing',
      {
        decisionId: 'd1',
        resultado: 'ACEPTADO',
        candidatoElegido: candidato,
        propuesta: snapshot,
        justificacion: { texto: 'x', categoria: 'NEGOCIO' },
      },
      attr,
      now,
    );
    const alterado = {
      ...st.decisiones[0]!,
      propuesta: { ...snapshot, rubroId: 'rubro-suplantado' },
    };
    expect(verificarIntegridadSnapshot(alterado)).toBe(false);
  });
});
