'use client';

/**
 * «SOEC NECESITA QUE HAGAS UNA COSA».
 *
 * Una tarjeta, una tarea, un botón. Nada más, y es deliberado: cuando a alguien le faltan siete cosas, la
 * lista de las siete no le ayuda a empezar ninguna. El servidor ya decidió cuál toca por dependencia; aquí
 * sólo se pinta, se abre el sitio del proveedor y se vuelve a comprobar.
 *
 * Lo que esta tarjeta NUNCA hace: dar por hecha una tarea porque la persona diga que la hizo. El botón de
 * «Ya lo hice» pregunta al proveedor; si el mundo no cambió, la tarea sigue ahí, y eso es lo correcto.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { leerTarea, marcarAbierta, revisarTareas, type VistaTareas } from '../lib/handoff-client';

export function TareaPendiente({ org, alActuarDentro, alCambiarTarea }: {
  org: string;
  alActuarDentro?: () => void;
  /**
   * Qué canal tiene la próxima acción, o `null` si no hay ninguna. La pantalla lo usa para que la tarjeta de
   * ese canal se calle mientras tanto: dos botones que piden lo mismo con palabras distintas no son dos
   * oportunidades, son una duda.
   */
  alCambiarTarea?: (canal: string | null) => void;
}): React.ReactElement | null {
  const [vista, setVista] = useState<VistaTareas | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Se guarda en una referencia para no re-suscribir el efecto en cada render del padre.
  const avisar = useRef(alCambiarTarea);
  avisar.current = alCambiarTarea;

  const cargar = useCallback(async () => {
    try {
      const v = await leerTarea(org);
      setVista(v);
      setError(null);
      avisar.current?.(v.tarea?.canal ?? null);
    } catch {
      setVista(null); // sin tareas legibles no se inventa ninguna: la tarjeta simplemente no aparece
      avisar.current?.(null);
    }
  }, [org]);

  useEffect(() => { void cargar(); }, [cargar]);

  const tarea = vista?.tarea ?? null;
  if (tarea === null) return null;

  const actuar = async (): Promise<void> => {
    setOcupado('accion');
    setError(null);
    try {
      if (tarea.urlProveedor !== null) {
        // Se abre en otra pestaña: la persona vuelve aquí y la tarjeta sigue donde estaba.
        window.open(tarea.urlProveedor, '_blank', 'noopener,noreferrer');
        const v = await marcarAbierta(org, tarea.id);
        setVista(v);
        avisar.current?.(v.tarea?.canal ?? null);
      } else {
        alActuarDentro?.(); // la acción ocurre dentro de SOEC (conectar, elegir cuenta…)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo continuar');
    } finally {
      setOcupado(null);
    }
  };

  const comprobar = async (): Promise<void> => {
    setOcupado('comprobar');
    setError(null);
    try {
      const v = await revisarTareas(org);
      setVista(v);
      avisar.current?.(v.tarea?.canal ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo comprobar');
    } finally {
      setOcupado(null);
    }
  };

  return (
    <section className="tarea" aria-labelledby="tarea-titulo">
      <p className="tarea-etiqueta">SOEC necesita que hagas una cosa</p>
      <h2 id="tarea-titulo" className="tarea-titulo">{tarea.titulo}</h2>
      <p className="tarea-motivo">{tarea.motivo}</p>

      {tarea.bloqueadaFuera && (
        <p className="tarea-nota">Esto depende del proveedor y hoy no se puede avanzar. Te avisaremos en cuanto se pueda.</p>
      )}
      {tarea.esperando && !tarea.bloqueadaFuera && (
        <p className="tarea-nota">Ya abriste esta tarea. Cuando la termines, vuelve y compruébalo aquí.</p>
      )}
      {error !== null && <p className="tarea-error" role="alert">{error}</p>}

      <div className="tarea-acciones">
        {!tarea.bloqueadaFuera && (
          <button type="button" className="btn primary" disabled={ocupado !== null} onClick={() => void actuar()}>
            {ocupado === 'accion' ? 'Abriendo…' : tarea.etiquetaAccion}
          </button>
        )}
        {tarea.esperando && (
          <button type="button" className="btn" disabled={ocupado !== null} onClick={() => void comprobar()}>
            {ocupado === 'comprobar' ? 'Comprobando…' : 'Ya lo hice, compruébalo'}
          </button>
        )}
      </div>

      {vista !== null && vista.pendientes > 0 && (
        <p className="tarea-resto">Después de esto quedan {vista.pendientes} cosa(s) más. Te las iremos pidiendo de a una.</p>
      )}

      <style jsx>{`
        .tarea { border: 1px solid #fcd34d; background: #fffbeb; border-radius: 12px; padding: 16px; margin: 0 0 24px; }
        .tarea-etiqueta { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #92400e; }
        .tarea-titulo { margin: 0 0 8px; font-size: 20px; }
        .tarea-motivo { margin: 0 0 12px; color: #4b5563; }
        .tarea-nota { margin: 0 0 12px; color: #92400e; }
        .tarea-error { margin: 0 0 12px; color: #b00020; }
        .tarea-acciones { display: flex; flex-wrap: wrap; gap: 8px; }
        .tarea-resto { margin: 12px 0 0; color: #6b7280; font-size: 14px; }
      `}</style>
    </section>
  );
}
