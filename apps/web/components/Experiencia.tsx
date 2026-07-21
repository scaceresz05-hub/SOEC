'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, analizar, detalle, historial, nuevoId } from '../lib/client';
import type { ResultadoExperiencia } from '../lib/types';
import { Resultado } from './Resultado';

type Fase = 'inicial' | 'sin-analisis' | 'cargando' | 'analizando' | 'listo' | 'error';

export function Experiencia() {
  const [fase, setFase] = useState<Fase>('inicial');
  const [resultado, setResultado] = useState<ResultadoExperiencia | null>(null);
  const [historico, setHistorico] = useState(false);
  const [mensajeError, setMensajeError] = useState('');
  const execRef = useRef<string | null>(null);

  // Al abrir, recupera el último análisis persistido si existe (distingue nuevo de histórico).
  useEffect(() => {
    let vivo = true;
    (async () => {
      setFase('cargando');
      try {
        const h = await historial();
        if (!vivo) return;
        const ultimo = h[0];
        if (ultimo) {
          const r = await detalle(ultimo.executionId);
          if (!vivo) return;
          if (r) {
            execRef.current = r.executionId;
            setResultado(r);
            setHistorico(true);
            setFase('listo');
            return;
          }
        }
        setFase('sin-analisis');
      } catch {
        if (vivo) {
          setMensajeError('No se pudo consultar el estado. Puedes reintentar.');
          setFase('error');
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const ejecutar = useCallback(async (executionId: string) => {
    execRef.current = executionId;
    setFase('analizando');
    setHistorico(false);
    try {
      const r = await analizar(executionId);
      setResultado(r);
      setFase('listo');
    } catch (e) {
      setMensajeError(e instanceof ApiError ? e.message : 'Ocurrió un problema al analizar.');
      setFase('error');
    }
  }, []);

  const analizarNuevo = useCallback(() => {
    void ejecutar(nuevoId());
  }, [ejecutar]);

  const reintentar = useCallback(() => {
    // Reintento seguro e idempotente: reutiliza el mismo identificador de ejecución.
    void ejecutar(execRef.current ?? nuevoId());
  }, [ejecutar]);

  return (
    <div>
      <h1>Comprender el estado de mi empresa</h1>
      <p className="muted">
        SOEC analiza el estado actual de tu empresa y su entorno, y te lo presenta para que tú decidas. No decide ni actúa por ti.
      </p>

      {fase === 'cargando' && (
        <section className="card" aria-busy="true">
          <span className="spinner" />
          Recuperando el último análisis…
        </section>
      )}

      {fase === 'sin-analisis' && (
        <section className="card">
          <h2>Todavía no has analizado el estado de tu empresa</h2>
          <p className="muted small">Cuando quieras, SOEC revisará la situación actual y te mostrará qué comprende, en qué se basa y qué queda para tu juicio.</p>
          <button className="btn" onClick={analizarNuevo}>
            Analizar el estado actual
          </button>
        </section>
      )}

      {fase === 'analizando' && (
        <section className="card" aria-busy="true">
          <span className="spinner" />
          Analizando el estado actual de tu empresa…
          <p className="small muted" style={{ marginTop: 6 }}>SOEC está comprendiendo, no ejecutando ninguna acción.</p>
        </section>
      )}

      {fase === 'error' && (
        <section className="card">
          <div className="aviso aviso--danger">
            <strong>No fue posible completar la solicitud.</strong>
            <p className="small">{mensajeError}</p>
          </div>
          <button className="btn" onClick={reintentar}>
            Reintentar
          </button>
        </section>
      )}

      {fase === 'listo' && resultado && (
        <div>
          {historico && (
            <p className="small muted">Mostrando el último análisis realizado. Puedes generar uno nuevo con el estado actual.</p>
          )}
          <div style={{ margin: '10px 0 4px' }}>
            <button className="btn" onClick={analizarNuevo}>
              Analizar el estado actual
            </button>
          </div>
          <Resultado r={resultado} />
        </div>
      )}
    </div>
  );
}
