/**
 * SOEC · Componentes de UI compartidos del panel de dirección.
 *
 * Presentacionales y sin estado (sirven en Server o Client). El lenguaje es HUMANO: nada de enums
 * técnicos, siglas de motor ni jerga. La jerga vive, si acaso, dentro de <TechDetails>.
 */
import type { ReactNode } from 'react';

/* ── Formato ─────────────────────────────────────────────────────────────── */
export function clp(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `$${Math.round(n).toLocaleString('es-CL')}`;
}
export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('es-CL');
}
/** Valor que puede ser legítimamente desconocido. La UI NUNCA lo dibuja como 0. */
export interface Desconocible {
  conocido: boolean;
  valor: number | null;
  motivo?: string;
}
export function valor(v: Desconocible | undefined, fmt: (n: number) => string = num): string {
  if (!v || !v.conocido || v.valor === null) return 'desconocido';
  return fmt(v.valor);
}

/* ── Iniciales / color estable por negocio ───────────────────────────────── */
const PALETA = ['#9A6E28', '#2C5E8A', '#2F7D57', '#7A4E9A', '#B0413A', '#1F7A7A'];
export function colorDeNegocio(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length]!;
}
export function iniciales(nombre: string): string {
  const p = nombre.replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '·';
}

/* ── PageHeader ──────────────────────────────────────────────────────────── */
export function PageHeader(props: {
  eyebrow?: string;
  title: string;
  right?: ReactNode;
}): React.ReactElement {
  return (
    <div className="pagehead">
      <div>
        {props.eyebrow && <p className="eyebrow">{props.eyebrow}</p>}
        <h1 className="big">{props.title}</h1>
      </div>
      {props.right && <div className="row-wrap">{props.right}</div>}
    </div>
  );
}

/* ── StatusBadge ─────────────────────────────────────────────────────────── */
export type Tono = 'ok' | 'warn' | 'risk' | 'info' | 'mut';
export function Badge(props: { tono: Tono; children: ReactNode }): React.ReactElement {
  return (
    <span className={`badge ${props.tono}`}>
      <span className="bdot" aria-hidden="true" />
      {props.children}
    </span>
  );
}

/* ── MetricCard ──────────────────────────────────────────────────────────── */
export function Metric(props: {
  label: string;
  value: string;
  sub?: string;
  ico?: string;
  unknown?: boolean;
  accent?: boolean;
}): React.ReactElement {
  return (
    <div className={`metric${props.accent ? ' accent' : ''}`}>
      <span className="mlabel">
        {props.ico && <span aria-hidden="true">{props.ico}</span>}
        {props.label}
      </span>
      <span className={`mnum${props.unknown ? ' unknown' : ''}`}>{props.value}</span>
      {props.sub && <span className="msub">{props.sub}</span>}
    </div>
  );
}

/* ── DirectorCard: la VOZ de SOEC en primera persona ─────────────────────── */
export function DirectorCard(props: {
  estado: ReactNode; // badge de estado ya traducido
  dice: string; // frase en lenguaje humano
  extra?: ReactNode;
}): React.ReactElement {
  return (
    <div className="director">
      <div className="dhead">
        <div className="dav" aria-hidden="true">S</div>
        <div className="dwho">
          SOEC, tu director
          <small>Lo que veo en este negocio ahora</small>
        </div>
        <div style={{ marginLeft: 'auto' }}>{props.estado}</div>
      </div>
      <p className="says">“{props.dice}”</p>
      {props.extra && <div className="dfoot">{props.extra}</div>}
    </div>
  );
}

/* ── Callout ─────────────────────────────────────────────────────────────── */
export function Callout(props: {
  tono?: 'info' | 'warn' | 'ok';
  ico?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className={`callout ${props.tono ?? 'info'}`}>
      <span className="cico" aria-hidden="true">{props.ico ?? 'ℹ'}</span>
      <div>{props.children}</div>
    </div>
  );
}

/* ── PriorityList ────────────────────────────────────────────────────────── */
export function PriorityList(props: {
  items: { t: string; s?: string }[];
}): React.ReactElement {
  return (
    <div className="prio">
      {props.items.map((it, i) => (
        <div className="pit" key={i}>
          <span className="pn" aria-hidden="true">{i + 1}</span>
          <div>
            <div className="pt">{it.t}</div>
            {it.s && <div className="ps">{it.s}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── TrendBars: barras simples (evolución) ───────────────────────────────── */
export function TrendBars(props: {
  data: { label: string; value: number; hint?: string }[];
  format?: (n: number) => string;
}): React.ReactElement {
  const max = Math.max(1, ...props.data.map((d) => d.value));
  const fmt = props.format ?? num;
  return (
    <div className="bars">
      {props.data.map((d, i) => (
        <div className="bar" key={i} title={`${d.label}: ${fmt(d.value)}`}>
          <span className="barval">{fmt(d.value)}</span>
          <i style={{ height: `${Math.max(3, (d.value / max) * 100)}%` }} />
          <span>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Funnel: embudo por pasos ────────────────────────────────────────────── */
export function Funnel(props: {
  steps: { label: string; value: number }[];
}): React.ReactElement {
  const max = Math.max(1, ...props.steps.map((s) => s.value));
  return (
    <div className="funnel">
      {props.steps.map((s, i) => (
        <div className="fstep" key={i}>
          <span className="flabel">{s.label}</span>
          <div className="ftrack">
            <i style={{ width: `${Math.max(2, (s.value / max) * 100)}%` }} />
          </div>
          <span className="fval">{num(s.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── SourceRow: estado de una fuente de datos ────────────────────────────── */
export function SourceRow(props: {
  ico: string;
  nombre: string;
  estado: { texto: string; tono: Tono };
  falta?: string;
}): React.ReactElement {
  return (
    <div className="srcrow">
      <span className="sico" aria-hidden="true">{props.ico}</span>
      <div>
        <div className="st">{props.nombre}</div>
        {props.falta && <div className="ss">Falta: {props.falta}</div>}
      </div>
      <Badge tono={props.estado.tono}>{props.estado.texto}</Badge>
    </div>
  );
}

/* ── EmptyState ──────────────────────────────────────────────────────────── */
export function EmptyState(props: {
  ico?: string;
  titulo: string;
  detalle?: string;
  children?: ReactNode;
}): React.ReactElement {
  return (
    <div className="empty">
      <div className="eico" aria-hidden="true">{props.ico ?? '◔'}</div>
      <div className="et">{props.titulo}</div>
      {props.detalle && <p className="es">{props.detalle}</p>}
      {props.children}
    </div>
  );
}

/* ── TechDetails: la jerga técnica, colapsada y fuera del flujo normal ────── */
export function TechDetails(props: {
  titulo?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <details className="tech">
      <summary>{props.titulo ?? 'Detalles técnicos'}</summary>
      <div className="techbody">{props.children}</div>
    </details>
  );
}
