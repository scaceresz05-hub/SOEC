'use client';

/**
 * PANEL DEL NEGOCIO · dashboard ejecutivo por empresa.
 *
 * Una persona sin conocimientos debe entender en segundos: qué empresa ve, cómo va, qué recomienda
 * SOEC y qué necesita de ella. La experiencia se ADAPTA al modelo del negocio:
 *   · e-commerce (C Y P)  → ventas, productos, catálogo;
 *   · software / SaaS (SmileFlow) → publicidad, tráfico, embudo de clientes.
 * El lenguaje es humano; la jerga vive en «Detalles técnicos».
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { cabecerasOrg, ETIQUETA_ESTADO_FUENTE, orgActiva } from '../../lib/org-activa';
import {
  Badge,
  Callout,
  clp,
  DirectorCard,
  EmptyState,
  Funnel,
  Metric,
  num,
  PageHeader,
  PriorityList,
  SourceRow,
  TechDetails,
  TrendBars,
  valor,
  type Desconocible,
  type Tono,
} from '../../components/ui';

/* ── Tipos de vista (subconjunto honesto de las respuestas) ──────────────── */
interface FuenteVista { sourceId: string; tipo: string; proveedor: string; estado: string; faltantes: string[] }
interface Negocio {
  displayName: string; legalName: string; rut: string | null; modeloDeNegocio: string; mercado: string;
  estado: string; categoriasDeclaradas: string[];
  fuentes: FuenteVista[]; datosHumanosPendientes: string[];
}
interface Motivo { codigo: string; explicacion: string; resuelveCon: string }
interface Fundamentos { veredicto: string; motivos: Motivo[]; cimientosPresentes: string[]; puedeRecomendarInversionPublicitaria: boolean }
interface Agrupado { clave: string; pedidos: number; unidades: number; ingreso: number }
interface LineaBase {
  pedidos: number; pedidosConEvidenciaDePago: number; pedidosSinEvidenciaDePago: number;
  fechaMin: string | null; fechaMax: string | null; moneda: string | null;
  ingresoObservadoEnLaFuente: Desconocible; ingresoConfirmado: Desconocible; reembolsosConfirmados: Desconocible;
  ticketPromedio: Desconocible; medianaTicket: Desconocible; unidadesVendidas: number; productosConVentasObservadas: number;
  concentracionTop5: number | null; porMes: Agrupado[]; porProducto: Agrupado[]; porRegion: Agrupado[];
  margenBruto: Desconocible; beneficio: Desconocible; cac: Desconocible; roas: Desconocible;
}
interface ProductosCruce { catalogoObservado?: number; conVentasObservadas?: number; sinVentasObservadas?: number; vendidosFueraDelCatalogo?: number }
interface Ventas { observado: boolean; motivo?: string; lineaBase?: LineaBase; productos?: ProductosCruce }
interface Catalogo { observado: boolean; resumen?: { productosObservados: number; categoriasObservadas: number; enStock: number; sinStock: number } }
interface Panel {
  ads?: { impressions: number; clicks: number; cost: number; ctr: number; cpc: number };
  growthFunnel?: { comercial?: Record<string, number>; diagnostico?: Record<string, number> };
  searchTerms?: { termino: string; impresiones: number; clics: number }[];
}
interface Director { veredicto?: string; interpretacion?: { calidad?: string } }
interface Plan { oportunidadesTacticas?: { termino: string; accion: string }[] }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function mesCorto(clave: string): string {
  const m = Number(clave.slice(5, 7));
  return `${MESES[m - 1] ?? clave} ${clave.slice(2, 4)}`;
}
const VEREDICTO_HUMANO: Record<string, { texto: string; tono: Tono }> = {
  FOUNDATION_REQUIRED: { texto: 'Faltan fundamentos', tono: 'warn' },
  OBSERVABLE_SIN_POLITICA: { texto: 'Observando', tono: 'info' },
  EVALUABLE: { texto: 'Evaluable', tono: 'ok' },
  OBSERVAR: { texto: 'Observando', tono: 'info' },
  NO_EVALUABLE: { texto: 'Sin datos suficientes', tono: 'warn' },
  RECOMENDAR: { texto: 'Tengo una recomendación', tono: 'ok' },
};
const PRIORIDAD_TITULO: Record<string, string> = {
  ANALYTICS_NOT_CONFIGURED: 'Instalar medición web para ver de dónde vienen tus clientes',
  ECONOMICS_UNKNOWN: 'Cargar tus costos para conocer el margen de cada venta',
  NATIONWIDE_SHIPPING_NOT_READY: 'Configurar el despacho a todo el país en la tienda',
  ADS_NOT_CONFIGURED: 'Conectar Google Ads (solo lectura) para observar tus campañas',
  BUSINESS_PROFILE_NOT_CONFIGURED: 'Definir el objetivo del negocio',
  CATALOG_NOT_OBSERVED: 'Conectar el catálogo de la tienda',
  SALES_NOT_CONNECTED: 'Conectar las ventas de la tienda',
};

export default function Panel(): React.ReactElement {
  const [org, setOrg] = useState<string | null | undefined>(undefined);
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [fundamentos, setFundamentos] = useState<Fundamentos | null>(null);
  const [ventas, setVentas] = useState<Ventas | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [director, setDirector] = useState<Director | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => { setOrg(orgActiva()); }, []);

  const cargar = useCallback(async (o: string) => {
    setCargando(true);
    setNegocio(null); setFundamentos(null); setVentas(null); setCatalogo(null); setPanel(null); setDirector(null); setPlan(null);
    const h = cabecerasOrg(o);
    const get = async <T,>(url: string): Promise<T | null> => {
      try { const r = await fetch(url, { cache: 'no-store', headers: h }); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
    };
    const neg = await get<Negocio>('/api/plataforma/negocio');
    setNegocio(neg);
    setFundamentos(await get<Fundamentos>('/api/plataforma/fundamentos'));
    if (neg?.modeloDeNegocio === 'SAAS_FUNNEL') {
      setPanel(await get<Panel>('/api/medicion/panel'));
      setDirector(await get<Director>('/api/medicion/lectura-director'));
      setPlan(await get<Plan>('/api/medicion/plan-accion'));
    } else {
      setVentas(await get<Ventas>('/api/plataforma/ventas'));
      setCatalogo(await get<Catalogo>('/api/plataforma/catalogo'));
    }
    setCargando(false);
  }, []);

  useEffect(() => { if (org) void cargar(org); }, [org, cargar]);

  if (org === undefined) return <div className="dash panel"><p className="lede">Cargando…</p></div>;
  if (org === null)
    return (
      <div className="dash panel">
        <PageHeader eyebrow="Panel" title="Elegí una empresa" />
        <EmptyState ico="◔" titulo="Todavía no elegiste ninguna empresa" detalle="SOEC nunca elige por vos: los datos de una empresa jamás se muestran en el panel de otra.">
          <p style={{ marginTop: 14 }}><Link className="btn primary" href="/">Ver mis empresas →</Link></p>
        </EmptyState>
      </div>
    );

  const esEcom = negocio?.modeloDeNegocio !== 'SAAS_FUNNEL';
  // El veredicto relevante depende del modelo: en SaaS manda el Director de campañas (medición);
  // en e-commerce, el evaluador de fundamentos del negocio.
  const veredictoCrudo = esEcom ? fundamentos?.veredicto : director?.veredicto ?? fundamentos?.veredicto;
  const ver = veredictoCrudo
    ? VEREDICTO_HUMANO[veredictoCrudo] ?? { texto: veredictoCrudo, tono: 'mut' as Tono }
    : null;
  const prioridades = esEcom
    ? (fundamentos?.motivos ?? []).slice(0, 4).map((m) => ({ t: PRIORIDAD_TITULO[m.codigo] ?? m.explicacion, s: m.resuelveCon }))
    : saasPrioridades(panel, plan);
  const puedeRecomendar = fundamentos?.puedeRecomendarInversionPublicitaria ?? false;

  return (
    <div className="dash panel">
      <PageHeader
        eyebrow={esEcom ? 'Panel · e-commerce' : 'Panel · software (SaaS)'}
        title={negocio?.displayName ?? 'Panel del negocio'}
        right={ver ? <Badge tono={ver.tono}>{ver.texto}</Badge> : undefined}
      />
      {negocio && (
        <p className="lede">
          {esEcom ? 'Tienda WooCommerce' : 'Captación de clientes con Google Ads'} · {negocio.mercado}
          {negocio.categoriasDeclaradas.length > 0 && <> · {negocio.categoriasDeclaradas.join(' · ')}</>}
        </p>
      )}

      {cargando && !negocio && <div className="card"><p className="muted">Cargando el panel de este negocio…</p></div>}

      {/* ── HOY: cifras del día ──────────────────────────────────────────── */}
      {esEcom && ventas?.observado && ventas.lineaBase && (
        <>
          <div className="section">Hoy <span className="hint">lo que SOEC ve en tu tienda</span></div>
          <div className="grid g-4">
            <Metric ico="🧾" label="Pedidos confirmados" value={num(ventas.lineaBase.pedidos)} sub={`${ventas.lineaBase.pedidosConEvidenciaDePago} con pago confirmado`} accent />
            <Metric ico="💰" label="Facturación confirmada" value={valor(ventas.lineaBase.ingresoConfirmado, clp)} sub="pagos confirmados, neto de reembolsos" accent />
            <Metric ico="🎯" label="Ticket promedio" value={valor(ventas.lineaBase.ticketPromedio, clp)} sub={`mediana ${valor(ventas.lineaBase.medianaTicket, clp)}`} />
            <Metric ico="📦" label="Productos con ventas" value={num(ventas.lineaBase.productosConVentasObservadas)} sub={catalogo?.resumen ? `de ${num(catalogo.resumen.productosObservados)} en el catálogo` : undefined} />
          </div>
        </>
      )}
      {!esEcom && panel?.ads && (
        <>
          <div className="section">Hoy <span className="hint">lo que SOEC ve en tus campañas</span></div>
          <div className="grid g-4">
            <Metric ico="👁" label="Impresiones" value={num(panel.ads.impressions)} sub="veces que se mostró tu anuncio" accent />
            <Metric ico="🖱" label="Clics" value={num(panel.ads.clicks)} sub={`${(panel.ads.ctr * 100).toFixed(1)}% de quienes lo vieron`} />
            <Metric ico="💸" label="Inversión" value={clp(panel.ads.cost)} sub={`${clp(panel.ads.cpc)} por clic`} />
            <Metric ico="🌱" label="Clientes nuevos" value={num(panel.growthFunnel?.comercial?.lead_created ?? 0)} sub="contactos reales desde el sitio" accent />
          </div>
        </>
      )}

      {/* ── SOEC DICE + prioridades ──────────────────────────────────────── */}
      {ver && (
        <div className="grid g-main" style={{ marginTop: 22 }}>
          <DirectorCard
            estado={<Badge tono={ver.tono}>{ver.texto}</Badge>}
            dice={frase(esEcom, ventas, panel, puedeRecomendar)}
            extra={
              puedeRecomendar ? (
                <Badge tono="ok">Listo para recomendar inversión</Badge>
              ) : (
                <span className="s">
                  {esEcom
                    ? 'Todavía no puedo recomendar gastar en publicidad: me faltan datos.'
                    : 'Sigo en modo seguro: no cambio tu campaña sin tu aprobación.'}
                </span>
              )
            }
          />
          <div className="card">
            <div className="section" style={{ margin: '0 0 12px' }}>Qué conviene hacer</div>
            {prioridades.length > 0 ? (
              <PriorityList items={prioridades} />
            ) : (
              <p className="s">Sin acciones pendientes por ahora.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Tu atención ──────────────────────────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
        <Callout tono="ok" ico="✓">
          <b>No necesitás decidir nada ahora.</b> SOEC está en modo seguro: observa y te avisará aquí
          cuando haya algo real que aprobar. Nada se publica ni se gasta sin tu confirmación.
        </Callout>
      </div>

      {/* ══════════════ E-COMMERCE (C Y P) ══════════════ */}
      {esEcom && ventas?.observado && ventas.lineaBase && (
        <>
          <div className="section">Ventas <span className="hint">observadas en WooCommerce</span></div>
          <div className="grid g-main">
            <div className="card">
              <div className="spread" style={{ marginBottom: 10 }}>
                <b>Facturación por mes</b>
                <span className="small muted">
                  {ventas.lineaBase.fechaMin?.slice(0, 10)} → {ventas.lineaBase.fechaMax?.slice(0, 10)}
                </span>
              </div>
              <TrendBars format={clp} data={[...ventas.lineaBase.porMes].sort((a, b) => a.clave.localeCompare(b.clave)).map((m) => ({ label: mesCorto(m.clave), value: m.ingreso }))} />
            </div>
            <div className="card">
              <div className="section" style={{ margin: '0 0 10px' }}>La verdad de tus ingresos</div>
              <div className="stack">
                <div className="spread"><span className="s">Facturación confirmada</span><b>{valor(ventas.lineaBase.ingresoConfirmado, clp)}</b></div>
                <div className="spread"><span className="s">Reembolsos</span><b>{valor(ventas.lineaBase.reembolsosConfirmados, clp)}</b></div>
                <div className="spread"><span className="s muted">Valor bruto observado</span><span className="muted">{valor(ventas.lineaBase.ingresoObservadoEnLaFuente, clp)}</span></div>
                <div className="spread"><span className="s">Unidades vendidas</span><b>{num(ventas.lineaBase.unidadesVendidas)}</b></div>
              </div>
              <Callout tono="info" ico="ℹ" >
                «Confirmada» cuenta solo pedidos pagados. El «valor bruto» es todo lo que pasó por la
                tienda: no es lo mismo.
              </Callout>
            </div>
          </div>

          <div className="section">Productos</div>
          <div className="grid g-3">
            <div className="card">
              <div className="section" style={{ margin: '0 0 10px' }}>Más venden (por ingresos)</div>
              <ol className="stack" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {ventas.lineaBase.porProducto.filter((p) => p.clave !== '(desconocido)').slice(0, 5).map((p) => (
                  <li key={p.clave}><code>#{p.clave}</code> — <b>{clp(p.ingreso)}</b> <span className="muted">({p.unidades} u.)</span></li>
                ))}
              </ol>
            </div>
            <div className="card">
              <div className="section" style={{ margin: '0 0 10px' }}>Más venden (por unidades)</div>
              <ol className="stack" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {[...ventas.lineaBase.porProducto].filter((p) => p.clave !== '(desconocido)').sort((a, b) => b.unidades - a.unidades).slice(0, 5).map((p) => (
                  <li key={p.clave}><code>#{p.clave}</code> — <b>{p.unidades} u.</b> <span className="muted">({clp(p.ingreso)})</span></li>
                ))}
              </ol>
            </div>
            <div className="card">
              <div className="section" style={{ margin: '0 0 10px' }}>Cobertura del catálogo</div>
              {ventas.productos?.catalogoObservado ? (
                <div className="stack">
                  <div className="spread"><span className="s">Con ventas observadas</span><b>{num(ventas.productos.conVentasObservadas)}</b></div>
                  <div className="spread"><span className="s">Sin ventas en la ventana</span><b>{num(ventas.productos.sinVentasObservadas)}</b></div>
                  <div className="track"><i style={{ width: `${((ventas.productos.conVentasObservadas ?? 0) / (ventas.productos.catalogoObservado || 1)) * 100}%` }} /></div>
                  <p className="small muted" style={{ margin: 0 }}>«Sin ventas observadas» no es «sin ventas»: es sin ventas en este período y esta tienda.</p>
                </div>
              ) : <p className="s muted">Catálogo aún no cruzado.</p>}
            </div>
          </div>
        </>
      )}
      {esEcom && ventas && !ventas.observado && (
        <div style={{ marginTop: 18 }}>
          <EmptyState ico="🧾" titulo="Todavía no hay ventas observadas" detalle="No es que no haya ventas: es que SOEC aún no puede leerlas de la tienda." />
        </div>
      )}

      {/* ══════════════ SAAS (SmileFlow) ══════════════ */}
      {!esEcom && panel?.ads && (
        <>
          <div className="section">Cómo va la captación <span className="hint">del anuncio al cliente</span></div>
          <div className="grid g-main">
            <div className="card">
              <div className="section" style={{ margin: '0 0 12px' }}>Tu embudo de clientes</div>
              <Funnel steps={[
                { label: 'Vieron tu anuncio', value: panel.ads.impressions },
                { label: 'Hicieron clic', value: panel.ads.clicks },
                { label: 'Pidieron demo', value: panel.growthFunnel?.comercial?.demo_cta_clicked ?? 0 },
                { label: 'Empezaron el formulario', value: panel.growthFunnel?.comercial?.demo_form_started ?? 0 },
                { label: 'Se volvieron clientes', value: panel.growthFunnel?.comercial?.lead_created ?? 0 },
              ]} />
            </div>
            <div className="card">
              <div className="section" style={{ margin: '0 0 10px' }}>Búsquedas que te muestran</div>
              <div className="stack" style={{ fontSize: 13.5 }}>
                {(panel.searchTerms ?? []).slice(0, 5).map((t) => (
                  <div className="spread" key={t.termino}>
                    <span className="s">{t.termino}</span>
                    <span className="muted">{t.impresiones} vistas · {t.clics} clics</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {plan?.oportunidadesTacticas && plan.oportunidadesTacticas.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Callout tono="warn" ico="💡">
                <b>Oportunidad:</b> hay {plan.oportunidadesTacticas.length} búsqueda(s) que muestran tu
                anuncio pero nadie hace clic (por ejemplo «{plan.oportunidadesTacticas[0]!.termino}»).
                SOEC no las excluye —siguen siendo relevantes— y sugiere <b>revisar el mensaje del anuncio</b>.
              </Callout>
            </div>
          )}
        </>
      )}

      {/* ── Fuentes ──────────────────────────────────────────────────────── */}
      {negocio && (
        <>
          <div className="section">De dónde saca SOEC los datos</div>
          <div className="card">
            {negocio.fuentes.map((f) => {
              const e = ETIQUETA_ESTADO_FUENTE[f.estado] ?? { texto: f.estado, cls: 'mut' };
              return (
                <SourceRow
                  key={f.sourceId}
                  ico={ICO_FUENTE[f.tipo] ?? '◆'}
                  nombre={TIPO_FUENTE[f.tipo] ?? f.tipo}
                  estado={{ texto: e.texto, tono: (e.cls as Tono) }}
                  falta={f.faltantes.length > 0 ? f.faltantes.join(' · ') : undefined}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ── Lo que SOEC todavía no puede saber ───────────────────────────── */}
      {esEcom && ventas?.lineaBase && (
        <>
          <div className="section">Lo que SOEC todavía no puede saber</div>
          <div className="card">
            <div className="grid g-2">
              <NoSabe k="Margen de cada venta" v="faltan tus costos" />
              <NoSabe k="Ganancia real" v="depende del margen" />
              <NoSabe k="Cuánto cuesta traer un cliente" v="falta medición web" />
              <NoSabe k="Ventas fuera de la tienda (WhatsApp, mostrador)" v="sin instrumentar" />
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>Ninguno de estos es «cero»: es «todavía no medido». Por eso SOEC no recomienda gastar en publicidad aún.</p>
          </div>
        </>
      )}

      {/* ── Detalles técnicos (jerga colapsada) ──────────────────────────── */}
      <div style={{ marginTop: 20 }}>
        <TechDetails>
          organización: {org} · modelo: {negocio?.modeloDeNegocio ?? '—'} · veredicto Director: {fundamentos?.veredicto ?? director?.veredicto ?? '—'} ·
          modo: AUTONOMOUS_REAL = false (sin cambios reales) · fuente de ventas: {esEcom ? 'woocommerce-rest-api (solo lectura)' : 'google-ads + growth (solo lectura)'}
        </TechDetails>
      </div>

      {negocio && negocio.datosHumanosPendientes.length > 0 && (
        <>
          <div className="section">Lo que SOEC necesita de vos</div>
          <div className="card">
            <ul className="stack" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              {negocio.datosHumanosPendientes.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function NoSabe(props: { k: string; v: string }): React.ReactElement {
  return (
    <div className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
      <span className="s">{props.k}</span>
      <Badge tono="mut">{props.v}</Badge>
    </div>
  );
}

const TIPO_FUENTE: Record<string, string> = {
  WEBSITE: 'Sitio web', ECOMMERCE: 'Tienda online', ADS: 'Google Ads', ANALYTICS: 'Medición web (GA4)',
  MERCHANT: 'Google Shopping', SALES: 'Ventas', CATALOG: 'Catálogo', CRM: 'Clientes', PAYMENTS: 'Medios de pago',
  SHIPPING: 'Despacho', GROWTH: 'Eventos del sitio', MESSAGING: 'WhatsApp', SOCIAL: 'Redes sociales', TAG_MANAGER: 'Etiquetas del sitio',
};
const ICO_FUENTE: Record<string, string> = {
  WEBSITE: '🌐', ECOMMERCE: '🛒', ADS: '📣', ANALYTICS: '📊', MERCHANT: '🏷', SALES: '🧾', CATALOG: '📦',
  CRM: '👥', PAYMENTS: '💳', SHIPPING: '🚚', GROWTH: '✨', MESSAGING: '💬', SOCIAL: '📱', TAG_MANAGER: '🔖',
};

/** Prioridades honestas para un negocio SaaS, derivadas de la evidencia real (no del evaluador e-commerce). */
function saasPrioridades(panel: Panel | null, plan: Plan | null): { t: string; s?: string }[] {
  const out: { t: string; s?: string }[] = [];
  const leads = panel?.growthFunnel?.comercial?.lead_created ?? 0;
  const clicks = panel?.ads?.clicks ?? 0;
  if (clicks > 0 && leads === 0)
    out.push({ t: 'Revisar el mensaje del anuncio y la página de destino', s: 'llega tráfico pero todavía no se convierte en clientes' });
  if (plan?.oportunidadesTacticas && plan.oportunidadesTacticas.length > 0)
    out.push({ t: 'Revisar los anuncios de las búsquedas que no reciben clic', s: `por ejemplo «${plan.oportunidadesTacticas[0]!.termino}»` });
  out.push({ t: 'Medir las conversiones del sitio', s: 'para saber qué anuncios traen clientes reales, no solo visitas' });
  return out;
}

/** Frase HUMANA de SOEC, compuesta de la evidencia real del negocio. */
function frase(esEcom: boolean, ventas: Ventas | null, panel: Panel | null, puedeRecomendar: boolean): string {
  if (esEcom) {
    const lb = ventas?.lineaBase;
    const base = lb
      ? `Ya conozco tus ventas y tu catálogo: vendiste ${valor(lb.ingresoConfirmado, clp)} en ${num(lb.pedidos)} pedidos.`
      : 'Todavía estoy conociendo tu tienda.';
    return puedeRecomendar
      ? `${base} Con esto ya puedo ayudarte a decidir dónde invertir.`
      : `${base} Todavía no puedo recomendarte publicidad porque no conozco tu margen ni tengo medición web instalada.`;
  }
  const a = panel?.ads;
  if (a && a.clicks > 0 && (panel?.growthFunnel?.comercial?.lead_created ?? 0) === 0)
    return `El tráfico está llegando (${num(a.impressions)} personas vieron tu anuncio y ${num(a.clicks)} hicieron clic), pero todavía no se convierte en clientes. Antes de tocar la campaña, conviene revisar el mensaje.`;
  if (a) return `Estoy observando tu campaña: ${num(a.impressions)} impresiones y ${num(a.clicks)} clics. Reúno evidencia antes de proponer cambios.`;
  return 'Todavía estoy reuniendo datos de tus campañas.';
}
