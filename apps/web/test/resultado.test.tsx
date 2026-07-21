import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Resultado } from '../components/Resultado';
import { estadoDe } from '../lib/estado';
import { resultadoAbstenido, resultadoLimitado } from './fixtures';

describe('Vista de resultado — organizada por preguntas humanas', () => {
  it('presenta las cinco preguntas humanas, no la arquitectura interna', () => {
    render(<Resultado r={resultadoLimitado} />);
    expect(screen.getByText(/¿Qué está ocurriendo en mi empresa\?/)).toBeInTheDocument();
    expect(screen.getByText(/¿Qué señales importantes detectó SOEC\?/)).toBeInTheDocument();
    expect(screen.getByText(/¿En qué información se basa\?/)).toBeInTheDocument();
    expect(screen.getByText(/¿Qué no sabe todavía o qué resulta contradictorio\?/)).toBeInTheDocument();
    expect(screen.getByText(/¿Qué debo revisar o decidir personalmente\?/)).toBeInTheDocument();
    // No impone terminología interna como navegación principal.
    expect(screen.queryByText(/^ECE$|^MED$|^MDM$/)).toBeNull();
  });

  it('muestra detectar y esclarecer diferenciados, con evidencia', () => {
    render(<Resultado r={resultadoLimitado} />);
    expect(screen.getByText('Señales detectadas')).toBeInTheDocument();
    expect(screen.getByText('Aclaración de una tensión')).toBeInTheDocument();
    expect(screen.getAllByText(/Ver en qué se basa/).length).toBeGreaterThanOrEqual(2);
  });

  it('conserva las contradicciones abiertas y las reserva al juicio humano', () => {
    render(<Resultado r={resultadoLimitado} />);
    expect(screen.getByText('Lo que debes revisar o decidir personalmente')).toBeInTheDocument();
    expect(screen.getByText(/SOEC no tomó ninguna decisión por ti/)).toBeInTheDocument();
  });

  it('NO ofrece botones de acción sobre el resultado (soberanía)', () => {
    render(<Resultado r={resultadoLimitado} />);
    const prohibidos = /aprobar|ejecutar|corregir|lanzar|publicar|contactar|resolver|enviar|comprar/i;
    for (const b of screen.queryAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(prohibidos);
    }
  });

  it('la abstención tiene experiencia propia, no un error genérico', () => {
    const e = estadoDe(resultadoAbstenido);
    expect(e.clave).toBe('abstenida');
    render(<Resultado r={resultadoAbstenido} />);
    // Muestra qué impidió el resultado y qué falta (no un error genérico).
    expect(screen.getAllByText(/no fue posible|faltante|abstenida/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/comprensión con tensiones sobre la que orientar/).length).toBeGreaterThan(0);
  });

  it('estadoDe deriva "limitada" cuando hay contradicciones o faltantes (sin semáforo único)', () => {
    expect(estadoDe(resultadoLimitado).clave).toBe('limitada');
  });
});
