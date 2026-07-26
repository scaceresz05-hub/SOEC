/**
 * Regresión: la UI debe mostrar el mensaje real del servicio, no un código técnico genérico.
 * Verifica el orden `message` del servicio → mensaje conocido por `error` → genérico seguro.
 */
import { describe, it, expect } from 'vitest';
import { mensajeDeError } from './evaluacion-client';

describe('mensajeDeError', () => {
  it('usa el `message` del servicio cuando está presente', () => {
    expect(
      mensajeDeError({
        error: 'SeleccionInvalidaError',
        message: 'Combinación organización/departamento no válida: clinica-demo / marketing',
      }),
    ).toBe('Combinación organización/departamento no válida: clinica-demo / marketing');
  });

  it('sin `message`, mapea el código de error conocido a un texto comprensible', () => {
    expect(mensajeDeError({ error: 'SeleccionInvalidaError' })).toBe(
      'La organización o el departamento seleccionados no son válidos.',
    );
    expect(mensajeDeError({ error: 'SeleccionRequerida' })).toBe(
      'Selecciona una organización y un departamento válidos.',
    );
  });

  it('sin JSON válido o error desconocido, usa el genérico seguro (nunca códigos crudos)', () => {
    const generico = 'No se pudo completar la acción. Revisa la selección e inténtalo nuevamente.';
    expect(mensajeDeError(null)).toBe(generico);
    expect(mensajeDeError({ error: 'AlgoDesconocido' })).toBe(generico);
    expect(mensajeDeError({ message: '' })).toBe(generico);
    expect(mensajeDeError('texto plano')).toBe(generico);
  });
});
