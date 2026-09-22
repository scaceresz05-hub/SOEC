'use client';

/**
 * PLAN DE MARKETING del negocio activo.
 *
 * Es lo que SOEC PROPONE hacer con lo que investigó: dónde invertir, con qué estructura, con qué búsquedas, con
 * cuánto y por qué. Es un BORRADOR: esta pantalla no publica campañas ni autoriza gasto, y lo dice.
 *
 * Reglas de esta pantalla:
 *  · cada decisión viene con su porqué y con los datos observados en los que se apoya — nunca «lo recomienda la IA»;
 *  · el presupuesto distingue lo que el dueño puso como techo de lo que el mercado permitiría; nada se inventa;
 *  · lo que falta para poder publicar se muestra en primer plano, no escondido al final.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { orgActiva } from '../../../lib/org-activa';
import {
  ETIQUETA_DIMENSION,
  NOMBRE_CANAL,
  generarPlan,
  leerPlan,
  type VistaPlan,
} from '../../../lib/investigacion-client';

const ESTADO_PLAN: Record<string, string> = {
  DRAFT: 'borrador',
  NON_EXECUTABLE: 'borrador · todavía no publicable',
  STALE: 'quedó viejo',
  SUPERSEDED: 'reemplazado por una versión más nueva',
};

const CONCORDANCIA: Record<string, string> = {
  EXACT: 'solo esa búsqueda',
  PHRASE: 'esa frase y variantes cercanas',
  BROAD: 'búsquedas relacionadas',
};

const CREATIVO: Record<string, string> = {
  RSA_REQUIRED: 'hay que escribir los textos de los anuncios (títulos y descripciones)',
  IMAGE_ASSETS_REQUIRED: 'hacen falta imágenes de tu negocio',
  VIDEO_REQUIRED: 'hace falta un video',
  EXISTING_ASSETS_SUFFICIENT: 'con lo que ya tienes alcanza',
};

const CONVERSION: Record<string, string> = {
  CONVERSION_SETUP_REQUIRED: 'falta dejar registrado cuándo un visitante se convierte en cliente',
  CONVERSION_TRACKING_UNVERIFIED: 'el registro de clientes existe pero no está comprobado',
  CONVERSION_READY: 'el registro de clientes está listo y comprobado',
};

const PUJA: Record<string, string> = {
  MAXIMIZE_CLICKS_WITH_CPC_CEILING: 'conseguir el máximo de visitas, con un tope por visita',
  MAXIMIZE_CONVERSIONS: 'conseguir el máximo de clientes',
  MANUAL_CPC: 'precio por visita fijado a mano',
};

const ESTRUCTURA: Record<string, string> = {
  UNA_CAMPANA_VARIOS_GRUPOS: 'una sola campaña con varios grupos de búsquedas',
  CAMPANA_POR_OFERTA: 'una campaña por servicio',
};

const clp = (v: number | null | undefined): string =>
  v === null || v === undefined ? 'sin definir' : `$${Math.round(v).toLocaleString('es-CL')}`;
const fecha = (v: string | null): string => (v === null ? '—' : new Date(v).toLocaleString());
const seccion = { marginBottom: 32 } as const;
const titulo = { fontSize: 18, marginBottom: 8 } as const;
const apagado = { color: 'var(--muted, #666)' } as const;

export default function PlanPage() {
  const [org, setOrg] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setOrg(orgActiva());
  }, []);

  const cargar = useCallback(async (o: string) => {
    try {
      setVista(await leerPlan(o));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo leer el plan');
    }
  }, []);

  useEffect(() => {
    if (org !== null) void cargar(org);
  }, [org, cargar]);

  async function generar(): Promise<void> {
    if (org === null) return;
    setOcupado(true);
    setError(null);
    try {
      setVista(await generarPlan(org));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'el plan no se pudo preparar');
    } finally {
      setOcupado(false);
    }
  }

  if (org === null) {
    return (
      <main className="wrap" style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px' }}>
        <h1>Plan de marketing</h1>
        <p>Primero elige una empresa en <Link href="/negocios">tu panel</Link>.</p>
      </main>
    );
  }

  const plan = vista?.plan ?? null;
  const pendientes = plan === null
    ? []
    : Object.entries(plan.readiness).filter(([dim, ok]) => ok === false && dim !== 'EXECUTION_READY');

  return (
    <main className="wrap" style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/negocios">← Volver al panel</Link>
        <Link href="/negocios/investigacion">Investigación de mercado →</Link>
        <Link href="/negocios/campana">Preparar campaña →</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Plan de marketing</h1>
      <p style={{ ...apagado, marginBottom: 24 }}>
        Esto es una propuesta en borrador, hecha con lo que SOEC observó de tu mercado. Nada de aquí está publicado:
        ninguna campaña existe, ningún peso se ha gastado.
      </p>

      {error !== null && <p role="alert" style={{ color: '#b00020', marginBottom: 16 }}>{error}</p>}

      <section style={seccion}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <button type="button" onClick={() => void generar()} disabled={ocupado || vista?.puedeGenerar.puede === false}>
            {ocupado ? 'Preparando…' : plan === null ? 'Preparar mi plan' : 'Rehacer el plan con lo último investigado'}
          </button>
        </div>
        {vista?.puedeGenerar.puede === false && (
          <p style={{ color: '#b58900' }}>
            {vista.puedeGenerar.motivo}. Empieza por <Link href="/negocios/investigacion">investigar tu mercado</Link>.
          </p>
        )}
        {plan === null && vista?.puedeGenerar.puede === true && (
          <p style={apagado}>Todavía no hay un plan preparado para este negocio.</p>
        )}
      </section>

      {plan !== null && (
        <>
          <section style={seccion}>
            <h2 style={titulo}>Qué propone SOEC</h2>
            <p style={{ marginBottom: 8 }}>
              Versión {plan.version} · <strong>{ESTADO_PLAN[plan.estado] ?? plan.estado}</strong> · preparado el {fecha(plan.creadoEn)}
            </p>
            {plan.motivoStale !== null && (
              <p style={{ color: '#b58900', marginBottom: 8 }}>
                Este plan quedó viejo: {plan.motivoStale}. Vuelve a prepararlo antes de usarlo para decidir.
              </p>
            )}
            <ul style={{ paddingLeft: 18 }}>
              <li>Dónde: <strong>{NOMBRE_CANAL[plan.canal] ?? plan.canal}</strong></li>
              <li>Para conseguir: {plan.objetivo}</li>
              <li>Qué se promociona: {plan.ofertas.length > 0 ? plan.ofertas.join(', ') : 'sin servicios prioritarios definidos'}</li>
              <li>Cómo se organiza: {ESTRUCTURA[plan.estructura.tipo] ?? plan.estructura.tipo} — {plan.estructura.justificacion}</li>
              <li>Cómo se compran las visitas: {PUJA[plan.puja.estrategia] ?? plan.puja.estrategia}
                {plan.puja.techoCpcClp !== null ? `, hasta ${clp(plan.puja.techoCpcClp)} por visita` : ''} — {plan.puja.justificacion}</li>
              <li>
                Dónde se mostraría:{' '}
                {plan.geografia.targets.length > 0
                  ? plan.geografia.targets.map((t) => t.nombre).join(', ')
                  : 'ningún territorio confirmado todavía'}
              </li>
            </ul>
            {plan.geografia.noEjecutables.length > 0 && (
              <p style={{ color: '#b58900', marginTop: 8 }}>
                Queda fuera por ahora: {plan.geografia.noEjecutables.join(', ')} — hay que acordar cómo
                representar ese territorio antes de invertir ahí.
              </p>
            )}
            {plan.geografia.aproximaciones.length > 0 && (
              <p style={{ marginTop: 8 }}>
                Se segmenta de forma aproximada: {plan.geografia.aproximaciones.join(', ')}. Puede haber gente de
                fuera viendo tus anuncios.
              </p>
            )}
          </section>

          <section style={seccion}>
            <h2 style={titulo}>Cuánto propone invertir</h2>
            <ul style={{ paddingLeft: 18 }}>
              <li>Tu tope declarado: <strong>{clp(plan.presupuesto.techoDeclaradoClp)}</strong>
                {plan.presupuesto.modalidadTecho !== null ? ` (${plan.presupuesto.modalidadTecho === 'MENSUAL' ? 'al mes' : 'al día'})` : ''}</li>
              <li>Lo que este plan propone gastar por día: <strong>{clp(plan.presupuesto.propuestoDiarioClp)}</strong></li>
              <li>Lo que costaría atender toda la demanda observada: {clp(plan.presupuesto.oportunidadDiariaClp)}
                <span style={apagado}> (es una estimación de lo que existe, no una recomendación)</span></li>
              <li>Costo estimado por visita: {clp(plan.presupuesto.costoPorClicEstimadoClp)}</li>
            </ul>
            <p style={{ marginTop: 8 }}>{plan.presupuesto.explicacion}</p>
            <p style={{ color: '#b58900', marginTop: 8 }}>
              Guardar un presupuesto no activa nada. Para que SOEC pueda gastar hace falta una autorización
              explícita de una persona, y este plan no la incluye.
            </p>
          </section>

          <section style={seccion}>
            <h2 style={titulo}>Qué falta antes de publicar</h2>
            {plan.readiness.EXECUTION_READY === true ? (
              <p>Según el plan no falta nada técnico, pero publicar sigue siendo una decisión de una persona.</p>
            ) : (
              <p style={{ marginBottom: 8 }}>
                Hoy este plan <strong>no se puede publicar</strong>. Esto es lo que falta:
              </p>
            )}
            <ul style={{ paddingLeft: 18 }}>
              {plan.prerequisitos.map((p) => <li key={p}>{p}</li>)}
              <li>{CONVERSION[plan.requisitoConversion] ?? plan.requisitoConversion}</li>
              {plan.requisitosCreativos.map((r) => <li key={r}>{CREATIVO[r] ?? r}</li>)}
            </ul>
            {pendientes.length > 0 && (
              <p style={{ ...apagado, marginTop: 8 }}>
                Pendiente por área: {pendientes.map(([d]) => (ETIQUETA_DIMENSION[d] ?? d).toLowerCase()).join(', ')}.
              </p>
            )}
          </section>

          {vista !== null && vista.grupos.length > 0 && (
            <section style={seccion}>
              <h2 style={titulo}>Las búsquedas por las que competir</h2>
              {vista.grupos.map((g) => (
                <div key={g.id} style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 16, marginBottom: 4 }}>{g.nombre}</h3>
                  <p style={{ ...apagado, marginBottom: 6 }}>
                    {g.justificacion}
                    {g.landing !== null ? ` · lleva a ${g.landing}` : ' · todavía sin página de destino'}
                  </p>
                  <ul style={{ paddingLeft: 18, marginBottom: 6 }}>
                    {g.palabras.map((p) => (
                      <li key={p.termino}>
                        <strong>{p.termino}</strong> — {CONCORDANCIA[p.concordancia] ?? p.concordancia}
                        {p.volumenMensual !== null ? `, ${p.volumenMensual.toLocaleString()} búsquedas al mes` : ''}
                        <span style={{ ...apagado, fontSize: 13 }}> · {p.justificacion}</span>
                      </li>
                    ))}
                  </ul>
                  {g.negativas.length > 0 && (
                    <p style={{ fontSize: 14 }}>
                      Se dejarían fuera: {g.negativas.map((n) => n.termino).join(', ')}.
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}

          <section style={seccion}>
            <h2 style={titulo}>Por qué SOEC propone esto</h2>
            <p style={{ ...apagado, marginBottom: 8 }}>
              Cada decisión sale de datos observados, no de una opinión. Aquí está el razonamiento completo.
            </p>
            <ul style={{ paddingLeft: 18 }}>
              {plan.explicacion.map((e) => (
                <li key={e.decision} style={{ marginBottom: 6 }}>
                  <strong>{e.decision}</strong>: {e.porque}
                  {e.evidenciaIds.length > 0 && (
                    <span style={{ ...apagado, fontSize: 13 }}>
                      {' '}(sobre {e.evidenciaIds.length} dato{e.evidenciaIds.length === 1 ? '' : 's'} observado{e.evidenciaIds.length === 1 ? '' : 's'} en la investigación)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {vista !== null && vista.historial.length > 1 && (
            <section style={seccion}>
              <h2 style={titulo}>Planes anteriores</h2>
              <ul style={{ paddingLeft: 18, fontSize: 14 }}>
                {vista.historial.map((h) => (
                  <li key={h.id}>
                    Versión {h.version} · {ESTADO_PLAN[h.estado] ?? h.estado} · {fecha(h.creadoEn)}
                  </li>
                ))}
              </ul>
              <p style={apagado}>Nada se borra: lo que se propuso antes sigue consultable.</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
