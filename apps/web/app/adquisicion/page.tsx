'use client';

/**
 * Panel MARKETING / ADQUISICIÓN — vista ejecutiva de sólo lectura (SHADOW).
 *
 * Consume la superficie /api/adquisicion/* del backend, tenant-scoped por la organización activa.
 * Reglas de honestidad: un canal «no conectado» se muestra como estado, NUNCA como 0; no hay botón
 * de publicar ni de crear campaña; Meta aparece «No conectado» y la escritura, desactivada.
 */
import { useCallback, useEffect, useState } from 'react';
import { cabecerasOrg, orgActiva } from '../../lib/org-activa';

interface ResumenAdq {
  organizationId: string;
  objetivo: string;
  foundation: string;
  canalesDisponibles: number;
  canalesConectados: number;
  medicionEvaluable: boolean;
  estrategiaState: string;
  blockers: string[];
}
interface CanalVista {
  canal: string;
  provider: string;
  status: string;
  naturaleza: string;
  readCapability: boolean;
  writeCapability: boolean;
}
interface EstadoMeta {
  read: string;
  write: string;
  accountBinding: string;
  graphCalls: number;
}
interface Estrategia {
  objetivo: string;
  veredicto: string;
  razones: string[];
  naturaleza: string;
}
interface OutcomesResp {
  outcomes: { outcome: string; disponibilidad: string; n: number | null }[];
  economia: { indicadores: { nombre: string; valor: number | null; motivo: string }[] };
}

const ETIQUETA_CANAL: Record<string, { texto: string; tono: string }> = {
  NOT_CONFIGURED: { texto: 'No conectado', tono: '#9a6b00' },
  CREDENTIALS_REQUIRED: { texto: 'Requiere credenciales', tono: '#9a6b00' },
  CONNECTED_READ_ONLY: { texto: 'Conectado (solo lectura)', tono: '#1f7a4d' },
  CONNECTED_WRITE_DISABLED: { texto: 'Conectado · escritura desactivada', tono: '#1f7a4d' },
  SHADOW_READY: { texto: 'Listo para shadow', tono: '#1f7a4d' },
  REAL_READY: { texto: 'Listo (real)', tono: '#1f7a4d' },
  PAUSED: { texto: 'Pausado', tono: '#9a6b00' },
  ERROR: { texto: 'Error', tono: '#a33' },
};

const NOMBRE_CANAL: Record<string, string> = {
  GOOGLE_SEARCH: 'Google Search',
  META_FACEBOOK: 'Facebook (Ads)',
  META_INSTAGRAM: 'Instagram (Ads)',
  ORGANIC_FACEBOOK: 'Facebook orgánico',
  ORGANIC_INSTAGRAM: 'Instagram orgánico',
  WEBSITE: 'Sitio web',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
};

function label(estado: string): { texto: string; tono: string } {
  return ETIQUETA_CANAL[estado] ?? { texto: estado, tono: '#666' };
}

export default function AdquisicionPage() {
  const [org, setOrg] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ResumenAdq | null>(null);
  const [canales, setCanales] = useState<CanalVista[]>([]);
  const [meta, setMeta] = useState<EstadoMeta | null>(null);
  const [estrategia, setEstrategia] = useState<Estrategia | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomesResp | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    setOrg(orgActiva());
  }, []);

  const cargar = useCallback(async (o: string) => {
    setCargando(true);
    const h = cabecerasOrg(o);
    const get = async <T,>(recurso: string): Promise<T | null> => {
      try {
        const r = await fetch(`/api/adquisicion/${recurso}`, { cache: 'no-store', headers: h });
        return r.ok ? ((await r.json()) as T) : null;
      } catch {
        return null;
      }
    };
    setResumen(await get<ResumenAdq>('summary'));
    const ch = await get<{ canales: CanalVista[]; meta: EstadoMeta }>('channels');
    setCanales(ch?.canales ?? []);
    setMeta(ch?.meta ?? null);
    setEstrategia(await get<Estrategia>('strategy'));
    setOutcomes(await get<OutcomesResp>('outcomes'));
    setCargando(false);
  }, []);

  useEffect(() => {
    if (org) void cargar(org);
  }, [org, cargar]);

  if (!org) {
    return (
      <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
        <h1>Marketing / Adquisición</h1>
        <p>Elegí una empresa arriba para ver su estado de adquisición.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <h1>Marketing / Adquisición</h1>
      <p style={{ color: '#666', marginTop: -8 }}>
        Vista de sólo lectura (SHADOW). SOEC no publica ni crea campañas en esta etapa.
      </p>
      {cargando && <p>Cargando…</p>}

      {resumen && (
        <section style={{ marginTop: 20 }}>
          <h2>Objetivo</h2>
          <p style={{ fontSize: 18 }}>
            <b>{resumen.objetivo}</b> · estrategia: <b>{resumen.estrategiaState}</b>
          </p>
          <p style={{ color: '#666' }}>
            Medición evaluable: {resumen.medicionEvaluable ? 'sí' : 'no'} · canales conectados:{' '}
            {resumen.canalesConectados}/{resumen.canalesDisponibles}
          </p>
        </section>
      )}

      <section style={{ marginTop: 20 }}>
        <h2>Canales</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#888' }}>
              <th style={{ padding: '6px 4px' }}>Canal</th>
              <th>Naturaleza</th>
              <th>Estado</th>
              <th>Lectura</th>
              <th>Escritura</th>
            </tr>
          </thead>
          <tbody>
            {canales.map((c) => {
              const l = label(c.status);
              return (
                <tr key={c.canal} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '6px 4px' }}>{NOMBRE_CANAL[c.canal] ?? c.canal}</td>
                  <td>{c.naturaleza === 'PAID' ? 'Pagado' : 'Orgánico'}</td>
                  <td style={{ color: l.tono, fontWeight: 600 }}>{l.texto}</td>
                  <td>{c.readCapability ? 'Sí' : '—'}</td>
                  <td>Desactivada</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {meta && (
          <p style={{ color: '#666', marginTop: 8 }}>
            Meta: lectura <b>{label(meta.read).texto}</b> · escritura <b>desactivada</b> · llamadas a la Graph API:{' '}
            {meta.graphCalls}
          </p>
        )}
      </section>

      {estrategia && (
        <section style={{ marginTop: 20 }}>
          <h2>Estrategia de SOEC</h2>
          <p>
            Veredicto: <b>{estrategia.veredicto}</b> ({estrategia.naturaleza})
          </p>
          <ul>
            {estrategia.razones.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: 20 }}>
        <h2>Contenido</h2>
        <p style={{ color: '#666' }}>Aún no hay contenido preparado.</p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2>Campañas</h2>
        <p style={{ color: '#666' }}>Meta no conectado — campañas: No conectado. (No hay publicación ni creación real.)</p>
      </section>

      {outcomes && (
        <section style={{ marginTop: 20 }}>
          <h2>Resultados</h2>
          <ul>
            {outcomes.outcomes.map((o) => (
              <li key={o.outcome}>
                {o.outcome}: {o.disponibilidad === 'NOT_AVAILABLE' ? 'aún no medible' : (o.n ?? '—')}
              </li>
            ))}
          </ul>
          <p style={{ color: '#666' }}>
            Economía:{' '}
            {outcomes.economia.indicadores
              .map((i) => `${i.nombre}=${i.valor === null ? 'desconocido' : i.valor}`)
              .join(' · ')}
          </p>
        </section>
      )}

      {resumen && resumen.blockers.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h2>Qué falta</h2>
          <ul>
            {resumen.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
