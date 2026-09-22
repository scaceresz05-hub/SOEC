'use client';

/**
 * PREPARAR CAMPAÑA — del plan aprobado a una campaña real, en pausa.
 *
 * Es la pantalla donde una persona ve EXACTAMENTE qué se va a crear en su cuenta, lo aprueba y lo crea. Tres
 * reglas de esta interfaz:
 *  · se aprueba un resumen COMERCIAL (cuenta, presupuesto, ubicaciones, palabras, anuncios), nunca un JSON;
 *  · lo que falta se enseña primero, con quién puede resolverlo;
 *  · la frase que no desaparece nunca: la campaña se crea pausada y no genera gasto.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { orgActiva } from '../../../lib/org-activa';
import {
  ETIQUETA_ESTADO_EJECUCION,
  ETIQUETA_MEDICION,
  TITULO_REQUISITO,
  actualizarMedicion,
  autorizarCampana,
  crearCampanaEnPausa,
  guardarMaterial,
  leerEjecucion,
  prepararCampana,
  prepararMedicion,
  reconciliarCampana,
  type VistaEjecucion,
} from '../../../lib/ejecucion-client';

const COLOR: Record<string, string> = { PASS: '#0a7', ACTION_REQUIRED: '#b58900', BLOCKED: '#b00020', NOT_APPLICABLE: '#666' };
const ICONO: Record<string, string> = { PASS: '✓', ACTION_REQUIRED: '•', BLOCKED: '✕', NOT_APPLICABLE: '–' };

const seccion = { marginBottom: 32 } as const;
const titulo = { fontSize: 18, marginBottom: 8 } as const;
const apagado = { color: 'var(--muted, #666)' } as const;
const campo = { width: '100%', padding: 8, marginBottom: 6 } as const;

export default function CampanaPage() {
  const [org, setOrg] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaEjecucion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [oferta, setOferta] = useState('');
  const [titulares, setTitulares] = useState('');
  const [descripciones, setDescripciones] = useState('');

  useEffect(() => {
    setOrg(orgActiva());
  }, []);

  const cargar = useCallback(async (o: string) => {
    try {
      const v = await leerEjecucion(o);
      setVista(v);
      setError(null);
      if (oferta === '') {
        const primera = v.resumen?.grupos[0]?.nombre ?? v.material[0]?.ofertaSlug ?? '';
        if (primera !== '') setOferta(v.material[0]?.ofertaSlug ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo leer el estado de la campaña');
    }
  }, [oferta]);

  useEffect(() => {
    if (org !== null) void cargar(org);
  }, [org, cargar]);

  async function accion(fn: () => Promise<VistaEjecucion>, mensaje?: string): Promise<void> {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      setVista(await fn());
      if (mensaje) setAviso(mensaje);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'la operación no se completó');
    } finally {
      setOcupado(false);
    }
  }

  if (org === null) {
    return (
      <main className="wrap" style={{ maxWidth: 860, margin: '0 auto', padding: '32px 16px' }}>
        <h1>Preparar campaña</h1>
        <p>Primero elige una empresa en <Link href="/negocios">tu panel</Link>.</p>
      </main>
    );
  }

  const peticion = vista?.peticion ?? null;
  const resumen = vista?.resumen ?? null;
  const creada = peticion?.estado === 'CREATED_PAUSED';
  const pendientes = (vista?.prerrequisitos ?? []).filter((r) => r.veredicto !== 'PASS' && r.veredicto !== 'NOT_APPLICABLE');

  return (
    <main className="wrap" style={{ maxWidth: 860, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/negocios">← Volver al panel</Link>
        <Link href="/negocios/plan">Plan de marketing</Link>
        <Link href="/negocios/investigacion">Investigación</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>Preparar campaña</h1>
      <p style={{ ...apagado, marginBottom: 8 }}>
        Aquí SOEC crea de verdad la campaña en tu cuenta de Google, con lo que aprobaste en el plan.
      </p>
      <p style={{ padding: '10px 12px', background: 'rgba(0,170,119,.08)', border: '1px solid rgba(0,170,119,.35)', borderRadius: 6, marginBottom: 24 }}>
        <strong>La campaña se creará pausada y no generará gasto.</strong> Encenderla es una decisión aparte, que
        hoy SOEC no puede tomar por ti.
      </p>

      {error !== null && <p role="alert" style={{ color: '#b00020', marginBottom: 16 }}>{error}</p>}
      {aviso !== null && <p style={{ color: '#0a7', marginBottom: 16 }}>{aviso}</p>}

      {/* ── 1. ANUNCIOS ── */}
      <section style={seccion}>
        <h2 style={titulo}>1 · Tus anuncios</h2>
        <p style={{ ...apagado, marginBottom: 12 }}>
          Escribe lo que verá quien busque tu servicio. Hacen falta al menos 3 títulos (30 caracteres máximo) y 2
          descripciones (90 caracteres). Los apruebas tú: SOEC no inventa textos por su cuenta.
        </p>
        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>Servicio</span>
          <input style={campo} value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="por ejemplo: implantes-dentales" />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>Títulos (uno por línea)</span>
          <textarea style={{ ...campo, minHeight: 90 }} value={titulares} onChange={(e) => setTitulares(e.target.value)} />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>Descripciones (una por línea)</span>
          <textarea style={{ ...campo, minHeight: 70 }} value={descripciones} onChange={(e) => setDescripciones(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={ocupado || oferta.trim() === ''}
          onClick={() => void accion(() => guardarMaterial(org, {
            ofertaSlug: oferta.trim(),
            titulares: titulares.split('\n').map((t) => t.trim()).filter((t) => t !== ''),
            descripciones: descripciones.split('\n').map((t) => t.trim()).filter((t) => t !== ''),
          }), 'anuncios guardados y aprobados')}
        >
          Guardar y aprobar estos anuncios
        </button>
        {vista !== null && vista.material.length > 0 && (
          <ul style={{ paddingLeft: 18, marginTop: 12, fontSize: 14 }}>
            {vista.material.map((m) => (
              <li key={m.id}>
                <strong>{m.ofertaSlug}</strong> · {m.tipo === 'HEADLINE' ? 'título' : m.tipo === 'DESCRIPTION' ? 'descripción' : m.tipo.toLowerCase()}: {m.texto}
                {m.estado === 'APROBADO' ? '' : ' (sin aprobar)'}
              </li>
            ))}
          </ul>
        )}
        {vista?.claims?.ok === false && (
          <div style={{ marginTop: 12, color: '#b00020' }}>
            <strong>Estos textos no se pueden publicar tal como están:</strong>
            <ul style={{ paddingLeft: 18 }}>
              {vista.claims.conflictos.map((c, i) => (
                <li key={i}>«{c.texto}» ({c.donde}) menciona «{c.coincidencia}», y tu empresa declaró: «{c.restriccion}».</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── 2. MEDICIÓN ── */}
      <section style={seccion}>
        <h2 style={titulo}>2 · Medir los resultados</h2>
        <p style={{ ...apagado, marginBottom: 12 }}>
          Sin medición, una campaña gasta a ciegas. SOEC crea la acción en Google; instalarla en tu sitio y
          comprobar que llega la señal son dos pasos distintos — y sólo lo segundo cuenta como «lista».
        </p>
        <button type="button" disabled={ocupado} onClick={() => void accion(() => prepararMedicion(org), 'medición preparada en Google')}>
          Preparar la medición en Google
        </button>
        {(vista?.medicion ?? []).map((m) => (
          <div key={m.eventKey} style={{ marginTop: 12 }}>
            <p style={{ marginBottom: 4 }}>
              <strong>{m.eventKey}</strong>: {ETIQUETA_MEDICION[m.estado] ?? m.estado}
            </p>
            {m.instrucciones.map((i, k) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <p style={{ marginBottom: 4 }}>{i.titulo}. {i.detalle}</p>
                {i.fragmento !== null && (
                  <textarea readOnly value={i.fragmento} style={{ ...campo, minHeight: 120, fontFamily: 'monospace', fontSize: 12 }} />
                )}
              </div>
            ))}
            {m.estado !== 'VERIFIED' && (
              <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" disabled={ocupado} onClick={() => void accion(() => actualizarMedicion(org, m.eventKey, 'INSTALADA'), 'anotado: la medición está instalada')}>
                  Ya la instalé
                </button>
                <button type="button" disabled={ocupado} onClick={() => void accion(() => actualizarMedicion(org, m.eventKey, 'VERIFICAR'), 'comprobación hecha')}>
                  Comprobar si llega la señal
                </button>
              </p>
            )}
          </div>
        ))}
      </section>

      {/* ── 3. QUÉ FALTA ── */}
      <section style={seccion}>
        <h2 style={titulo}>3 · Qué falta antes de crearla</h2>
        {vista !== null && pendientes.length === 0 && <p style={{ color: '#0a7' }}>No falta nada: se puede crear.</p>}
        <ul style={{ paddingLeft: 18 }}>
          {(vista?.prerrequisitos ?? []).map((r) => (
            <li key={r.requisito} style={{ marginBottom: 4 }}>
              <span style={{ color: COLOR[r.veredicto] ?? '#666' }}>{ICONO[r.veredicto] ?? '•'}</span>{' '}
              <strong>{TITULO_REQUISITO[r.requisito] ?? r.requisito}</strong>
              {r.veredicto === 'PASS' ? '' : <> — {r.motivo}</>}
            </li>
          ))}
        </ul>
      </section>

      {/* ── 4. LO QUE SE CREARÁ ── */}
      <section style={seccion}>
        <h2 style={titulo}>4 · Lo que se creará</h2>
        <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" disabled={ocupado} onClick={() => void accion(() => prepararCampana(org), 'preparada')}>
            {peticion === null ? 'Preparar campaña' : 'Actualizar la preparación'}
          </button>
          {peticion !== null && !creada && vista?.puedeEjecutar === true && peticion.autorizacion === null && (
            <button type="button" disabled={ocupado} onClick={() => void accion(() => autorizarCampana(org, peticion.id), 'aprobada: ya puedes crearla')}>
              Apruebo crear esta campaña en pausa
            </button>
          )}
          {peticion !== null && !creada && peticion.autorizacion !== null && (
            <button type="button" disabled={ocupado} onClick={() => void accion(() => crearCampanaEnPausa(org, peticion.id), 'campaña creada en pausa')}>
              Crear la campaña (quedará en pausa)
            </button>
          )}
          {creada && (
            <button type="button" disabled={ocupado} onClick={() => void accion(() => reconciliarCampana(org, peticion!.id), 'comprobado contra Google')}>
              Comprobar que sigue igual en Google
            </button>
          )}
        </p>

        {resumen === null && <p style={apagado}>Cuando estén los anuncios, la medición y el presupuesto, aquí verás el detalle exacto de lo que se creará.</p>}
        {resumen !== null && (
          <div className="card" style={{ padding: 12 }}>
            <ul style={{ paddingLeft: 18 }}>
              <li>Cuenta de Google: <strong>{resumen.cuenta}</strong></li>
              <li>Campaña: <strong>{resumen.campania}</strong> (búsqueda, en pausa)</li>
              <li>Presupuesto: <strong>{resumen.presupuestoDiario}</strong> · dentro de tu autorización de {resumen.topeAutorizado}</li>
              <li>Se mostrará en: {resumen.ubicaciones.join(', ')}</li>
              <li>Palabras que se dejan fuera: {resumen.negativas}</li>
              <li>Resultados que se medirán: {resumen.conversiones.join(', ') || 'ninguno'}</li>
            </ul>
            {resumen.grupos.map((g) => (
              <div key={g.nombre} style={{ marginTop: 12 }}>
                <h3 style={{ fontSize: 16, marginBottom: 4 }}>{g.nombre}</h3>
                <p style={{ ...apagado, marginBottom: 4 }}>
                  {g.palabras} búsquedas, por ejemplo: {g.ejemplos.join(' · ')} → lleva a {g.destino}
                </p>
                <p style={{ marginBottom: 2 }}><strong>Títulos:</strong> {g.titulares.join(' · ')}</p>
                <p><strong>Descripciones:</strong> {g.descripciones.join(' · ')}</p>
              </div>
            ))}
            {resumen.pendientes.length > 0 && (
              <p style={{ color: '#b58900', marginTop: 12 }}>Antes de crearla: {resumen.pendientes.join(' · ')}</p>
            )}
            <p style={{ marginTop: 12 }}><strong>{resumen.aviso}</strong></p>
          </div>
        )}
      </section>

      {/* ── 5. RESULTADO ── */}
      {peticion !== null && (
        <section style={seccion}>
          <h2 style={titulo}>5 · Estado de tu campaña</h2>
          <p style={{ marginBottom: 8 }}>
            {ETIQUETA_ESTADO_EJECUCION[peticion.estado] ?? peticion.estado}
            {peticion.autorizacion !== null && <> · aprobada el {new Date(peticion.autorizacion.autorizadoEn).toLocaleString()}</>}
          </p>
          {peticion.motivo !== null && <p style={{ color: '#b58900', marginBottom: 8 }}>{peticion.motivo}</p>}
          {creada && (
            <>
              <p style={{ marginBottom: 8 }}>
                Se creó en tu cuenta y está <strong>en pausa</strong>. No se está mostrando a nadie y no está gastando.
              </p>
              {peticion.reconciliacion !== null && (
                peticion.reconciliacion.coincide
                  ? <p style={{ color: '#0a7' }}>Comprobado en Google: coincide con lo aprobado.</p>
                  : (
                    <div style={{ color: '#b58900' }}>
                      <p>Hay diferencias entre lo aprobado y lo que hay en Google:</p>
                      <ul style={{ paddingLeft: 18 }}>
                        {peticion.reconciliacion.divergencias.map((d, i) => (
                          <li key={i}>{d.campo}: se esperaba {d.esperado}, hay {d.encontrado}</li>
                        ))}
                      </ul>
                      <p>SOEC no las corrige por su cuenta: decidir qué hacer con un cambio hecho por fuera es tuyo.</p>
                    </div>
                  )
              )}
            </>
          )}
        </section>
      )}

      {vista !== null && vista.historial.length > 1 && (
        <section style={seccion}>
          <h2 style={titulo}>Intentos anteriores</h2>
          <ul style={{ paddingLeft: 18, fontSize: 14 }}>
            {vista.historial.map((h) => (
              <li key={h.id}>Plan versión {h.planVersion} · {ETIQUETA_ESTADO_EJECUCION[h.estado] ?? h.estado} · {new Date(h.solicitadoEn).toLocaleString()}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
