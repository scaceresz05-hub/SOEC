'use client';

import { useEffect, useState } from 'react';
import { cabecerasOrg, orgActiva } from '../lib/org-activa';

// Observaciones REALES (M8, puerta gobernada) del NEGOCIO ACTIVO — eje separado del simulado.
// Sin negocio elegido no se pide nada: este bloque simplemente no aparece (nunca muestra el de otro).
interface ObsReal {
  externalEventId: string;
  eventName: string;
  naturaleza: string;
  occurredAt: string;
  provider: string;
  diagnostico: boolean;
  elegibleParaAprendizaje: boolean;
  utmSource: string | null;
  utmCampaign: string | null;
  estado: string;
}
interface Sync {
  provider: string;
  ok: boolean | null;
  at: string | null;
}
interface RealesResp {
  organizationId?: string;
  total: number;
  comerciales: number;
  diagnosticos: number;
  conclusion: string;
  porProveedor?: Record<string, number>;
  sincronizaciones?: Sync[];
  observaciones: ObsReal[];
}

export default function ObservacionesReales(): React.ReactElement | null {
  const [d, setD] = useState<RealesResp | null>(null);
  useEffect(() => {
    const org = orgActiva();
    if (!org) return; // sin negocio activo no hay datos reales que mostrar
    (async () => {
      try {
        const r = await fetch('/api/medicion/reales', {
          cache: 'no-store',
          headers: cabecerasOrg(org),
        });
        if (r.ok) setD((await r.json()) as RealesResp);
      } catch {
        /* opcional: la home simulada sigue funcionando sin esto */
      }
    })();
  }, []);
  if (!d || d.total === 0) return null;
  return (
    <>
      <h2 className="block">
        Datos reales{d.organizationId ? ` · ${d.organizationId}` : ''}{' '}
        <span className="pill ok">REAL</span>
      </h2>
      <div className="card" style={{ padding: '6px 16px' }}>
        <p className="s" style={{ margin: '8px 0' }}>
          {d.total} observación(es) <b>REAL</b>
          {d.porProveedor &&
            Object.entries(d.porProveedor).map(([prov, n]) => (
              <span key={prov} className="pill mut" style={{ fontSize: '10px', marginLeft: 4 }}>
                {prov}: {n}
              </span>
            ))}
          {' · '}
          {d.comerciales} comercial(es) · {d.diagnosticos} diagnóstico(s). Conclusión estadística:{' '}
          <b>{d.conclusion}</b> (muestra insuficiente: SOEC afirma el hecho real, no recomienda).
        </p>
        {d.sincronizaciones && d.sincronizaciones.length > 0 && (
          <p className="s" style={{ margin: '4px 0' }}>
            Última sincronización autónoma:{' '}
            {d.sincronizaciones.map((s) => (
              <span
                key={s.provider}
                className={`pill ${s.ok ? 'ok' : s.ok === false ? 'warn' : 'mut'}`}
                style={{ fontSize: '10px', marginRight: 4 }}
              >
                {s.provider} {s.ok ? '✓' : s.ok === false ? '✗' : '—'}{' '}
                {s.at ? new Date(s.at).toLocaleString() : 'sin datos'}
              </span>
            ))}
          </p>
        )}
        {d.observaciones.slice(0, 8).map((o) => (
          <div className="did" key={o.externalEventId}>
            <span className="tick medi" aria-hidden="true">
              ◆
            </span>
            <div>
              <p className="t" style={{ margin: 0 }}>
                {o.eventName}{' '}
                <span className="pill ok" style={{ fontSize: '10px' }}>
                  REAL
                </span>{' '}
                <span className="pill mut" style={{ fontSize: '10px' }}>
                  {o.provider}
                </span>{' '}
                <span
                  className={`pill ${o.elegibleParaAprendizaje ? 'mut' : 'warn'}`}
                  style={{ fontSize: '10px' }}
                >
                  {o.diagnostico ? 'diagnóstico · no aprende' : 'comercial'}
                </span>
              </p>
              <p className="s" style={{ margin: 0 }}>
                #{o.externalEventId} · {o.occurredAt}
                {o.utmSource ? ` · utm ${o.utmSource}` : ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
