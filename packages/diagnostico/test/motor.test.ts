/**
 * Recorrido determinista del motor de Diagnóstico:
 * respuestas → evidencia de instancia → capacidad «Comprender el estado» →
 * comprensión evaluable → hechos + faltantes + contradicciones (con procedencia).
 */
import { describe, it, expect } from 'vitest';
import { nuevoMotor, respuestasEjemplo, OCCURRED } from './helpers';

async function correr() {
  const { motor, rubro } = nuevoMotor();
  const preguntas = rubro.preguntasDiagnosticas();
  const comp = await motor.comprender(respuestasEjemplo(preguntas), {
    diagnosticoId: 'dx-1',
    occurredAt: OCCURRED,
  });
  return { comp, preguntas };
}

describe('@soec/diagnostico · motor', () => {
  it('mismo diagnóstico → misma comprensión (determinista)', async () => {
    const a = await correr();
    const b = await correr();
    expect(b.comp).toEqual(a.comp);
  });

  it('respuestas incompletas → faltantes explícitos (sin conclusión negativa)', async () => {
    const { comp, preguntas } = await correr();
    const motivos = comp.faltantes.map((f) => f.motivo);
    // preguntas[3] respondida como ausente; el resto sin responder (incl. señalizadas).
    expect(comp.faltantes.length).toBeGreaterThanOrEqual(3);
    expect(motivos).toContain('RESPUESTA_AUSENTE');
    expect(motivos).toContain('SIN_RESPUESTA');
    for (const f of comp.faltantes) {
      expect(f.mensaje.startsWith('No existe información suficiente sobre')).toBe(true);
    }
    // Una pregunta omitida NO aparece como hecho ni como contradicción.
    const enHechos = new Set(comp.hechos.map((h) => h.preguntaId));
    const enContrad = new Set(comp.contradicciones.map((c) => c.preguntaId));
    for (const f of comp.faltantes) {
      expect(enHechos.has(f.preguntaId)).toBe(false);
      expect(enContrad.has(f.preguntaId)).toBe(false);
    }
    expect(comp.faltantes.some((f) => f.preguntaId === preguntas[1])).toBe(true);
    expect(comp.faltantes.some((f) => f.preguntaId === preguntas[4])).toBe(true);
  });

  it('respuestas contradictorias → contradicción abierta, no resolución inventada', async () => {
    const { comp, preguntas } = await correr();
    expect(comp.contradicciones.length).toBe(1);
    expect(comp.contradicciones[0]!.preguntaId).toBe(preguntas[2]);
    // El motor no resuelve: conserva evidencia a favor y en contra.
    expect(comp.contradicciones[0]!.evidenciaAFavor.length).toBeGreaterThan(0);
    expect(comp.contradicciones[0]!.evidenciaEnContra.length).toBeGreaterThan(0);
    expect(comp.abstenido).toBe(false);
  });

  it('cada hecho, faltante y contradicción conserva procedencia', async () => {
    const { comp } = await correr();
    expect(comp.hechos.length).toBe(1);
    const h = comp.hechos[0]!;
    expect(h.afirmacionId).toBeTruthy();
    expect(h.evidenciaIds.length).toBeGreaterThan(0);
    expect(h.preguntaId).toBeTruthy();
    const c = comp.contradicciones[0]!;
    expect(c.afirmacionId).toBeTruthy();
    expect(c.evidenciaAFavor.length + c.evidenciaEnContra.length).toBeGreaterThan(0);
    for (const f of comp.faltantes) expect(f.preguntaId).toBeTruthy();
  });

  it('la huella del rubro permanece idéntica antes y después del recorrido', async () => {
    const { motor, rubro } = nuevoMotor();
    const antes = rubro.version().huellaCompleta;
    await motor.comprender(respuestasEjemplo(rubro.preguntasDiagnosticas()), {
      diagnosticoId: 'dx-h',
      occurredAt: OCCURRED,
    });
    expect(rubro.version().huellaCompleta).toBe(antes);
  });
});
