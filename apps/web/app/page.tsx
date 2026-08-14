'use client';

/**
 * INICIO · MIS EMPRESAS (home multiempresa).
 *
 * La entrada de SOEC. Tarjetas claras por negocio, con una cifra titular real y su estado en lenguaje
 * humano. No mezcla números entre empresas; no es un portafolio consolidado. Elegir una empresa abre
 * su panel de dirección.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cabecerasOrg, fijarOrgActiva } from '../lib/org-activa';
import { Badge, PageHeader, clp, colorDeNegocio, iniciales, num, type Tono } from '../components/ui';

interface Negocio {
  organizationId: string;
  displayName: string;
  estado: string;
  modeloDeNegocio: string;
  mercado: string;
}

/** Estado de incorporación en lenguaje humano (nunca un enum, nunca «cero»). */
const ESTADO: Record<string, { texto: string; tono: Tono }> = {
  CREATED: { texto: 'Configurando', tono: 'warn' },
  CONFIGURING: { texto: 'Configurando', tono: 'warn' },
  SOURCES_PENDING: { texto: 'Faltan fundamentos', tono: 'warn' },
  SOURCES_PARTIAL: { texto: 'Faltan fundamentos', tono: 'warn' },
  OBSERVING: { texto: 'Observando', tono: 'info' },
  EVALUABLE: { texto: 'Evaluable', tono: 'ok' },
};

function tipoTexto(m: string): string {
  if (m === 'ECOMMERCE_DISTRIBUCION') return 'E-commerce / distribución';
  if (m === 'SAAS_FUNNEL') return 'Software dental (SaaS)';
  return m;
}

interface Titular {
  a: { k: string; v: string };
  b: { k: string; v: string };
  dice: string;
}

/** Cifra titular real por negocio, según su modelo. Desconocido ≠ cero. */
async function titularDe(n: Negocio): Promise<Titular | null> {
  const h = cabecerasOrg(n.organizationId);
  try {
    if (n.modeloDeNegocio === 'ECOMMERCE_DISTRIBUCION') {
      const r = await fetch('/api/plataforma/ventas', { cache: 'no-store', headers: h });
      const d = (await r.json()) as {
        observado?: boolean;
        lineaBase?: { pedidos: number; ingresoConfirmado: { conocido: boolean; valor: number | null } };
      };
      if (!d.observado || !d.lineaBase) return null;
      return {
        a: { k: 'Facturación confirmada', v: d.lineaBase.ingresoConfirmado.conocido ? clp(d.lineaBase.ingresoConfirmado.valor) : '—' },
        b: { k: 'Pedidos', v: num(d.lineaBase.pedidos) },
        dice: 'Ya conozco tus ventas y tu catálogo; todavía necesito medición y márgenes para recomendarte publicidad.',
      };
    }
    if (n.modeloDeNegocio === 'SAAS_FUNNEL') {
      const r = await fetch('/api/medicion/panel', { cache: 'no-store', headers: h });
      const d = (await r.json()) as {
        ads?: { impressions: number; clicks: number };
        growthFunnel?: { comercial?: { lead_created: number } };
      };
      if (!d.ads) return null;
      const leads = d.growthFunnel?.comercial?.lead_created ?? 0;
      return {
        a: { k: 'Impresiones', v: num(d.ads.impressions) },
        b: { k: 'Leads reales', v: num(leads) },
        dice:
          d.ads.clicks > 0 && leads === 0
            ? 'El tráfico llega, pero todavía no se convierte en clientes.'
            : 'Estoy observando tu campaña y reuniendo evidencia.',
      };
    }
  } catch {
    /* sin titular: la tarjeta se muestra igual, sin inventar cifras */
  }
  return null;
}

export default function Home(): React.ReactElement {
  const router = useRouter();
  const [lista, setLista] = useState<Negocio[] | null>(null);
  const [titulares, setTitulares] = useState<Record<string, Titular | null>>({});

  useEffect(() => {
    fetch('/api/plataforma/negocios', { cache: 'no-store', headers: cabecerasOrg('org-smileflow') })
      .then((r) => (r.ok ? r.json() : { negocios: [] }))
      .then((d: { negocios?: Negocio[] }) => setLista(d.negocios ?? []))
      .catch(() => setLista([]));
  }, []);

  useEffect(() => {
    if (!lista) return;
    lista.forEach((n) => {
      void titularDe(n).then((t) => setTitulares((prev) => ({ ...prev, [n.organizationId]: t })));
    });
  }, [lista]);

  function entrar(id: string): void {
    fijarOrgActiva(id);
    router.push(`/negocios?org=${encodeURIComponent(id)}`);
  }

  return (
    <div className="dash panel">
      <PageHeader eyebrow="SOEC · tu director de marketing" title="Mis empresas" />
      <p className="lede">
        SOEC dirige cada negocio por separado. Elegí una empresa para ver cómo va, qué recomienda SOEC
        y qué necesita de vos. Los datos de una empresa nunca se mezclan con los de otra.
      </p>

      {lista === null && (
        <div className="grid g-2">
          <div className="card" style={{ height: 150 }} />
          <div className="card" style={{ height: 150 }} />
        </div>
      )}

      <div className="grid g-2">
        {(lista ?? []).map((n) => {
          const e = ESTADO[n.estado] ?? { texto: n.estado, tono: 'mut' as Tono };
          const t = titulares[n.organizationId];
          return (
            <div className="bizcard" key={n.organizationId}>
              <div className="bctop">
                <span className="bcav" style={{ background: colorDeNegocio(n.organizationId) }} aria-hidden="true">
                  {iniciales(n.displayName)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="bcname">{n.displayName}</div>
                  <div className="bckind">
                    {tipoTexto(n.modeloDeNegocio)} · {n.mercado}
                  </div>
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <Badge tono={e.tono}>{e.texto}</Badge>
                </div>
              </div>
              <div className="bcbody">
                {t === undefined ? (
                  <div className="bcstat" style={{ opacity: 0.4 }}>
                    <div>
                      <div className="k">Cargando…</div>
                      <div className="v">—</div>
                    </div>
                  </div>
                ) : t === null ? (
                  <div className="bcstat">
                    <div>
                      <div className="k">Datos</div>
                      <div className="v" style={{ fontSize: 14, color: 'var(--ink-faint)' }}>
                        aún sin observar
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bcstat">
                    <div>
                      <div className="k">{t.a.k}</div>
                      <div className="v">{t.a.v}</div>
                    </div>
                    <div>
                      <div className="k">{t.b.k}</div>
                      <div className="v">{t.b.v}</div>
                    </div>
                  </div>
                )}
                {t && (
                  <p style={{ margin: '10px 0 0', fontFamily: 'var(--voice)', fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
                    <span aria-hidden="true" style={{ color: 'var(--brass)', fontWeight: 700 }}>SOEC:</span> “{t.dice}”
                  </p>
                )}
              </div>
              <div className="bcfoot">
                <span className="small muted">
                  <code>{n.organizationId}</code>
                </span>
                <button className="btn primary" onClick={() => entrar(n.organizationId)}>
                  Entrar →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {lista !== null && lista.length === 0 && (
        <div className="card">
          <p className="muted">No hay empresas registradas en esta instalación.</p>
        </div>
      )}
    </div>
  );
}
