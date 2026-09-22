'use client';

/**
 * OBJETIVOS Y CRITERIOS del negocio activo.
 *
 * Es lo que vuelve EVALUABLE a una empresa: qué quiere conseguir, qué acción de un cliente cuenta como
 * resultado, con qué indicador se mide, cuál es la meta y cuántos datos hacen falta antes de concluir.
 *
 * Reglas de esta pantalla:
 *  · se pregunta en lenguaje de negocio; la jerga (CPA, ROAS, CVR) sólo aparece como ayuda, nunca como requisito;
 *  · lo que falta se muestra como una lista de pendientes con su explicación — nunca un «perfil incompleto» seco;
 *  · completar esto NO autoriza gastar ni ejecutar campañas: eso se decide aparte y se dice en la propia página.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { orgActiva } from '../../../lib/org-activa';
import {
  ACCIONES_FRECUENTES,
  INDICADORES_FRECUENTES,
  TITULO_FALTANTE,
  documentoDeObjetivos,
  guardarPolitica,
  leerPolitica,
  type CampoObjetivos,
  type DocumentoPolitica,
  type VistaPolitica,
} from '../../../lib/politica-client';

const etiqueta = { display: 'block', fontWeight: 600, marginBottom: 4 } as const;
const campo = { width: '100%', padding: 8 } as const;
const bloque = { display: 'block', marginBottom: 16 } as const;

export default function ObjetivosPage() {
  const [org, setOrg] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaPolitica | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [avanzada, setAvanzada] = useState(false);
  // Qué campos tocó la persona. La precarga NO cuenta: mostrar un valor no es decidirlo.
  const [tocados, setTocados] = useState<ReadonlySet<CampoObjetivos>>(new Set());
  const marcar = (campo: CampoObjetivos): void => setTocados((previos) => new Set([...previos, campo]));

  // Formulario en lenguaje de negocio.
  const [objetivo, setObjetivo] = useState('');
  const [contexto, setContexto] = useState('');
  const [accion, setAccion] = useState('');
  const [accionLibre, setAccionLibre] = useState('');
  const [indicador, setIndicador] = useState('');
  const [conoceMeta, setConoceMeta] = useState<'SI' | 'TODAVIA_NO' | ''>('');
  const [meta, setMeta] = useState('');
  const [horizonte, setHorizonte] = useState('30');
  // La cifra recomendada la trae el servidor; la pantalla nunca inventa la suya.
  const [modoEvidencia, setModoEvidencia] = useState<'RECOMENDADA' | 'PROPIA'>('RECOMENDADA');
  const [evidencia, setEvidencia] = useState('');
  const [pausa, setPausa] = useState('');
  const [restriccion, setRestriccion] = useState('');

  useEffect(() => {
    setOrg(orgActiva());
  }, []);

  const cargar = useCallback(async (o: string) => {
    try {
      const v = await leerPolitica(o);
      setVista(v);
      setObjetivo((prev) => (prev === '' ? v.objetivoDeclarado ?? '' : prev));
      setContexto((prev) => (prev === '' ? v.politica.politica?.businessContext ?? '' : prev));
      const principal = v.politica.eventos.find((e) => e.rol === 'PRIMARY');
      if (principal) {
        const conocida = ACCIONES_FRECUENTES.some((x) => x.eventKey === principal.eventKey);
        setAccion((prev) => (prev === '' ? (conocida ? principal.eventKey : 'OTRA') : prev));
        if (!conocida) setAccionLibre((prev) => (prev === '' ? principal.eventKey : prev));
      }
      const kpi = v.politica.kpis.find((k) => k.rol === 'PRIMARY');
      if (kpi) {
        setIndicador((prev) => (prev === '' ? kpi.clave : prev));
        setMeta((prev) => (prev === '' && kpi.targetValue !== null ? String(kpi.targetValue) : prev));
        // Si ya dijo «todavía no lo sé», la pantalla lo recuerda en vez de volver a pedir un número.
        setConoceMeta((prev) => (prev === '' ? (kpi.targetValue !== null ? 'SI' : 'TODAVIA_NO') : prev));
      }
      const ev = v.politica.reglas.find((r) => r.tipo === 'EVIDENCE_MINIMUM' && r.valor !== null);
      if (ev?.valor != null) {
        setModoEvidencia(ev.procedencia === 'SYSTEM_DEFAULT' ? 'RECOMENDADA' : 'PROPIA');
        if (ev.procedencia !== 'SYSTEM_DEFAULT') setEvidencia(String(ev.valor));
      }
      const pa = v.politica.reglas.find((r) => r.tipo === 'PAUSE' && r.valor !== null);
      if (pa?.valor != null) setPausa(String(pa.valor));
      if (v.politica.politica?.evaluationHorizonDays != null) setHorizonte(String(v.politica.politica.evaluationHorizonDays));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudieron leer los objetivos');
    }
  }, []);

  useEffect(() => {
    if (org !== null) void cargar(org);
  }, [org, cargar]);

  async function conCarga(fn: () => Promise<void>): Promise<void> {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo guardar');
    } finally {
      setOcupado(false);
    }
  }

  const documento = (): DocumentoPolitica => documentoDeObjetivos(
    { objetivo, contexto, accion, accionLibre, indicador, conoceMeta, meta, horizonte, modoEvidencia, evidencia, pausa },
    vista?.recomendacionEvidencia ?? null,
    tocados,
  );

  if (org === null) {
    return (
      <main className="wrap" style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px' }}>
        <h1>Objetivos y criterios</h1>
        <p>Primero elige una empresa en <Link href="/negocios">tu panel</Link>.</p>
      </main>
    );
  }

  const completo = vista?.completitud.estado === 'EVALUATION_PROFILE_COMPLETE';

  return (
    <main className="wrap" style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px' }}>
      <p style={{ marginBottom: 8 }}><Link href="/negocios">← Volver al panel</Link></p>
      <h1 style={{ marginBottom: 4 }}>Objetivos y criterios</h1>
      <p style={{ color: 'var(--muted, #666)', marginBottom: 20 }}>
        Con esto SOEC puede decir si a tu negocio le está yendo bien o mal. Definirlo no autoriza gastar dinero
        ni cambiar tus campañas: eso se decide aparte y siempre lo decides tú.
      </p>

      {error !== null && <p role="alert" style={{ color: '#b00020', marginBottom: 16 }}>{error}</p>}
      {aviso !== null && <p style={{ color: '#0a7', marginBottom: 16 }}>{aviso}</p>}

      {vista !== null && (
        <div className="card" style={{ padding: 12, marginBottom: 24, border: '1px solid var(--borde, #eee)' }}>
          <strong>{completo ? '✓ Tu negocio ya es evaluable' : 'Falta información para poder evaluarte'}</strong>
          {completo && vista.completitud.lineaBase === 'LEARNING_BASELINE' && (
            <p style={{ margin: '8px 0 0' }}>
              SOEC está aprendiendo tu meta con los primeros datos. Hasta que la confirmes, no subirá
              presupuestos ni encenderá campañas por su cuenta.
            </p>
          )}
          {!completo && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {vista.completitud.faltantes.map((f) => (
                <li key={f.campo}>
                  <strong>{TITULO_FALTANTE[f.campo] ?? f.campo}</strong> — {f.comoSeResuelve}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label style={bloque}>
        <span style={etiqueta}>¿Qué quieres conseguir?</span>
        <input value={objetivo} onChange={(e) => { setObjetivo(e.target.value); marcar('objetivo'); }} placeholder="Por ejemplo: más pacientes nuevos" style={campo} />
      </label>

      <label style={bloque}>
        <span style={etiqueta}>¿Qué acción de un cliente consideras importante?</span>
        <select value={accion} onChange={(e) => { setAccion(e.target.value); marcar('accion'); }} style={campo}>
          <option value="">Elige una…</option>
          {ACCIONES_FRECUENTES.map((a) => <option key={a.eventKey} value={a.eventKey}>{a.etiqueta}</option>)}
          <option value="OTRA">Otra acción…</option>
        </select>
      </label>
      {accion === 'OTRA' && (
        <label style={bloque}>
          <span style={etiqueta}>¿Cuál?</span>
          <input value={accionLibre} onChange={(e) => { setAccionLibre(e.target.value); marcar('accionLibre'); }} placeholder="descríbela en pocas palabras" style={campo} />
        </label>
      )}

      <label style={bloque}>
        <span style={etiqueta}>¿Con qué lo medimos?</span>
        <select value={indicador} onChange={(e) => { setIndicador(e.target.value); marcar('indicador'); }} style={campo}>
          <option value="">Elige uno…</option>
          {INDICADORES_FRECUENTES.map((i) => <option key={i.clave} value={i.clave}>{i.etiqueta}</option>)}
        </select>
      </label>

      <section style={bloque}>
        <span style={etiqueta}>¿Sabes qué número sería un buen resultado?</span>
        <div style={{ display: 'flex', gap: 8, margin: '6px 0' }}>
          {([['SI', 'Sí, te lo digo'], ['TODAVIA_NO', 'Todavía no lo sé — que SOEC la aprenda']] as const).map(([v, t]) => (
            <button
              key={v}
              type="button"
              className="btn"
              onClick={() => { setConoceMeta(v); marcar('conoceMeta'); }}
              style={{ padding: '10px 14px', fontWeight: conoceMeta === v ? 700 : 400, borderWidth: conoceMeta === v ? 2 : 1 }}
            >
              {t}
            </button>
          ))}
        </div>
        {conoceMeta === 'SI' && (
          <label style={{ display: 'block' }}>
            <span style={etiqueta}>¿Cuál es tu meta?</span>
            <input value={meta} onChange={(e) => { setMeta(e.target.value); marcar('meta'); }} placeholder="un número" style={campo} />
            <span style={{ color: 'var(--muted, #666)' }}>
              {INDICADORES_FRECUENTES.find((i) => i.clave === indicador)?.ayudaMeta ?? 'Elige antes el indicador.'}
            </span>
          </label>
        )}
        {conoceMeta === 'TODAVIA_NO' && (
          <p style={{ color: 'var(--muted, #666)', margin: 0 }}>
            Perfecto: no hace falta inventar un número. SOEC la aprenderá observando tus primeros datos y te la
            propondrá para que la confirmes. Mientras tanto no subirá presupuestos, no subirá el precio por
            visita y no encenderá campañas por su cuenta.
          </p>
        )}
      </section>

      {vista !== null && vista.referencias.oferta.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>¿Cuáles son tus servicios prioritarios?</h2>
          <p style={{ color: 'var(--muted, #666)', marginBottom: 8 }}>Lo prioritario se atiende primero cuando haya que elegir.</p>
          {vista.referencias.oferta.map((o) => (
            <div key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
              <span style={{ flex: 1 }}>{o.name}</span>
              <select
                value={o.priority <= 10 ? '10' : o.priority <= 50 ? '50' : '100'}
                disabled={ocupado}
                onChange={(e) => void conCarga(async () => {
                  const v = await guardarPolitica(org, { prioridadesDeOferta: [{ slug: o.slug, priority: Number(e.target.value) }] });
                  setVista(v);
                  setAviso('Prioridad guardada.');
                })}
                style={{ padding: 6 }}
              >
                <option value="10">Prioritario</option>
                <option value="50">Secundario</option>
                <option value="100">Sin prioridad</option>
              </select>
            </div>
          ))}
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>¿Qué límites no deben violarse nunca?</h2>
        <p style={{ color: 'var(--muted, #666)', marginBottom: 8 }}>
          Por ejemplo: algo que tu negocio no ofrece, o una afirmación que no puedes hacer.
        </p>
        {vista !== null && vista.referencias.restricciones.length > 0 && (
          <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
            {vista.referencias.restricciones.map((r) => (
              <li key={r.id}>
                {r.texto}{' '}
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => void conCarga(async () => {
                    const v = await guardarPolitica(org, { restriccionesRetiradas: [r.id] });
                    setVista(v);
                    setAviso('Límite retirado.');
                  })}
                  style={{ border: 'none', background: 'none', color: '#b00020', cursor: 'pointer' }}
                >
                  quitar
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={restriccion} onChange={(e) => setRestriccion(e.target.value)} placeholder="Por ejemplo: no atiende Fonasa" style={{ ...campo, flex: 1 }} />
          <button
            type="button"
            className="btn"
            disabled={ocupado || restriccion.trim() === ''}
            onClick={() => void conCarga(async () => {
              const v = await guardarPolitica(org, { restriccionesNuevas: [{ texto: restriccion.trim(), tipo: 'RESTRICTION' }] });
              setVista(v);
              setRestriccion('');
              setAviso('Límite añadido.');
            })}
            style={{ padding: '8px 14px' }}
          >
            Añadir
          </button>
        </div>
      </section>

      <p style={{ marginBottom: 16 }}>
        <button type="button" onClick={() => setAvanzada(!avanzada)} style={{ border: 'none', background: 'none', color: 'var(--link, #06c)', cursor: 'pointer', padding: 0 }}>
          {avanzada ? '− Ocultar configuración avanzada' : '+ Configuración avanzada'}
        </button>
      </p>

      {avanzada && (
        <section style={{ marginBottom: 24, paddingLeft: 12, borderLeft: '3px solid var(--borde, #eee)' }}>
          <label style={bloque}>
            <span style={etiqueta}>¿En cuántos días esperas ver el resultado?</span>
            <input value={horizonte} onChange={(e) => { setHorizonte(e.target.value); marcar('horizonte'); }} style={campo} />
          </label>
          <section style={bloque}>
            <span style={etiqueta}>¿Cuántas veces debe mostrarse tu anuncio antes de concluir algo?</span>
            <div style={{ display: 'flex', gap: 8, margin: '6px 0', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn"
                onClick={() => { setModoEvidencia('RECOMENDADA'); marcar('modoEvidencia'); }}
                style={{ padding: '10px 14px', fontWeight: modoEvidencia === 'RECOMENDADA' ? 700 : 400, borderWidth: modoEvidencia === 'RECOMENDADA' ? 2 : 1 }}
              >
                {vista?.recomendacionEvidencia
                  ? `Usar la recomendación de SOEC: ${vista.recomendacionEvidencia.valor.toLocaleString('es-CL')} impresiones`
                  : 'Usar la recomendación de SOEC'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => { setModoEvidencia('PROPIA'); marcar('modoEvidencia'); }}
                style={{ padding: '10px 14px', fontWeight: modoEvidencia === 'PROPIA' ? 700 : 400, borderWidth: modoEvidencia === 'PROPIA' ? 2 : 1 }}
              >
                Yo defino cuántas
              </button>
            </div>
            {modoEvidencia === 'PROPIA' && (
              <input value={evidencia} onChange={(e) => { setEvidencia(e.target.value); marcar('evidencia'); }} placeholder="un número" style={campo} />
            )}
            <span style={{ color: 'var(--muted, #666)' }}>
              Sirve para no sacar conclusiones con muy pocos datos. La recomendación la pone SOEC y queda
              guardada como tal —no como una decisión tuya—, y puedes cambiarla cuando quieras.
            </span>
          </section>
          <label style={bloque}>
            <span style={etiqueta}>¿Por debajo de qué resultado convendría detener el gasto?</span>
            <input value={pausa} onChange={(e) => { setPausa(e.target.value); marcar('pausa'); }} placeholder="fracción, por ejemplo 0,005" style={campo} />
            <span style={{ color: 'var(--muted, #666)' }}>Opcional. Detener siempre exige tu permiso aparte.</span>
          </label>
          <p style={{ color: 'var(--muted, #666)' }}>
            Los topes de lo que SOEC puede cambiar por su cuenta (presupuesto máximo, CPC máximo) se configuran
            junto con los permisos, en <Link href="/negocios/conexiones">Conexiones y permisos</Link>.
          </p>
        </section>
      )}

      <button
        type="button"
        className="btn primary"
        disabled={ocupado}
        onClick={() => void conCarga(async () => {
          const doc = documento();
          if (Object.keys(doc).length === 0) {
            setAviso('No cambiaste nada, así que no se guardó nada.');
            return;
          }
          const v = await guardarPolitica(org, doc);
          setTocados(new Set());
          setVista(v);
          setAviso(v.completitud.estado === 'EVALUATION_PROFILE_COMPLETE'
            ? 'Guardado. Tu negocio ya es evaluable.'
            : 'Guardado. Todavía falta algo para poder evaluarte.');
        })}
        style={{ padding: '10px 18px', fontWeight: 600 }}
      >
        Guardar objetivos
      </button>
    </main>
  );
}
