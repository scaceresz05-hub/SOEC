'use client';
/**
 * apps/web · Autonomía · CAPACIDADES (CIA). El usuario autoriza RESULTADOS a SOEC, con un límite. Nunca ve
 * ni elige herramientas: la plataforma decide el proveedor detrás de la frontera. Consume la API canónica
 * `/api/cia/*`; degrada con gracia si la API no responde (no rompe la página).
 */
import { useEffect, useState } from 'react';
import { obtenerCatalogo, obtenerInicio, autorizarCapacidad, mensajeDeError } from '../../lib/cia-client';
import type { CapacidadActiva, CapacidadCatalogo, NivelAutonomia } from '../../lib/cia-types';

export default function CapacidadesCIA() {
  const [catalogo, setCatalogo] = useState<CapacidadCatalogo[]>([]);
  const [activas, setActivas] = useState<Record<string, CapacidadActiva>>({});
  const [aviso, setAviso] = useState<string | null>(null);

  async function refrescar() {
    const [cat, ini] = await Promise.all([obtenerCatalogo(), obtenerInicio()]);
    setCatalogo(cat);
    setActivas(Object.fromEntries(ini.capacidades.map((c) => [c.capacidadId, c])));
  }
  useEffect(() => { void refrescar(); }, []);

  async function autorizar(c: CapacidadCatalogo, nivel: NivelAutonomia, limite: number) {
    const r = await autorizarCapacidad(c.id, { limite, nivelAutonomia: nivel, actorHumano: 'humano-1' });
    setAviso(r.ok ? `Autorizaste: ${c.titulo}` : mensajeDeError(r));
    await refrescar();
  }

  if (catalogo.length === 0) return null; // sin API disponible: no estorba la página

  return (
    <section style={{ marginTop: 24 }}>
      <h2 className="block">Qué autorizas a SOEC</h2>
      <p className="lede" style={{ fontSize: '14.5px' }}>
        Autoriza <b>resultados</b>, no herramientas. SOEC elige por dentro cómo lograrlos; tú fijas el límite y
        cuánto delegas. Todo es simulado.
      </p>
      <div className="card">
        {catalogo.map((c) => {
          const a = activas[c.id];
          return (
            <div key={c.id} className="obj" style={{ alignItems: 'start' }}>
              <div className="name">{c.titulo}</div>
              <div className="meta">{c.descripcion}</div>
              <div className="val">
                {a ? (
                  <span className={`pill ${a.estado === 'Activa' ? 'ok' : 'mut'}`} style={{ fontSize: '10.5px' }}>{a.estado}</span>
                ) : (
                  <span className="pill mut" style={{ fontSize: '10.5px' }}>Sin autorizar</span>
                )}
              </div>
              <div className="meta" style={{ display: 'flex', gap: 8 }}>
                <button className="btn" type="button" onClick={() => void autorizar(c, 'RECOMENDAR', c.unidadLimite === 'SIN_GASTO' ? 0 : 100000)}>Sólo recomendar</button>
                <button className="btn" type="button" onClick={() => void autorizar(c, 'EJECUTAR_CON_APROBACION', c.unidadLimite === 'SIN_GASTO' ? 0 : 100000)}>Ejecutar con mi aprobación</button>
              </div>
            </div>
          );
        })}
      </div>
      {aviso && <p className="sim">{aviso}</p>}
    </section>
  );
}
