'use client';

/**
 * PANEL DEL NEGOCIO · workspace unificado con secciones por CAPACIDADES del negocio.
 *
 * Una sola experiencia para todas las empresas; las secciones visibles se derivan del MODELO del
 * negocio (e-commerce vs software/SaaS), no de su identidad. Todo en lenguaje humano; la jerga vive
 * en «Detalles técnicos». Los datos de una empresa jamás se mezclan con los de otra.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { cabecerasOrg, ETIQUETA_ESTADO_FUENTE, orgActiva } from '../../lib/org-activa';
import { estadoAds, lineaObjetivoAds } from '../../lib/ads-estado';
import {
  Badge, Callout, clp, colorDeNegocio, DirectorCard, EmptyState, Funnel, iniciales, Metric, num,
  PriorityList, SourceRow, TechDetails, TrendBars, valor, type Desconocible, type Tono,
} from '../../components/ui';

/* ── Tipos de vista ──────────────────────────────────────────────────────── */
interface FuenteVista { sourceId: string; tipo: string; proveedor: string; estado: string; faltantes: string[] }
interface Negocio {
  displayName: string; legalName: string; rut: string | null; modeloDeNegocio: string; mercado: string;
  estado: string; categoriasDeclaradas: string[]; fuentes: FuenteVista[]; datosHumanosPendientes: string[];
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
  mediosDePago: { clave: string; n: number }[]; margenBruto: Desconocible; beneficio: Desconocible; cac: Desconocible; roas: Desconocible;
}
interface ProductosCruce { catalogoObservado?: number; conVentasObservadas?: number; sinVentasObservadas?: number; vendidosFueraDelCatalogo?: number }
interface Ventas { observado: boolean; motivo?: string; lineaBase?: LineaBase; productos?: ProductosCruce }
interface Catalogo { observado: boolean; resumen?: { productosObservados: number; categoriasObservadas: number; enStock: number; sinStock: number } }
interface Panel {
  // Alineado con el backend (panel-resultados): métricas nullable + sinDatos + trazabilidad. NUNCA se asume 0.
  ads?: {
    source: 'GOOGLE_ADS'; impressions: number | null; clicks: number | null; cost: number | null; ctr: number | null; cpc: number | null;
    sinDatos: boolean; capturedAt: string | null; period: { kind: 'ALL_TIME'; from: string | null; to: string | null } | null; stale: boolean;
  };
  growthFunnel?: { comercial?: Record<string, number>; diagnostico?: Record<string, number> };
  searchTerms?: { termino: string; impresiones: number; clics: number }[];
  // Estado del último refresh REAL a Google Ads (visibilidad del intento/fallo, p.ej. OAuth caducado).
  adsRefresh?: { queriedAt: string; ok: boolean; estado: string; ventana: { desde: string; hasta: string }; error: string | null; dataThrough: string | null } | null;
  googleAdsConfigured?: boolean;
}
/** Fuente publicitaria de este panel SaaS: Google Ads (solo lectura). Etiqueta única de origen. */
const FUENTE_ADS = 'Google Ads';
/** ¿No hay datos de Google Ads (no conectado / sin entrega)? Nunca convertimos no-data en 0. */
function adsVacio(p: Panel | null): boolean {
  return !p?.ads || p.ads.sinDatos === true || (p.ads.impressions === null && p.ads.clicks === null && p.ads.cost === null);
}
/** Fecha absoluta humana (es-CL) — ej "16 ago 2026, 00:24". Nunca ISO crudo. */
function fechaAbs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function soloFecha(iso: string | null): string {
  if (!iso) return '—';
  // start_date de Google Ads viene como 'YYYY-MM-DD'; lo formateamos sin zona.
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
}
function haceRel(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dd = Math.floor(h / 24);
  return `hace ${dd} día${dd === 1 ? '' : 's'}`;
}
/** Línea de trazabilidad del bloque Google Ads: fuente + período real (all-time) + capturedAt/STALE + intento. */
function LineaAds({ ads, refresh }: { ads: NonNullable<Panel['ads']>; refresh?: Panel['adsRefresh'] }): React.ReactElement {
  const rango = ads.period?.from ? `desde ${soloFecha(ads.period.from)}` : 'acumulado histórico';
  const al = ads.period?.to ?? ads.capturedAt;
  return (
    <div style={{ margin: '4px 0 0' }}>
      <p className="s" style={{ margin: 0, color: ads.stale ? 'var(--warn)' : undefined }}>
        {FUENTE_ADS} · {rango} al {soloFecha(al)}
        {ads.stale
          ? <> · <b>Último dato conocido: {fechaAbs(ads.capturedAt)}</b> · desactualizado</>
          : <> · Actualizado {fechaAbs(ads.capturedAt)}{haceRel(ads.capturedAt) ? ` (${haceRel(ads.capturedAt)})` : ''}</>}
      </p>
      {refresh && (
        <p className="s" style={{ margin: '2px 0 0', color: refresh.ok ? undefined : 'var(--warn)' }}>
          Consultado a {FUENTE_ADS}: {fechaAbs(refresh.queriedAt)}
          {refresh.ok
            ? <> · datos hasta {soloFecha(refresh.dataThrough)}</>
            : <> · <b>no se pudo actualizar</b>{refresh.error ? ` (${refresh.error})` : ''}</>}
        </p>
      )}
    </div>
  );
}
interface Director { veredicto?: string }
interface Plan { oportunidadesTacticas?: { termino: string; accion: string }[] }
interface Bandeja { items?: unknown[] }

type TabId = 'inicio' | 'ventas' | 'productos' | 'marketing' | 'contactos' | 'objetivos' | 'decisiones' | 'porque' | 'fuentes';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesCorto = (c: string): string => `${MESES[Number(c.slice(5, 7)) - 1] ?? c} ${c.slice(2, 4)}`;

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
const TIPO_FUENTE: Record<string, string> = {
  WEBSITE: 'Sitio web', ECOMMERCE: 'Tienda online', ADS: 'Google Ads', ANALYTICS: 'Medición web (GA4)',
  MERCHANT: 'Google Shopping', SALES: 'Ventas', CATALOG: 'Catálogo', CRM: 'Clientes', PAYMENTS: 'Medios de pago',
  SHIPPING: 'Despacho', GROWTH: 'Eventos del sitio', MESSAGING: 'WhatsApp', SOCIAL: 'Redes sociales', TAG_MANAGER: 'Etiquetas del sitio',
};
const ICO_FUENTE: Record<string, string> = {
  WEBSITE: '🌐', ECOMMERCE: '🛒', ADS: '📣', ANALYTICS: '📊', MERCHANT: '🏷', SALES: '🧾', CATALOG: '📦',
  CRM: '👥', PAYMENTS: '💳', SHIPPING: '🚚', GROWTH: '✨', MESSAGING: '💬', SOCIAL: '📱', TAG_MANAGER: '🔖',
};

export default function Panel(): React.ReactElement {
  const [org, setOrg] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<TabId>('inicio');
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [fundamentos, setFundamentos] = useState<Fundamentos | null>(null);
  const [ventas, setVentas] = useState<Ventas | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [director, setDirector] = useState<Director | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [bandeja, setBandeja] = useState<Bandeja | null>(null);
  const [cargando, setCargando] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [avisoRefresh, setAvisoRefresh] = useState<string | null>(null);

  useEffect(() => { setOrg(orgActiva()); }, []);

  const cargar = useCallback(async (o: string) => {
    setCargando(true);
    setNegocio(null); setFundamentos(null); setVentas(null); setCatalogo(null); setPanel(null); setDirector(null); setPlan(null); setBandeja(null);
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
      setBandeja(await get<Bandeja>('/api/medicion/g2a-bandeja'));
    } else {
      setVentas(await get<Ventas>('/api/plataforma/ventas'));
      setCatalogo(await get<Catalogo>('/api/plataforma/catalogo'));
    }
    setCargando(false);
  }, []);

  // "Actualizar": dispara un refresh REAL de Google Ads (read-only) y luego re-lee el panel. Hace visible el
  // resultado del intento (éxito, "sin novedades", o fallo de autorización). NO fabrica frescura.
  const actualizar = useCallback(async (o: string) => {
    setRefrescando(true); setAvisoRefresh(null);
    try {
      const r = await fetch('/api/medicion/refresh-ads', { method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasOrg(o) }, body: '{}' });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; estado?: string; error?: string | null; nuevos?: number };
      if (j.estado === 'NOT_CONFIGURED') setAvisoRefresh('Google Ads no está conectado para este negocio.');
      else if (j.ok) setAvisoRefresh(`Consultado a Google Ads recién${j.nuevos ? ` · ${j.nuevos} dato(s) nuevo(s)` : ' · sin novedades'}.`);
      else setAvisoRefresh(`Consultamos a Google Ads recién, pero no se pudo actualizar: ${j.error ?? 'error de Google Ads'}. Se muestra el último dato conocido.`);
    } catch {
      setAvisoRefresh('No se pudo contactar el servicio para actualizar.');
    } finally {
      setRefrescando(false);
      await cargar(o); // re-lee el panel (nuevo snapshot si lo hubo, o el mismo con el intento registrado)
    }
  }, [cargar]);

  useEffect(() => { if (org) void cargar(org); }, [org, cargar]);

  // E-commerce SÓLO si el modelo es explícitamente de tienda. Antes defaulteaba a e-commerce cuando el
  // negocio aún no cargaba (negocio=null) o el modelo era desconocido, lo que pintaba pestañas de tienda
  // (Ventas/Productos/Google Shopping) a negocios SaaS o mientras cargaba ⇒ superficies en blanco/fantasma.
  const esEcom = negocio?.modeloDeNegocio === 'ECOMMERCE_DISTRIBUCION';
  const tabsBandeja = useMemo(() => (Array.isArray(bandeja?.items) ? bandeja!.items!.length : 0), [bandeja]);

  const tabs: { id: TabId; label: string; count?: number }[] = useMemo(() => {
    const comunes: { id: TabId; label: string; count?: number }[] = [
      { id: 'objetivos', label: 'Objetivos' },
      { id: 'decisiones', label: 'Decisiones', count: tabsBandeja || undefined },
      { id: 'porque', label: 'Por qué' },
      { id: 'fuentes', label: 'Preparación' },
    ];
    if (esEcom) return [{ id: 'inicio', label: 'Inicio' }, { id: 'ventas', label: 'Ventas' }, { id: 'productos', label: 'Productos' }, { id: 'marketing', label: 'Marketing' }, ...comunes];
    return [{ id: 'inicio', label: 'Inicio' }, { id: 'marketing', label: 'Marketing' }, { id: 'contactos', label: 'Contactos' }, ...comunes];
  }, [esEcom, tabsBandeja]);

  if (org === undefined) return <div className="dash panel"><p className="lede">Cargando…</p></div>;
  if (org === null)
    return (
      <div className="dash panel">
        <EmptyState ico="◔" titulo="Todavía no elegiste ninguna empresa" detalle="SOEC nunca elige por vos: los datos de una empresa jamás se muestran en el panel de otra.">
          <p style={{ marginTop: 14 }}><Link className="btn primary" href="/">Ver mis empresas →</Link></p>
        </EmptyState>
      </div>
    );

  const veredictoCrudo = esEcom ? fundamentos?.veredicto : director?.veredicto ?? fundamentos?.veredicto;
  const ver = veredictoCrudo ? VEREDICTO_HUMANO[veredictoCrudo] ?? { texto: veredictoCrudo, tono: 'mut' as Tono } : null;
  const puedeRecomendar = fundamentos?.puedeRecomendarInversionPublicitaria ?? false;
  const prioridades = esEcom
    ? (fundamentos?.motivos ?? []).slice(0, 4).map((m) => ({ t: PRIORIDAD_TITULO[m.codigo] ?? m.explicacion, s: m.resuelveCon }))
    : saasPrioridades(panel, plan);

  // Estado de Google Ads separado: CONEXIÓN (estado de la fuente en el registro — lo que muestra Preparación)
  // vs DATOS (hay cifras reales en el event-store). "Conectado sin datos" ≠ "no conectado". Una sola verdad
  // reutilizada en Marketing/Inicio/Objetivos/Por qué para no contradecir a Preparación.
  const adsFuente = negocio?.fuentes?.find((f) => f.proveedor === 'google-ads' || f.tipo === 'ADS');
  const eAds = estadoAds(adsFuente?.estado, adsVacio(panel));
  const adsConectado = eAds.conectado;
  const adsConDatos = eAds.conDatos;

  return (
    <div className="dash panel">
      {/* ── Header de negocio ─────────────────────────────────────────────── */}
      {negocio ? (
        <div className="bizhead">
          <span className="bhav" style={{ background: colorDeNegocio(org) }} aria-hidden="true">{iniciales(negocio.displayName)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="bhname">{negocio.displayName}</div>
            <div className="bhkind">{esEcom ? 'E-commerce / distribución' : 'Software dental (SaaS)'} · {negocio.mercado}</div>
          </div>
          <div className="bhright" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {ver && <><span className="small muted">Estado SOEC:</span> <Badge tono={ver.tono}>{ver.texto}</Badge></>}
            <button className="btn" disabled={cargando || refrescando} onClick={() => org && actualizar(org)}>{refrescando ? 'Actualizando…' : 'Actualizar'}</button>
          </div>
        </div>
      ) : (
        <div className="bizhead"><div className="bhname">Panel del negocio</div></div>
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="tabs" role="tablist" aria-label="Secciones del negocio">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
            {t.label}{t.count ? <span className="tcount">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {cargando && !negocio && <div className="card"><p className="muted">Cargando el panel de este negocio…</p></div>}

      {avisoRefresh && <Callout tono={avisoRefresh.includes('no se pudo') || avisoRefresh.includes('no está conectado') ? 'warn' : 'ok'} ico={avisoRefresh.includes('no se pudo') || avisoRefresh.includes('no está conectado') ? '⚠' : '✓'}>{avisoRefresh}</Callout>}

      {/* ══════════════ INICIO ══════════════ */}
      {tab === 'inicio' && (
        <>
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
          {!esEcom && panel && (
            <>
              <div className="section">Publicidad <span className="hint">{FUENTE_ADS} · histórico de la campaña</span></div>
              {adsVacio(panel) ? (
                <Callout tono="info" ico="🔌">
                  {adsConectado
                    ? <><b>{FUENTE_ADS} conectado</b>, pero todavía no hay datos de campañas disponibles. No mostramos cifras que no provengan de una fuente real.</>
                    : <><b>{FUENTE_ADS} todavía no está conectado</b> para este negocio. No mostramos cifras que no provengan de una fuente real.</>}
                </Callout>
              ) : (
                <>
                  <div className="grid g-4">
                    <Metric ico="👁" label="Impresiones" value={num(panel.ads!.impressions)} sub={FUENTE_ADS} accent />
                    <Metric ico="🖱" label="Clics" value={num(panel.ads!.clicks)} sub={panel.ads!.ctr !== null ? `${(panel.ads!.ctr * 100).toFixed(1)}% de quienes lo vieron` : FUENTE_ADS} />
                    <Metric ico="💸" label="Inversión" value={clp(panel.ads!.cost)} sub={panel.ads!.cpc !== null ? `${clp(panel.ads!.cpc)} por clic` : FUENTE_ADS} />
                  </div>
                  <LineaAds ads={panel.ads!} refresh={panel.adsRefresh} />
                </>
              )}
              <div className="grid g-4" style={{ marginTop: 12 }}>
                <Metric ico="🌱" label="Clientes nuevos" value={num(panel.growthFunnel?.comercial?.lead_created ?? null)} sub="contactos reales desde el sitio · medición web" accent />
              </div>
            </>
          )}

          {ver && (
            <div className="grid g-main" style={{ marginTop: 22 }}>
              <DirectorCard
                estado={<Badge tono={ver.tono}>{ver.texto}</Badge>}
                dice={frase(esEcom, ventas, panel, puedeRecomendar)}
                extra={puedeRecomendar
                  ? <Badge tono="ok">Listo para recomendar inversión</Badge>
                  : <span className="s">{esEcom ? 'Todavía no puedo recomendar gastar en publicidad: me faltan datos.' : 'Sigo en modo seguro: no cambio tu campaña sin tu aprobación.'}</span>}
              />
              <div className="card">
                <div className="section" style={{ margin: '0 0 12px' }}>Qué conviene hacer</div>
                {prioridades.length > 0 ? <PriorityList items={prioridades} /> : <p className="s">Sin acciones pendientes por ahora.</p>}
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Callout tono="ok" ico="✓">
              <b>No necesitás decidir nada ahora.</b> SOEC está en modo seguro: observa y te avisará en
              «Decisiones» cuando haya algo real que aprobar. Nada se publica ni se gasta sin tu confirmación.
            </Callout>
          </div>
        </>
      )}

      {/* ══════════════ VENTAS (e-commerce) ══════════════ */}
      {tab === 'ventas' && esEcom && (
        ventas?.observado && ventas.lineaBase ? (
          <>
            <div className="section">Ventas <span className="hint">observadas en tu tienda</span></div>
            <div className="grid g-main">
              <div className="card">
                <div className="spread" style={{ marginBottom: 10 }}>
                  <b>Facturación por mes</b>
                  <span className="small muted">{ventas.lineaBase.fechaMin?.slice(0, 10)} → {ventas.lineaBase.fechaMax?.slice(0, 10)}</span>
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
                <Callout tono="info" ico="ℹ">«Confirmada» cuenta solo pedidos pagados. El «bruto» es todo lo que pasó por la tienda: no es lo mismo.</Callout>
              </div>
            </div>
            <div className="grid g-2">
              <div className="card">
                <div className="section" style={{ margin: '0 0 10px' }}>Dónde vendés</div>
                <div className="stack">
                  {ventas.lineaBase.porRegion.map((r) => (
                    <div className="spread" key={r.clave}><span className="s">{r.clave}</span><span><b>{clp(r.ingreso)}</b> <span className="muted">· {r.pedidos} pedidos</span></span></div>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="section" style={{ margin: '0 0 10px' }}>Cómo te pagan</div>
                <div className="stack">
                  {ventas.lineaBase.mediosDePago.map((m) => (
                    <div className="spread" key={m.clave}><span className="s">{m.clave}</span><b>{m.n} pedidos</b></div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : <EmptyState ico="🧾" titulo="Todavía no hay ventas observadas" detalle="No es que no haya ventas: es que SOEC aún no puede leerlas de la tienda." />
      )}

      {/* ══════════════ PRODUCTOS (e-commerce) ══════════════ */}
      {tab === 'productos' && esEcom && !ventas?.lineaBase && (
        <EmptyState ico="📦" titulo="Todavía no hay productos observados" detalle="No es que no haya productos: es que SOEC aún no puede leer las ventas por producto de la tienda." />
      )}
      {tab === 'productos' && esEcom && ventas?.lineaBase && (
        <>
          <div className="section">Productos</div>
          <div className="grid g-3">
            <div className="card">
              <div className="section" style={{ margin: '0 0 10px' }}>Más venden (por ingresos)</div>
              <ol className="stack" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {ventas.lineaBase.porProducto.filter((p) => p.clave !== '(desconocido)').slice(0, 6).map((p) => (
                  <li key={p.clave}><code>#{p.clave}</code> — <b>{clp(p.ingreso)}</b> <span className="muted">({p.unidades} u.)</span></li>
                ))}
              </ol>
            </div>
            <div className="card">
              <div className="section" style={{ margin: '0 0 10px' }}>Más venden (por unidades)</div>
              <ol className="stack" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {[...ventas.lineaBase.porProducto].filter((p) => p.clave !== '(desconocido)').sort((a, b) => b.unidades - a.unidades).slice(0, 6).map((p) => (
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
          {catalogo?.resumen && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="spread"><span className="s"><b>{num(catalogo.resumen.productosObservados)}</b> productos en el catálogo · <b>{num(catalogo.resumen.categoriasObservadas)}</b> categorías</span>
                <span className="muted small">{catalogo.resumen.enStock} en stock · {catalogo.resumen.sinStock} sin stock</span></div>
            </div>
          )}
        </>
      )}

      {/* ══════════════ MARKETING ══════════════ */}
      {tab === 'marketing' && (
        !esEcom && panel ? (
          <>
            <div className="section">Marketing pagado <span className="hint">{FUENTE_ADS} · histórico de la campaña · solo lectura</span></div>
            {adsVacio(panel) ? (
              <Callout tono="info" ico="🔌">
                {adsConectado
                  ? <><b>{FUENTE_ADS} conectado</b>, pero todavía no hay datos de campañas disponibles. Sin cifras sintéticas ni de otra fuente.</>
                  : <><b>{FUENTE_ADS} todavía no está conectado.</b> Sin cifras sintéticas ni de otra fuente.</>}
              </Callout>
            ) : (
            <>
            <div className="grid g-4">
              <Metric ico="👁" label="Impresiones" value={num(panel.ads!.impressions)} sub={FUENTE_ADS} />
              <Metric ico="🖱" label="Clics" value={num(panel.ads!.clicks)} sub={panel.ads!.ctr !== null ? `${(panel.ads!.ctr * 100).toFixed(1)}% CTR` : FUENTE_ADS} />
              <Metric ico="💸" label="Inversión" value={clp(panel.ads!.cost)} sub={FUENTE_ADS} />
              <Metric ico="🏷" label="Costo por clic" value={clp(panel.ads!.cpc)} />
            </div>
            <LineaAds ads={panel.ads!} refresh={panel.adsRefresh} />
            </>
            )}
            <div className="section">Búsquedas que te muestran</div>
            <div className="card">
              <div className="stack">
                {(panel.searchTerms ?? []).slice(0, 8).map((t) => (
                  <div className="spread" key={t.termino}><span className="s">{t.termino}</span><span className="muted">{t.impresiones} vistas · {t.clics} clics</span></div>
                ))}
              </div>
            </div>
            {plan?.oportunidadesTacticas && plan.oportunidadesTacticas.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <Callout tono="warn" ico="💡"><b>Oportunidad:</b> «{plan.oportunidadesTacticas[0]!.termino}» muestra tu anuncio pero no recibe clics. No la excluyo (sigue siendo relevante): conviene revisar el mensaje del anuncio. Ver el razonamiento en «Por qué».</Callout>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="section">Marketing</div>
            <EmptyState ico="📣" titulo="El marketing pagado todavía no está conectado" detalle="Cuando conectes Google Ads (y la medición web), aquí verás tráfico, costo y resultados de tus campañas. No hay ceros que mostrar: simplemente aún no hay de dónde leer.">
              <div className="grid g-3" style={{ marginTop: 16, textAlign: 'left' }}>
                <SourceEmpty ico="📣" nombre="Google Ads" estado={adsConectado ? 'Conectado · sin datos aún' : 'No conectado'} />
                <SourceEmpty ico="📊" nombre="Medición web (GA4)" estado="No configurado" />
                {/* Google Shopping es un concepto de tienda: sólo aplica a e-commerce, no a un negocio SaaS/servicios. */}
                {esEcom && <SourceEmpty ico="🏷" nombre="Google Shopping" estado="No conectado" />}
              </div>
            </EmptyState>
          </>
        )
      )}

      {/* ══════════════ CONTACTOS (SaaS) ══════════════ */}
      {tab === 'contactos' && !esEcom && panel && (
        <>
          <div className="section">Del anuncio al cliente <span className="hint">tu embudo</span></div>
          {adsVacio(panel) && <Callout tono="info" ico="🔌"><b>{FUENTE_ADS} sin datos</b> — el tramo de anuncios no se muestra. Abajo, los contactos reales medidos en el sitio.</Callout>}
          <div className="card">
            <Funnel steps={[
              ...(adsVacio(panel) ? [] : [
                { label: `Vieron tu anuncio (${FUENTE_ADS})`, value: panel.ads!.impressions ?? 0 },
                { label: 'Hicieron clic', value: panel.ads!.clicks ?? 0 },
              ]),
              { label: 'Pidieron demo', value: panel.growthFunnel?.comercial?.demo_cta_clicked ?? 0 },
              { label: 'Empezaron el formulario', value: panel.growthFunnel?.comercial?.demo_form_started ?? 0 },
              { label: 'Se volvieron clientes', value: panel.growthFunnel?.comercial?.lead_created ?? 0 },
            ]} />
          </div>
          <Callout tono="info" ico="ℹ">SOEC separa los <b>clientes reales</b> de las pruebas internas del sitio: aquí solo cuentan los contactos reales, no los de test.</Callout>
        </>
      )}
      {tab === 'contactos' && !esEcom && !panel && (
        <EmptyState ico="👥" titulo="Todavía no hay contactos para mostrar" detalle="Cuando una persona solicite una demo o deje sus datos en tu sitio, aparecerá aquí. Aún no hay contactos reales medidos." />
      )}

      {/* ══════════════ OBJETIVOS ══════════════ */}
      {tab === 'objetivos' && (
        esEcom ? (
          <>
            <div className="section">Objetivo del negocio</div>
            <div className="card">
              <p style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>Prioridad actual: preparar el negocio para crecer de forma medible</p>
              <p className="s" style={{ marginTop: 0 }}>Todavía no fijamos metas de publicidad: sería inventarlas sin datos. Primero, los cimientos.</p>
              <div style={{ marginTop: 12 }}>
                {[
                  { t: 'Catálogo conectado', done: 'done' as const },
                  { t: 'Ventas conectadas', done: 'done' as const },
                  { t: 'Medición web (GA4)', done: 'todo' as const },
                  { t: 'Costos y márgenes', done: 'todo' as const },
                  { t: 'Despacho nacional', done: 'partial' as const },
                  { t: 'Publicidad', done: 'todo' as const },
                ].map((c) => <CheckItem key={c.t} t={c.t} estado={c.done} />)}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="section">Objetivo del negocio</div>
            <div className="grid g-main">
              <div className="card">
                <p className="eyebrow">Objetivo principal</p>
                <p style={{ fontSize: 18, fontWeight: 750, margin: '2px 0 8px' }}>Conseguir clínicas interesadas</p>
                <p className="s"><b>Cómo lo medimos:</b> demos y contactos reales desde el sitio.</p>
                <p className="s"><b>Estado:</b> todavía no hay conversiones suficientes para sacar conclusiones.</p>
                <div className="section" style={{ margin: '14px 0 8px' }}>SOEC está haciendo</div>
                <div className="stack">
                  {(() => {
                    // Coherencia: cada afirmación deriva del estado REAL, separando CONEXIÓN de DATOS. Sólo se
                    // afirma "observando anuncios / revisando búsquedas" si Google Ads está conectado Y con datos.
                    const observandoAds = adsConectado && adsConDatos;
                    const midiendoWeb = !!panel?.growthFunnel?.comercial && Object.keys(panel.growthFunnel.comercial).length > 0;
                    const lineaAds = lineaObjetivoAds(eAds);
                    const items: { t: string; ok: boolean }[] = [
                      lineaAds,
                      ...(observandoAds ? [{ t: 'Revisando qué búsquedas te muestran', ok: true }] : []),
                      { t: midiendoWeb ? 'Midiendo los contactos reales del sitio' : 'La medición web todavía no está configurada', ok: midiendoWeb },
                      ...(midiendoWeb ? [{ t: 'Separando las pruebas internas de los clientes reales', ok: true }] : []),
                    ];
                    return items.map((it) => (
                      <div key={it.t} className="s"><span style={{ color: it.ok ? 'var(--ok)' : 'var(--mut)' }}>{it.ok ? '✓' : '○'}</span> {it.t}</div>
                    ));
                  })()}
                </div>
              </div>
              <div className="card">
                <div className="section" style={{ margin: '0 0 10px' }}>Indicadores</div>
                <div className="stack">
                  <div className="spread"><span className="s">Tráfico ({FUENTE_ADS})</span><b>{adsVacio(panel) ? 'sin datos' : num(panel?.ads?.impressions ?? null)}</b></div>
                  <div className="spread"><span className="s">Clics ({FUENTE_ADS})</span><b>{adsVacio(panel) ? 'sin datos' : num(panel?.ads?.clicks ?? null)}</b></div>
                  <div className="spread"><span className="s">Contactos reales (medición web)</span><b>{num(panel?.growthFunnel?.comercial?.lead_created ?? null)}</b></div>
                  <div className="spread"><span className="s">Costo por contacto</span><b>{(() => { const l = panel?.growthFunnel?.comercial?.lead_created ?? 0; const c = panel?.ads?.cost; return l > 0 && c != null ? clp(c / l) : 'aún sin contactos'; })()}</b></div>
                </div>
              </div>
            </div>
          </>
        )
      )}

      {/* ══════════════ DECISIONES ══════════════ */}
      {tab === 'decisiones' && (
        <>
          <div className="section">Necesita tu decisión</div>
          {tabsBandeja > 0 ? (
            <div className="card"><p className="s">Hay {tabsBandeja} cambio(s) preparados esperando tu aprobación. Revisalos con cuidado antes de autorizar.</p></div>
          ) : (
            <EmptyState ico="✓" titulo="No necesito que decidas nada ahora" detalle="Cuando SOEC prepare un cambio real (por ejemplo, ajustar una campaña), aparecerá aquí con su porqué, su beneficio y su riesgo, y botones para autorizar o rechazar." />
          )}
          {!esEcom && plan?.oportunidadesTacticas && plan.oportunidadesTacticas.length > 0 && (
            <>
              <div className="section">Para que lo sepas <span className="hint">oportunidades · no requieren decisión</span></div>
              {plan.oportunidadesTacticas.map((o) => (
                <div className="decisioncard info-lead" key={o.termino} style={{ marginBottom: 10 }}>
                  <div className="spread"><h3>Revisar el mensaje del anuncio para «{o.termino}»</h3><Badge tono="info">Oportunidad · no requiere decisión</Badge></div>
                  <p className="dwhy">Esta búsqueda muestra tu anuncio pero no recibe clics. No la excluyo —sigue siendo relevante—: conviene revisar si el mensaje responde a lo que la persona busca.</p>
                </div>
              ))}
            </>
          )}
          <div className="section">Historial</div>
          <div className="card"><p className="s muted" style={{ margin: 0 }}>Todavía no hay decisiones registradas. Cuando autorices o rechaces un cambio, quedará aquí con su fecha y su resultado.</p></div>
        </>
      )}

      {/* ══════════════ POR QUÉ ══════════════ */}
      {tab === 'porque' && (
        <>
          <div className="section">Cómo llegó SOEC a esta conclusión</div>
          {!esEcom ? (
            <div className="card">
              {(() => {
                const t = (panel?.searchTerms ?? []).find((x) => x.clics === 0 && x.impresiones >= 10) ?? panel?.searchTerms?.[0];
                if (t) return (
                  <>
                    <p className="s"><b>SOEC observó:</b> la búsqueda «{t.termino}» mostró tu anuncio {t.impresiones} veces y recibió {t.clics} clics.</p>
                    <p className="s"><b>Pero:</b> sigue siendo una búsqueda relevante (está relacionada con software dental de la competencia).</p>
                    <p className="s"><b>Conclusión:</b> no la excluí. El bajo rendimiento no es lo mismo que irrelevancia. Primero conviene revisar si el mensaje del anuncio responde a esa intención.</p>
                    {/* La regla técnica de search_terms sólo se muestra cuando REALMENTE hay términos que explicar. */}
                    <TechDetails titulo="Ver cómo llegué a esto (detalle técnico)">
                      regla: 0 clics + muestra suficiente ⇒ OPTIMIZAR_MENSAJE, nunca NEGATIVA salvo política de irrelevancia por-organización ·
                      una negativa exige evidencia de irrelevancia, no solo bajo CTR · fuente: search terms reales de Google Ads (solo lectura)
                    </TechDetails>
                  </>
                );
                return <p className="s muted">{!adsConectado
                  ? 'Google Ads aún no está conectado, así que todavía no hay búsquedas de dónde leer una conclusión.'
                  : 'Google Ads está conectado, pero aún no hay datos de búsquedas disponibles para explicar una conclusión.'}</p>;
              })()}
            </div>
          ) : (
            <div className="card">
              <p className="s"><b>SOEC observó:</b> ya conoce tus ventas ({ventas?.lineaBase ? valor(ventas.lineaBase.ingresoConfirmado, clp) : '—'} en {ventas?.lineaBase ? num(ventas.lineaBase.pedidos) : '—'} pedidos) y tu catálogo.</p>
              <p className="s"><b>Pero:</b> no conoce tu margen (faltan costos) ni tiene medición web instalada, así que no puede saber cuánto cuesta traer un cliente.</p>
              <p className="s"><b>Conclusión:</b> el negocio está en «faltan fundamentos». No recomienda invertir en publicidad hasta conectar medición y costos. Nada de esto es «cero»: es «todavía no medido».</p>
              <TechDetails titulo="Ver cómo llegué a esto (detalle técnico)">
                veredicto: {fundamentos?.veredicto ?? '—'} · cimientos presentes: {(fundamentos?.cimientosPresentes ?? []).join(' · ') || '—'} ·
                deuda: margen/CAC/ROAS = desconocido (no cero) · fuente de ventas: WooCommerce (solo lectura)
              </TechDetails>
            </div>
          )}
        </>
      )}

      {/* ══════════════ PREPARACIÓN (fuentes + checklist) ══════════════ */}
      {tab === 'fuentes' && negocio && (
        <>
          <div className="section">Preparación del negocio <span className="hint">de dónde saca SOEC los datos</span></div>
          <Callout tono="info" ico="ℹ">Una fuente «no conectada» no es un error ni un cero: es algo que todavía no configuraste. A medida que conectes fuentes, SOEC podrá decir más.</Callout>
          <div className="card" style={{ marginTop: 12 }}>
            {negocio.fuentes.map((f) => {
              const e = ETIQUETA_ESTADO_FUENTE[f.estado] ?? { texto: f.estado, cls: 'mut' };
              return <SourceRow key={f.sourceId} ico={ICO_FUENTE[f.tipo] ?? '◆'} nombre={TIPO_FUENTE[f.tipo] ?? f.tipo} estado={{ texto: e.texto, tono: e.cls as Tono }} falta={f.faltantes.length > 0 ? f.faltantes.join(' · ') : undefined} />;
            })}
          </div>
          {negocio.datosHumanosPendientes.length > 0 && (
            <>
              <div className="section">Lo que SOEC necesita de vos</div>
              <div className="card">
                <ul className="stack" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {negocio.datosHumanosPendientes.map((d) => <li key={d}>{d}</li>)}
                </ul>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── Auxiliares de presentación ──────────────────────────────────────────── */
function CheckItem(props: { t: string; estado: 'done' | 'todo' | 'partial' }): React.ReactElement {
  const mark = props.estado === 'done' ? '✓' : props.estado === 'partial' ? '◐' : '○';
  const sub = props.estado === 'done' ? 'listo' : props.estado === 'partial' ? 'parcial' : 'todavía no';
  return (
    <div className="check">
      <span className={`cmark ${props.estado}`} aria-hidden="true">{mark}</span>
      <div><div className="ct">{props.t}</div><div className="cs">{sub}</div></div>
    </div>
  );
}
function SourceEmpty(props: { ico: string; nombre: string; estado: string }): React.ReactElement {
  return (
    <div className="card pad-sm" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ fontSize: 18 }} aria-hidden="true">{props.ico}</span>
      <div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{props.nombre}</div><Badge tono="mut">{props.estado}</Badge></div>
    </div>
  );
}

function saasPrioridades(panel: Panel | null, plan: Plan | null): { t: string; s?: string }[] {
  const out: { t: string; s?: string }[] = [];
  const leads = panel?.growthFunnel?.comercial?.lead_created ?? 0;
  const clicks = panel?.ads?.clicks ?? 0;
  if (clicks > 0 && leads === 0) out.push({ t: 'Revisar el mensaje del anuncio y la página de destino', s: 'llega tráfico pero todavía no se convierte en clientes' });
  if (plan?.oportunidadesTacticas && plan.oportunidadesTacticas.length > 0) out.push({ t: 'Revisar los anuncios de las búsquedas que no reciben clic', s: `por ejemplo «${plan.oportunidadesTacticas[0]!.termino}»` });
  out.push({ t: 'Medir las conversiones del sitio', s: 'para saber qué anuncios traen clientes reales, no solo visitas' });
  return out;
}

function frase(esEcom: boolean, ventas: Ventas | null, panel: Panel | null, puedeRecomendar: boolean): string {
  if (esEcom) {
    const lb = ventas?.lineaBase;
    const base = lb ? `Ya conozco tus ventas y tu catálogo: vendiste ${valor(lb.ingresoConfirmado, clp)} en ${num(lb.pedidos)} pedidos.` : 'Todavía estoy conociendo tu tienda.';
    return puedeRecomendar ? `${base} Con esto ya puedo ayudarte a decidir dónde invertir.` : `${base} Todavía no puedo recomendarte publicidad porque no conozco tu margen ni tengo medición web instalada.`;
  }
  const a = panel?.ads;
  if (adsVacio(panel)) return `Aún no tengo datos de anuncios (${FUENTE_ADS} sin datos o no conectado). No invento cifras: observo tus contactos reales y te aviso cuando haya con qué decidir.`;
  if (a && (a.clicks ?? 0) > 0 && (panel?.growthFunnel?.comercial?.lead_created ?? 0) === 0)
    return `Tu campaña en ${FUENTE_ADS} está consiguiendo clics (${num(a.clicks)} de ${num(a.impressions)} personas que vieron el anuncio), pero todavía no genera contactos. No recomiendo aumentar el gasto hasta entender por qué.`;
  return `Estoy observando tu campaña en ${FUENTE_ADS}: ${num(a?.impressions ?? null)} impresiones y ${num(a?.clicks ?? null)} clics (histórico de la campaña). Reúno evidencia antes de proponer cambios.`;
}
