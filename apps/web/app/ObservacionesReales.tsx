'use client';

import { useEffect, useState } from 'react';

// Observaciones REALES (M8, puerta gobernada) ingeridas desde SmileFlow Growth — eje separado del simulado.
interface ObsReal {
  externalEventId: string; eventName: string; naturaleza: string; occurredAt: string; provider: string;
  diagnostico: boolean; elegibleParaAprendizaje: boolean; utmSource: string | null; utmCampaign: string | null; estado: string;
}
interface RealesResp { total: number; comerciales: number; diagnosticos: number; conclusion: string; observaciones: ObsReal[] }

export default function ObservacionesReales(): React.ReactElement | null {
  const [d, setD] = useState<RealesResp | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/medicion/reales', { cache: 'no-store' });
        if (r.ok) setD((await r.json()) as RealesResp);
      } catch { /* opcional: la home simulada sigue funcionando sin esto */ }
    })();
  }, []);
  if (!d || d.total === 0) return null;
  return (
    <>
      <h2 className="block">Datos reales de SmileFlow <span className="pill ok">REAL</span></h2>
      <div className="card" style={{ padding: '6px 16px' }}>
        <p className="s" style={{ margin: '8px 0' }}>
          {d.total} observación(es) <b>REAL</b> de <b>smileflow-growth</b> · {d.comerciales} comercial(es) · {d.diagnosticos} diagnóstico(s).{' '}
          Conclusión estadística: <b>{d.conclusion}</b> (muestra insuficiente: SOEC afirma el hecho real, no recomienda).
        </p>
        {d.observaciones.slice(0, 8).map((o) => (
          <div className="did" key={o.externalEventId}>
            <span className="tick medi" aria-hidden="true">◆</span>
            <div>
              <p className="t" style={{ margin: 0 }}>
                {o.eventName}{' '}
                <span className="pill ok" style={{ fontSize: '10px' }}>REAL</span>{' '}
                <span className="pill mut" style={{ fontSize: '10px' }}>{o.provider}</span>{' '}
                <span className={`pill ${o.elegibleParaAprendizaje ? 'mut' : 'warn'}`} style={{ fontSize: '10px' }}>
                  {o.diagnostico ? 'diagnóstico · no aprende' : 'comercial'}
                </span>
              </p>
              <p className="s" style={{ margin: 0 }}>#{o.externalEventId} · {o.occurredAt}{o.utmSource ? ` · utm ${o.utmSource}` : ''}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
