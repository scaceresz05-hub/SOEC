'use client';

import { useCallback, useEffect, useState } from 'react';
import { ensayar, estadoDecision, estadoPiloto, intentarActivar, prepararDecision, prepararPiloto, type DecisionPiloto } from '../../lib/piloto-client';
import type { EstadoPiloto } from '../../lib/piloto-types';

const TONO_READINESS: Record<string, string> = {
  apto_para_ensayo: 'warn',
  ensayo_aprobado: 'ok',
  apto_para_activacion: 'ok',
  incompleto: 'warn',
  bloqueado: 'danger',
  no_evaluado: 'reserved',
};
const TONO_ENSAYO: Record<string, string> = { apto_para_activacion: 'ok', bloqueado: 'danger', suspendido: 'danger', incompleto: 'warn', inconcluso: 'reserved' };
const ESCENARIOS = ['exitoso', 'onboarding_incompleto', 'credencial_pendiente', 'activo_faltante', 'presupuesto_invalido', 'suspension', 'rollback', 'repeticion'];

export default function PilotoPage() {
  const [estado, setEstado] = useState<EstadoPiloto | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [escenario, setEscenario] = useState('exitoso');
  const [decision, setDecision] = useState<DecisionPiloto | null>(null);

  const refrescar = useCallback(async () => setEstado(await estadoPiloto()), []);
  useEffect(() => {
    (async () => {
      await Promise.all([prepararPiloto(), prepararDecision()]);
      await refrescar();
      setDecision(await estadoDecision());
    })();
  }, [refrescar]);

  const correr = useCallback(
    async (fn: () => Promise<unknown>, describir?: (r: unknown) => string) => {
      setOcupado(true);
      try {
        const r = await fn();
        if (describir) setMensaje(describir(r));
        await refrescar();
      } finally {
        setOcupado(false);
      }
    },
    [refrescar],
  );

  if (!estado?.existe) {
    return (
      <div>
        <h1>Preparación del piloto</h1>
        <section className="card"><span className="spinner" /> Preparando la organización sintética…</section>
      </div>
    );
  }
  const rd = estado.readiness;

  return (
    <div>
      <h1>Preparación del piloto operacional</h1>
      <p className="muted">SOEC demuestra que una organización está lista para operar —o explica exactamente por qué no— antes de permitir cualquier efecto real. Toda esta preparación ocurre en un entorno sintético/emulado.</p>

      {decision?.existe && (
        <section className="card" style={{ borderColor: 'var(--danger, #b45309)' }}>
          <h2 style={{ marginTop: 0 }}>Decisión del primer piloto real — {decision.empresa}</h2>
          <div className="kv small">
            <dt>Objetivo</dt><dd>{decision.decision.objetivo}</dd>
            <dt>Canal / modo</dt><dd>{decision.decision.canal} · <span className="badge badge--warn">{decision.decision.modo}</span></dd>
            <dt>Autonomía</dt><dd>nivel {decision.decision.nivelAutonomia} · aprobación por publicación: {decision.decision.aprobacionPorPublicacion ? 'sí' : 'no'} · {decision.decision.frecuenciaMaxima}/sem · {decision.decision.duracionDias} días · gasto publicitario ${decision.decision.gastoPublicitario}</dd>
            <dt>Readiness real</dt><dd><span className={`badge badge--${decision.readinessReal.resultado === 'bloqueado' ? 'danger' : 'warn'}`}>{decision.readinessReal.resultado}</span> (activación real permitida: {decision.readinessReal.activacionRealPermitida ? 'sí' : 'no'})</dd>
          </div>
          <p className="small"><strong>Activación real: BLOQUEADA.</strong> {decision.activacion.motivo}.</p>
          <details>
            <summary className="small">Lo que usted (propietario) debe proveer/autorizar antes de publicar</summary>
            <ul className="limpia small">
              {decision.activacion.loQueFaltaOperativo.map((x, i) => <li key={`o${i}`}>• {x}</li>)}
              {decision.activacion.loQueFaltaEstrategico.map((x, i) => <li key={`e${i}`}>• {x}</li>)}
            </ul>
          </details>
          <p className="small muted">Prohibiciones duras: {decision.decision.prohibiciones.join(' · ')}. SOEC no conecta cuentas, no publica y no gasta: esas acciones son suyas.</p>
        </section>
      )}

      <section className="card">
        <div className="kv">
          <dt>Organización</dt><dd>{estado.organizacion?.nombre} <span className="chip">{estado.organizacion?.claseDatos}</span> · estado {estado.organizacion?.estado}</dd>
          <dt>Onboarding</dt><dd>{estado.onboarding.completas}/{estado.onboarding.total} etapas {estado.onboarding.faltantes.length > 0 && <span className="badge badge--warn">faltan: {estado.onboarding.faltantes.join(', ')}</span>}</dd>
          <dt>Perfil</dt><dd>{estado.perfil ? `${estado.perfil.departamento} · modo ${estado.perfil.modo} · autonomía ${estado.perfil.nivelAutonomia}` : '—'}</dd>
          <dt>Presupuesto</dt><dd>{estado.presupuesto ? `${estado.presupuesto.limiteTotal} ${estado.presupuesto.moneda} (real ejecutado: ${estado.presupuesto.ejecutadoReal}; sintético: ${estado.presupuesto.ejecutadoSintetico})` : '—'}</dd>
          <dt>Readiness</dt><dd><span className={`badge badge--${TONO_READINESS[rd.resultado] ?? 'reserved'}`}>{rd.resultado}</span> <span className="muted">({rd.entorno})</span></dd>
          <dt>Expediente</dt><dd>{estado.expediente ? `${estado.expediente.estado} · intentos de activación: ${estado.expediente.intentosActivacion}` : '—'}</dd>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>{rd.nota}</p>
      </section>

      <div style={{ margin: '10px 0' }}>
        <label className="small muted">Escenario de ensayo:{' '}
          <select value={escenario} onChange={(e) => setEscenario(e.target.value)} disabled={ocupado}>
            {ESCENARIOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>{' '}
        <button className="btn" disabled={ocupado} onClick={() => correr(() => ensayar(escenario), (r) => {
          const x = r as { resultado: string; incidencias: number; rollbackVerificado: boolean };
          return `SOEC ejecutó el ensayo: ${x.resultado}${x.incidencias ? `, ${x.incidencias} incidencia(s)` : ''}, rollback ${x.rollbackVerificado ? 'verificado' : 'no verificado'}.`;
        })}>Ejecutar ensayo</button>{' '}
        <button className="btn btn--sec" disabled={ocupado} onClick={() => correr(intentarActivar, (r) => {
          const x = r as { permitida: boolean; motivoDenegacion: string };
          return x.permitida ? 'Activada.' : `Activación denegada: ${x.motivoDenegacion}`;
        })}>Intentar activación real</button>
      </div>
      {mensaje && <section className="card"><strong>{mensaje}</strong></section>}

      {estado.ultimoEnsayo && (
        <>
          <h2>Último ensayo</h2>
          <section className="card small">
            <span className={`badge badge--${TONO_ENSAYO[estado.ultimoEnsayo.resultado] ?? 'reserved'}`}>{estado.ultimoEnsayo.resultado}</span> escenario {estado.ultimoEnsayo.escenario} · {estado.ultimoEnsayo.incidencias} incidencia(s) · rollback {estado.ultimoEnsayo.rollbackVerificado ? 'verificado' : 'no'}
          </section>
        </>
      )}

      <h2>Requisitos de readiness</h2>
      <section className="card">
        <ul className="limpia small">
          {rd.chequeos.map((c, i) => (
            <li key={i}>
              <span className={`badge badge--${c.bloqueo ? 'danger' : c.estado === 'aprobado' || c.estado === 'aprobado_con_advertencia' ? 'ok' : c.estado === 'pendiente' ? 'warn' : 'reserved'}`}>{c.estado}</span> <code>{c.codigo}</code>
              {c.faltante && <span className="muted"> — falta: {c.faltante}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card" style={{ marginTop: 12, borderColor: 'var(--danger, #b45309)' }}>
        <strong>Activación real: BLOQUEADA</strong>
        <p className="small">{estado.activacion.motivo}. La plataforma queda preparada, pero la activación productiva es una decisión estratégica explícita: requiere autorización del propietario, credenciales reales verificadas, un token de activación de un solo uso y una ventana definida. Ningún efecto público, gasto ni credencial real ocurre en este entorno.</p>
      </section>
    </div>
  );
}
