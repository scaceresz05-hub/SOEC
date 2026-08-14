'use client';

/**
 * MIS NEGOCIOS — selector multiempresa.
 *
 * Es un SELECTOR, no un portafolio: muestra nombre y estado de incorporación de cada negocio, y
 * ninguna cifra comercial. Al elegir uno, todo el panel queda acotado a ese negocio.
 *
 * Honestidad epistémica: una fuente sin conectar se muestra como «no conectada» con lo que falta,
 * jamás como un cero. `CERO ≠ NO CONECTADO`.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { cabecerasOrg, estadoNoConfigurado, orgActiva, fijarOrgActiva } from '../../lib/org-activa';

interface NegocioEnLista {
  organizationId: string;
  displayName: string;
  estado: string;
  modeloDeNegocio: string;
  mercado: string;
}

interface FuenteVista {
  sourceId: string;
  tipo: string;
  proveedor: string;
  estado: string;
  faltantes: string[];
}

interface DetalleNegocio {
  organizationId: string;
  businessKey: string;
  displayName: string;
  legalName: string;
  rut: string | null;
  modeloDeNegocio: string;
  mercado: string;
  estado: string;
  categoriasDeclaradas: string[];
  perfilDeEvaluacion: { configurado: boolean; objetivoId?: string; motivo?: string };
  fuentes: FuenteVista[];
  resumenFuentes: {
    conectadas: number;
    pendientes: number;
    noConectadas: number;
    noAplica: number;
  };
  experienciasHabilitadas: string[];
  datosHumanosPendientes: string[];
}

/** Etiqueta humana del estado de incorporación. Nunca dice «operativo» si no lo está. */
const ESTADO_NEGOCIO: Record<string, { texto: string; cls: string }> = {
  CREATED: { texto: 'Creado', cls: 'mut' },
  CONFIGURING: { texto: 'Configurando', cls: 'warn' },
  SOURCES_PENDING: { texto: 'Configurando · faltan fuentes', cls: 'warn' },
  OBSERVING: { texto: 'Observando', cls: 'ok' },
  EVALUABLE: { texto: 'Evaluable', cls: 'ok' },
};

/** Etiqueta humana del estado de una fuente. «Pendiente» ╪ «cero». */
const ESTADO_FUENTE: Record<string, { texto: string; cls: string }> = {
  CONNECTED_READ_ONLY: { texto: 'Conectada (solo lectura)', cls: 'ok' },
  PENDING: { texto: 'Pendiente', cls: 'warn' },
  NOT_CONNECTED: { texto: 'No conectada', cls: 'mut' },
  NOT_APPLICABLE: { texto: 'No aplica', cls: 'mut' },
};

const TIPO_FUENTE: Record<string, string> = {
  WEBSITE: 'Sitio web',
  ECOMMERCE: 'Tienda / e-commerce',
  ADS: 'Google Ads',
  ANALYTICS: 'GA4 / analítica',
  MERCHANT: 'Merchant Center',
  SALES: 'Ventas',
  CATALOG: 'Catálogo',
  CRM: 'CRM / clientes',
  PAYMENTS: 'Medios de pago',
  SHIPPING: 'Despacho',
  GROWTH: 'Eventos de producto',
};

export default function Negocios(): React.ReactElement {
  const [lista, setLista] = useState<NegocioEnLista[] | null>(null);
  const [org, setOrg] = useState<string | null | undefined>(undefined);
  const [detalle, setDetalle] = useState<DetalleNegocio | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    setOrg(orgActiva());
  }, []);

  // La lista de negocios necesita algún contexto de organización para la API; se usa el activo, y
  // si no hay ninguno todavía, no se inventa: se pide elegir.
  const cargarLista = useCallback(async (desde: string) => {
    try {
      const r = await fetch('/api/plataforma/negocios', {
        cache: 'no-store',
        headers: cabecerasOrg(desde),
      });
      if (r.ok) setLista(((await r.json()) as { negocios: NegocioEnLista[] }).negocios);
    } catch {
      /* la vista sigue siendo utilizable con el negocio activo */
    }
  }, []);

  useEffect(() => {
    if (org === undefined) return;
    const referencia = org ?? 'org-smileflow';
    void cargarLista(referencia);
  }, [org, cargarLista]);

  useEffect(() => {
    if (!org) {
      setDetalle(null);
      return;
    }
    (async () => {
      setAviso(null);
      try {
        const r = await fetch('/api/plataforma/negocio', {
          cache: 'no-store',
          headers: cabecerasOrg(org),
        });
        if (!r.ok) {
          const cuerpo = (await r.json().catch(() => ({}))) as { error?: string };
          setDetalle(null);
          setAviso(estadoNoConfigurado(cuerpo.error) ?? 'No se pudo cargar el negocio.');
          return;
        }
        setDetalle((await r.json()) as DetalleNegocio);
      } catch {
        setAviso('No se pudo contactar el servicio.');
      }
    })();
  }, [org]);

  function elegir(id: string): void {
    fijarOrgActiva(id);
    setOrg(id);
  }

  if (org === undefined)
    return (
      <div className="wrap panel">
        <p className="lede">Cargando…</p>
      </div>
    );

  return (
    <div className="wrap panel">
      <h1>Mis negocios</h1>
      <p className="muted small">
        SOEC no elige un negocio por vos. Los datos de una empresa nunca se muestran en el panel de
        otra.
      </p>

      <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
        {(lista ?? []).map((n) => {
          const e = ESTADO_NEGOCIO[n.estado] ?? { texto: n.estado, cls: 'mut' };
          const activo = n.organizationId === org;
          return (
            <div className="card" key={n.organizationId} style={{ padding: '10px 14px' }}>
              <p style={{ margin: 0 }}>
                <b>{n.displayName}</b>{' '}
                <span className={`pill ${e.cls}`} style={{ fontSize: 10 }}>
                  {e.texto}
                </span>{' '}
                {activo && (
                  <span className="pill ok" style={{ fontSize: 10 }}>
                    seleccionado
                  </span>
                )}
              </p>
              <p className="s muted" style={{ margin: '2px 0 8px' }}>
                {n.modeloDeNegocio === 'ECOMMERCE_DISTRIBUCION'
                  ? 'E-commerce / distribución'
                  : n.modeloDeNegocio}
                {' · '}
                {n.mercado}
                {' · '}
                <code>{n.organizationId}</code>
              </p>
              <button className="btn" onClick={() => elegir(n.organizationId)} disabled={activo}>
                {activo ? 'Negocio actual' : 'Entrar a este negocio'}
              </button>
            </div>
          );
        })}
        {lista !== null && lista.length === 0 && (
          <p className="muted">No hay negocios registrados en esta instalación.</p>
        )}
      </div>

      {!org && <p className="lede">Elegí un negocio para ver su estado.</p>}
      {aviso && <div className="aviso aviso--danger">{aviso}</div>}

      {detalle && (
        <>
          <h2 className="block">{detalle.displayName}</h2>
          <div className="card" style={{ padding: '8px 16px', marginBottom: 14 }}>
            <p className="s" style={{ margin: '6px 0' }}>
              Razón social: <b>{detalle.legalName}</b>
              {' · '}RUT:{' '}
              {detalle.rut ?? (
                <span className="pill warn" style={{ fontSize: 10 }}>
                  pendiente
                </span>
              )}
              {' · '}Mercado: {detalle.mercado}
            </p>
            {detalle.categoriasDeclaradas.length > 0 && (
              <p className="s" style={{ margin: '6px 0' }}>
                Categorías declaradas: {detalle.categoriasDeclaradas.join(' · ')}{' '}
                <span className="muted">(contexto declarado, no el catálogo real)</span>
              </p>
            )}
            <p className="s" style={{ margin: '6px 0' }}>
              Objetivos y criterios de evaluación:{' '}
              {detalle.perfilDeEvaluacion.configurado ? (
                <span className="pill ok" style={{ fontSize: 10 }}>
                  configurados
                </span>
              ) : (
                <span className="pill warn" style={{ fontSize: 10 }}>
                  no configurados
                </span>
              )}
            </p>
          </div>

          <h3 className="block">Fuentes de datos</h3>
          <div className="card" style={{ padding: '8px 16px', marginBottom: 14 }}>
            <p className="s muted" style={{ margin: '6px 0' }}>
              Una fuente no conectada no significa cero resultados: significa que todavía no hay de
              dónde leer.
            </p>
            {detalle.fuentes.map((f) => {
              const e = ESTADO_FUENTE[f.estado] ?? { texto: f.estado, cls: 'mut' };
              return (
                <div className="did" key={f.sourceId}>
                  <span className="tick medi" aria-hidden="true">
                    ◆
                  </span>
                  <div>
                    <p className="t" style={{ margin: 0 }}>
                      {TIPO_FUENTE[f.tipo] ?? f.tipo}{' '}
                      <span className={`pill ${e.cls}`} style={{ fontSize: 10 }}>
                        {e.texto}
                      </span>
                    </p>
                    {f.faltantes.length > 0 && (
                      <p className="s muted" style={{ margin: 0 }}>
                        Falta: {f.faltantes.join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {detalle.datosHumanosPendientes.length > 0 && (
            <>
              <h3 className="block">Lo que SOEC necesita de vos</h3>
              <div className="card" style={{ padding: '8px 16px', marginBottom: 14 }}>
                <p className="s muted" style={{ margin: '6px 0' }}>
                  SOEC no inventa estos datos. Hasta tenerlos, este negocio no puede evaluarse.
                </p>
                <ul className="s" style={{ margin: '4px 0 10px 18px' }}>
                  {detalle.datosHumanosPendientes.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {detalle.experienciasHabilitadas.length > 0 ? (
            <p className="s">
              <Link href="/resultados">Ver resultados de {detalle.displayName} →</Link>
            </p>
          ) : (
            <p className="s muted">
              Este negocio todavía no tiene ninguna vista de resultados: no hay fuentes conectadas
              ni criterios de evaluación.
            </p>
          )}
        </>
      )}

      <p style={{ marginTop: 20 }}>
        <Link href="/">← Volver al inicio</Link>
      </p>
    </div>
  );
}
