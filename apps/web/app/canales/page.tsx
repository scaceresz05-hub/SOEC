'use client';

import { useCallback, useEffect, useState } from 'react';
import { estadoCanales, prepararCanales, publicarActividad, publicarTodo, retirarActividad } from '../../lib/canales-client';
import type { ActividadCanal, EstadoCanales, PublicacionResumen } from '../../lib/canales-types';

const TONO: Record<string, string> = {
  verificada: 'ok',
  publicada: 'ok',
  aceptada: 'warn',
  procesando: 'warn',
  lista: 'warn',
  bloqueada: 'danger',
  fallida: 'danger',
  desconocida: 'danger',
  retirada: 'reserved',
};
function badge(estado: string) {
  return `badge badge--${TONO[estado] ?? 'reserved'}`;
}

function Publicacion({ p }: { p: PublicacionResumen }) {
  return (
    <div className="small" style={{ marginTop: 6 }}>
      <div>
        <span className={badge(p.estado)}>{p.estado}</span> <span className="chip">{p.modo}</span>
        {p.motivoBloqueo && <span className="chip">{p.motivoBloqueo}</span>}
        {p.externalRef && <span className="muted"> · ref {p.externalRef}</span>}
        {p.estadoRemoto && <span className="muted"> · remoto {p.estadoRemoto}</span>}
      </div>
      {p.intentos.length > 0 && <div className="muted">Intentos: {p.intentos.map((i) => `#${i.intentoId} ${i.resultado}`).join(' · ')}</div>}
      {p.reconciliaciones.length > 0 && <div className="muted">Reconciliación: {p.reconciliaciones.map((r) => r.tipo).join(', ')}</div>}
      {p.requiereIntervencion && <div className="badge badge--danger">requiere intervención</div>}
    </div>
  );
}

function Fila({ a, onPublicar, onRetirar, ocupado }: { a: ActividadCanal; onPublicar: (a: ActividadCanal) => void; onRetirar: (a: ActividadCanal) => void; ocupado: boolean }) {
  const puedePublicar = a.publicable && (!a.publicacion || ['fallida', 'desconocida'].includes(a.publicacion.estado));
  const puedeRetirar = a.publicacion && ['publicada', 'verificada'].includes(a.publicacion.estado);
  return (
    <li>
      <strong>{a.canal}</strong> <span className="chip">paquete {a.paqueteEstado ?? '—'}</span>
      {puedePublicar && <button className="btn btn--sec" style={{ marginLeft: 8 }} disabled={ocupado} onClick={() => onPublicar(a)}>Publicar</button>}
      {puedeRetirar && <button className="btn btn--sec" style={{ marginLeft: 8 }} disabled={ocupado} onClick={() => onRetirar(a)}>Retirar</button>}
      {a.publicacion && <Publicacion p={a.publicacion} />}
    </li>
  );
}

export default function CanalesPage() {
  const [estado, setEstado] = useState<EstadoCanales | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const refrescar = useCallback(async () => setEstado(await estadoCanales()), []);
  useEffect(() => {
    (async () => {
      await prepararCanales();
      await refrescar();
    })();
  }, [refrescar]);

  const correr = useCallback(
    async (fn: () => Promise<unknown>, describir?: (r: unknown) => string) => {
      setOcupado(true);
      try {
        const r = await fn();
        if (describir) setMensaje(describir(r));
        await refrescar();
      } finally {
        setOcupado(false);
      }
    },
    [refrescar],
  );

  if (!estado?.existe) {
    return (
      <div>
        <h1>Publicación controlada</h1>
        <section className="card"><span className="spinner" /> Preparando el contenido y las cuentas…</section>
      </div>
    );
  }

  return (
    <div>
      <h1>Publicación controlada</h1>
      <p className="muted">
        SOEC entrega el contenido a los canales por la empresa: prepara el envío, lo autoriza por la política, publica en un proveedor controlado, verifica el estado externo y reconcilia si la respuesta se pierde. No son instrucciones para copiar y pegar: es trabajo realizado y verificado.
      </p>
      <section className="card">
        <div className="kv">
          <dt>Empresa</dt><dd>{estado.empresa}</dd>
          <dt>Modo</dt><dd><span className="badge badge--warn">{estado.modo}</span> <span className="muted">(real desactivado por guardarraíl)</span></dd>
        </div>
      </section>

      <div style={{ margin: '10px 0' }}>
        <button className="btn" disabled={ocupado} onClick={() => correr(publicarTodo, (r) => {
          const x = r as { publicadas: number; verificadas: number; bloqueadas: number };
          return `SOEC publicó ${x.publicadas} pieza(s): ${x.verificadas} verificada(s), ${x.bloqueadas} bloqueada(s) por falta de un activo real.`;
        })}>Publicar todo</button>
      </div>
      {mensaje && <section className="card"><strong>{mensaje}</strong></section>}

      <h2>Trabajo por canal</h2>
      <section className="card">
        <ul className="limpia">
          {estado.actividades.map((a) => (
            <Fila
              key={a.id}
              a={a}
              ocupado={ocupado}
              onPublicar={(act) => correr(() => publicarActividad(act.id, act.canal), (r) => {
                const p = r as PublicacionResumen;
                return p.estado === 'verificada'
                  ? `SOEC publicó en ${p.canal} y verificó el estado externo (ref ${p.externalRef}).`
                  : p.estado === 'bloqueada'
                    ? `SOEC no publicó en ${p.canal}: ${p.motivoBloqueo}.`
                    : `SOEC intentó publicar en ${p.canal}: estado ${p.estado}.`;
              })}
              onRetirar={(act) => correr(() => retirarActividad(act.id, act.canal), (r) => {
                const p = r as PublicacionResumen;
                return `SOEC retiró la publicación de ${p.canal} (estado ${p.estado}).`;
              })}
            />
          ))}
        </ul>
      </section>

      <p className="small muted" style={{ marginTop: 14 }}>
        Ningún efecto público real ocurre aquí: la publicación se dirige a un proveedor emulado o simulado, sin credenciales reales ni gasto. El modo real permanece desactivado por política y guardarraíl hasta una autorización externa explícita.
      </p>
    </div>
  );
}
