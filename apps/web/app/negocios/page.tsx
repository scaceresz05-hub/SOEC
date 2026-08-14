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
import {
  ETIQUETA_ESTADO_FUENTE,
  cabecerasOrg,
  estadoNoConfigurado,
  fijarOrgActiva,
  orgActiva,
} from '../../lib/org-activa';

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
const ESTADO_FUENTE = ETIQUETA_ESTADO_FUENTE;

/**
 * Dibuja un valor que puede ser desconocido. NUNCA lo convierte en 0: si no se conoce, lo dice.
 * Es la regla visual que separa «no medido» de «medido y dio cero».
 */
function formatoValor(v: Desconocible, moneda: string | null): string {
  if (!v.conocido || v.valor === null) return 'desconocido';
  return `${v.valor.toLocaleString('es-CL')}${moneda ? ` ${moneda}` : ''}`;
}

const VEREDICTO_FUNDAMENTOS: Record<string, string> = {
  FOUNDATION_REQUIRED: 'Faltan cimientos',
  OBSERVABLE_SIN_POLITICA: 'Observable, sin criterios',
  EVALUABLE: 'Evaluable',
};

interface Fundamentos {
  veredicto: string;
  motivos: { codigo: string; explicacion: string; resuelveCon: string }[];
  cimientosPresentes: string[];
  embudo: { pasos: { paso: string; estado: string }[] };
}

interface ResumenCatalogoVista {
  productosObservados: number;
  categoriasObservadas: number;
  precioMin: number | null;
  precioMax: number | null;
  moneda: string | null;
  enStock: number;
  sinStock: number;
  disponibilidadDesconocida: number;
}

/** Valor que puede estar legítimamente sin conocer. La UI NUNCA lo dibuja como 0. */
interface Desconocible {
  conocido: boolean;
  motivo?: string;
  valor: number | null;
}

interface AgrupadoVista {
  clave: string;
  pedidos: number;
  unidades: number;
  ingreso: number;
}

interface LineaBaseVentas {
  pedidos: number;
  pedidosConEvidenciaDePago: number;
  pedidosSinEvidenciaDePago: number;
  fechaMin: string | null;
  fechaMax: string | null;
  moneda: string | null;
  ingresoObservadoEnLaFuente: Desconocible;
  ticketPromedio: Desconocible;
  articulosPorPedido: Desconocible;
  unidadesVendidas: number;
  clientesUnicosSeudonimos: number;
  clientesRecurrentes: number;
  tasaDeRecompra: Desconocible;
  estados: { clave: string; n: number }[];
  mediosDePago: { clave: string; n: number }[];
  metodosDeEnvio: { clave: string; n: number }[];
  porMes: AgrupadoVista[];
  porRegion: AgrupadoVista[];
  porProducto: AgrupadoVista[];
  concentracionTop5: number | null;
  margenBruto: Desconocible;
  beneficio: Desconocible;
  cac: Desconocible;
  roas: Desconocible;
  ingresoAtribuido: Desconocible;
  ventasFueraDeLaFuente: Desconocible;
  coberturaDelNegocio: string;
}

interface VentasVista {
  observado: boolean;
  motivo?: string;
  estadoFuente?: string;
  lineaBase?: LineaBaseVentas;
}

interface CatalogoVista {
  observado: boolean;
  motivo?: string;
  source?: string;
  observedAt?: string;
  completo?: boolean;
  resumen?: ResumenCatalogoVista;
  hallazgos?: {
    codigo: string;
    severidad: string;
    afectados: number;
    total: number;
    detalle: string;
  }[];
}

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
  const [fundamentos, setFundamentos] = useState<Fundamentos | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoVista | null>(null);
  const [ventas, setVentas] = useState<VentasVista | null>(null);
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
      setFundamentos(null);
      setCatalogo(null);
      return;
    }
    const h = cabecerasOrg(org);
    (async () => {
      setAviso(null);
      try {
        const r = await fetch('/api/plataforma/negocio', { cache: 'no-store', headers: h });
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
    (async () => {
      try {
        const r = await fetch('/api/plataforma/fundamentos', { cache: 'no-store', headers: h });
        setFundamentos(r.ok ? ((await r.json()) as Fundamentos) : null);
      } catch {
        setFundamentos(null);
      }
    })();
    (async () => {
      try {
        const r = await fetch('/api/plataforma/catalogo', { cache: 'no-store', headers: h });
        setCatalogo(r.ok ? ((await r.json()) as CatalogoVista) : null);
      } catch {
        setCatalogo(null);
      }
    })();
    (async () => {
      try {
        const r = await fetch('/api/plataforma/ventas', { cache: 'no-store', headers: h });
        setVentas(r.ok ? ((await r.json()) as VentasVista) : null);
      } catch {
        setVentas(null);
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

          {fundamentos && (
            <>
              <h3 className="block">¿Puede SOEC dirigir este negocio todavía?</h3>
              <div className="card" style={{ padding: '8px 16px', marginBottom: 14 }}>
                <p className="s" style={{ margin: '6px 0' }}>
                  Veredicto:{' '}
                  <span
                    className={`pill ${fundamentos.veredicto === 'EVALUABLE' ? 'ok' : 'warn'}`}
                    style={{ fontSize: 10 }}
                  >
                    {VEREDICTO_FUNDAMENTOS[fundamentos.veredicto] ?? fundamentos.veredicto}
                  </span>
                </p>
                {fundamentos.cimientosPresentes.length > 0 && (
                  <p className="s" style={{ margin: '6px 0' }}>
                    Ya está: {fundamentos.cimientosPresentes.join(' · ')}
                  </p>
                )}
                {fundamentos.motivos.length > 0 && (
                  <ul className="s" style={{ margin: '4px 0 10px 18px' }}>
                    {fundamentos.motivos.map((m) => (
                      <li key={m.codigo}>
                        <b>{m.explicacion}</b>
                        <br />
                        <span className="muted">Se resuelve con: {m.resuelveCon}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="s muted" style={{ margin: '6px 0' }}>
                  Medición de embudo: {fundamentos.embudo.pasos.length} pasos sin instrumentar. Cero
                  eventos observados no es cero eventos ocurridos.
                </p>
              </div>
            </>
          )}

          {ventas && (
            <>
              <h3 className="block">Ventas observadas en WooCommerce</h3>
              <div className="card" style={{ padding: '8px 16px', marginBottom: 14 }}>
                {!ventas.observado || !ventas.lineaBase ? (
                  <p className="s muted" style={{ margin: '6px 0' }}>
                    {ventas.motivo === 'SALES_PENDING_CREDENTIALS'
                      ? 'Ventas: requiere credenciales. No es que no haya ventas: es que SOEC todavía no puede leerlas.'
                      : `Ventas todavía no observadas (${ventas.motivo ?? 'sin observación'}).`}
                  </p>
                ) : (
                  <>
                    <p className="s muted" style={{ margin: '6px 0' }}>
                      Esto es lo observado <b>en la tienda WooCommerce</b>, no el total de la
                      empresa: la cobertura de esta fuente es{' '}
                      <b>{ventas.lineaBase.coberturaDelNegocio}</b> y las ventas por WhatsApp,
                      transferencia o mostrador siguen siendo desconocidas.
                    </p>
                    <p className="s" style={{ margin: '6px 0' }}>
                      <b>{ventas.lineaBase.pedidos}</b> pedidos ·{' '}
                      {formatoValor(
                        ventas.lineaBase.ingresoObservadoEnLaFuente,
                        ventas.lineaBase.moneda,
                      )}{' '}
                      observados · ticket{' '}
                      {formatoValor(ventas.lineaBase.ticketPromedio, ventas.lineaBase.moneda)} ·{' '}
                      {formatoValor(ventas.lineaBase.articulosPorPedido, null)} artículos/pedido
                    </p>
                    <p className="s" style={{ margin: '6px 0' }}>
                      Período: {ventas.lineaBase.fechaMin?.slice(0, 10) ?? '—'} a{' '}
                      {ventas.lineaBase.fechaMax?.slice(0, 10) ?? '—'} ·{' '}
                      <b>{ventas.lineaBase.unidadesVendidas}</b> unidades · pago confirmado en{' '}
                      <b>{ventas.lineaBase.pedidosConEvidenciaDePago}</b> de{' '}
                      {ventas.lineaBase.pedidos}
                    </p>
                    <p className="s" style={{ margin: '6px 0' }}>
                      Clientes observados (seudónimos):{' '}
                      <b>{ventas.lineaBase.clientesUnicosSeudonimos}</b> · recurrentes:{' '}
                      <b>{ventas.lineaBase.clientesRecurrentes}</b>
                      {ventas.lineaBase.concentracionTop5 !== null && (
                        <>
                          {' · '}los 5 productos mayores concentran{' '}
                          <b>{Math.round(ventas.lineaBase.concentracionTop5 * 100)}%</b> del ingreso
                        </>
                      )}
                    </p>

                    <p className="s" style={{ margin: '10px 0 4px' }}>
                      <b>Top productos</b>
                    </p>
                    <ul className="s" style={{ margin: '0 0 10px 18px' }}>
                      {ventas.lineaBase.porProducto.slice(0, 5).map((p) => (
                        <li key={p.clave}>
                          producto <code>{p.clave}</code> — {p.unidades} u. en {p.pedidos} pedidos ·{' '}
                          {p.ingreso.toLocaleString('es-CL')} {ventas.lineaBase!.moneda ?? ''}
                        </li>
                      ))}
                    </ul>

                    <p className="s" style={{ margin: '10px 0 4px' }}>
                      <b>Por región</b>
                    </p>
                    <ul className="s" style={{ margin: '0 0 10px 18px' }}>
                      {ventas.lineaBase.porRegion.map((r) => (
                        <li key={r.clave}>
                          {r.clave} — {r.pedidos} pedidos · {r.ingreso.toLocaleString('es-CL')}{' '}
                          {ventas.lineaBase!.moneda ?? ''}
                        </li>
                      ))}
                    </ul>

                    <p className="s" style={{ margin: '6px 0' }}>
                      Medios de pago:{' '}
                      {ventas.lineaBase.mediosDePago.map((m) => `${m.clave} (${m.n})`).join(' · ')}
                      {' — '}Envío:{' '}
                      {ventas.lineaBase.metodosDeEnvio
                        .map((m) => `${m.clave} (${m.n})`)
                        .join(' · ')}
                    </p>

                    <p className="s" style={{ margin: '10px 0 4px' }}>
                      <b>Lo que estas ventas NO permiten afirmar</b>
                    </p>
                    <ul className="s muted" style={{ margin: '0 0 10px 18px' }}>
                      {(
                        [
                          ['Margen', ventas.lineaBase.margenBruto],
                          ['Beneficio', ventas.lineaBase.beneficio],
                          ['CAC', ventas.lineaBase.cac],
                          ['ROAS', ventas.lineaBase.roas],
                          ['Ingreso atribuido a un canal', ventas.lineaBase.ingresoAtribuido],
                          ['Ventas fuera de WooCommerce', ventas.lineaBase.ventasFueraDeLaFuente],
                        ] as const
                      ).map(([etiqueta, v]) => (
                        <li key={etiqueta}>
                          {etiqueta}: <b>desconocido</b>
                          {v.motivo ? ` (${v.motivo})` : ''} — no es cero
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          )}

          {catalogo && (
            <>
              <h3 className="block">Catálogo</h3>
              <div className="card" style={{ padding: '8px 16px', marginBottom: 14 }}>
                {!catalogo.observado ? (
                  <p className="s muted" style={{ margin: '6px 0' }}>
                    Catálogo todavía no observado ({catalogo.motivo}). No hay cifras que mostrar.
                  </p>
                ) : (
                  <>
                    <p className="s" style={{ margin: '6px 0' }}>
                      <b>{catalogo.resumen!.productosObservados}</b> productos ·{' '}
                      <b>{catalogo.resumen!.categoriasObservadas}</b> categorías · precios{' '}
                      {catalogo.resumen!.precioMin !== null
                        ? `${catalogo.resumen!.precioMin!.toLocaleString('es-CL')} – ${catalogo.resumen!.precioMax!.toLocaleString('es-CL')} ${catalogo.resumen!.moneda ?? ''}`
                        : 'no observados'}
                    </p>
                    <p className="s" style={{ margin: '6px 0' }}>
                      Disponibilidad: {catalogo.resumen!.enStock} en stock ·{' '}
                      {catalogo.resumen!.sinStock} sin stock
                      {catalogo.resumen!.disponibilidadDesconocida > 0 &&
                        ` · ${catalogo.resumen!.disponibilidadDesconocida} desconocida`}
                    </p>
                    <p className="s muted" style={{ margin: '6px 0' }}>
                      Observado el {new Date(catalogo.observedAt!).toLocaleString('es-CL')} desde{' '}
                      {catalogo.source} (solo lectura)
                      {catalogo.completo === false && ' · lectura incompleta'}
                    </p>
                    {catalogo.hallazgos && catalogo.hallazgos.length > 0 && (
                      <>
                        <p className="s" style={{ margin: '10px 0 4px' }}>
                          <b>Calidad de datos</b>{' '}
                          <span className="muted">(SOEC observa, no corrige)</span>
                        </p>
                        <ul className="s" style={{ margin: '0 0 10px 18px' }}>
                          {catalogo.hallazgos.map((h) => (
                            <li key={h.codigo}>
                              {h.detalle} — <b>{h.afectados}</b> de {h.total}{' '}
                              <span
                                className={`pill ${h.severidad === 'IMPIDE_MEDIR' ? 'warn' : 'mut'}`}
                                style={{ fontSize: 10 }}
                              >
                                {h.severidad}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          )}

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
