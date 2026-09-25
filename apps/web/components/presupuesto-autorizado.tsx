'use client';

/**
 * «PRESUPUESTO AUTORIZADO».
 *
 * La única pantalla donde una persona dice cuánto dinero puede comprometer SOEC en su nombre. Dos cifras: el
 * total y el máximo por día. Nada más.
 *
 * Lo que aquí NO aparece, y es deliberado:
 *  · nada de «sobre de ejecución», «autonomía», «Customer ID», «micros» ni «MCC»: quien firma dinero no tiene
 *    que aprender el vocabulario interno de un sistema publicitario para hacerlo;
 *  · ningún dato de pago. Ni tarjeta, ni cuenta, ni un solo dígito. Autorizar un límite y pagar son cosas
 *    distintas, y esta pantalla sólo hace la primera.
 *
 * Y lo que dice en voz alta: autorizar este presupuesto no enciende nada. Los permisos para actuar están más
 * abajo, se encienden aparte, y ninguno se enciende por haber puesto una cifra aquí.
 */
import { useCallback, useEffect, useState } from 'react';
import { autorizarPresupuesto, importe, leerPresupuesto, type VistaPresupuesto } from '../lib/mandato-financiero-client';

export function PresupuestoAutorizado({ org }: { org: string }): React.ReactElement {
  const [vista, setVista] = useState<VistaPresupuesto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [total, setTotal] = useState('');
  const [diario, setDiario] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setVista(await leerPresupuesto(org));
      setError(null);
    } catch (e) {
      // Sin lectura no se inventa un presupuesto: se dice que no se pudo leer.
      setVista(null);
      setError(e instanceof Error ? e.message : 'no se pudo leer el presupuesto autorizado');
    }
  }, [org]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function autorizar(): Promise<void> {
    setOcupado(true);
    setError(null);
    try {
      const t = Number(total.replace(/[^\d.,-]/g, '').replace(',', '.'));
      const d = diario.trim() === '' ? null : Number(diario.replace(/[^\d.,-]/g, '').replace(',', '.'));
      if (!Number.isFinite(t) || t <= 0) throw new Error('escribe el total máximo que autorizas');
      if (d !== null && (!Number.isFinite(d) || d <= 0)) throw new Error('el máximo diario debe ser un importe válido');
      if (d !== null && d > t) throw new Error('el máximo diario no puede ser mayor que el total');
      // Sin moneda declarada no hay importe: no se supone ninguna (ver `dinero.ts` en la API).
      if (moneda === null) throw new Error('esta empresa todavía no declara en qué moneda opera');
      setVista(await autorizarPresupuesto(org, { moneda, totalMaximo: t, maximoDiario: d }));
      setEditando(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'no se pudo registrar el presupuesto');
    } finally {
      setOcupado(false);
    }
  }

  const p = vista?.presupuesto ?? null;
  /**
   * La moneda sale del negocio (la declaró al crearse) o del presupuesto ya autorizado. Si no hay ninguna, no
   * se ofrece autorizar: una cifra sin moneda no es una autorización.
   */
  const moneda = p?.moneda ?? vista?.monedaDelNegocio ?? null;

  return (
    <section id="presupuesto-autorizado" style={{ marginBottom: 32, border: '1px solid var(--borde, #eee)', borderRadius: 8, padding: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>Presupuesto autorizado</h2>
      <p style={{ color: 'var(--muted, #666)', marginBottom: 12 }}>
        Cuánto dinero puede comprometer SOEC en tu nombre, como máximo. Lo decides tú y puedes cambiarlo.
      </p>

      {error !== null && <p role="alert" style={{ color: '#b00020', marginBottom: 12 }}>{error}</p>}

      {moneda === null && vista !== null && (
        <p style={{ marginBottom: 12 }}>
          Esta empresa todavía no declara en qué moneda opera, y sin eso no se puede autorizar un importe.
        </p>
      )}

      {p === null && !editando && moneda !== null && (
        <>
          <p style={{ marginBottom: 12 }}>
            <strong>Todavía no has autorizado ningún presupuesto.</strong> Mientras no lo hagas, SOEC no puede
            comprometer ni un peso.
          </p>
          <button type="button" onClick={() => setEditando(true)}>Autorizar un presupuesto</button>
        </>
      )}

      {p !== null && !editando && (
        <>
          <p style={{ margin: '0 0 4px' }}>Total máximo: <strong>{importe(p.totalMaximo, p.moneda)}</strong></p>
          <p style={{ margin: '0 0 4px' }}>
            Máximo diario: <strong>{p.maximoDiario === null ? 'sin máximo diario' : importe(p.maximoDiario, p.moneda)}</strong>
          </p>
          <p style={{ margin: '0 0 12px', color: 'var(--muted, #666)' }}>
            Comprometido hasta ahora: {importe(p.gastado, p.moneda)} · Disponible: {importe(p.disponible, p.moneda)}
          </p>
          {!p.vigente && (
            <p style={{ color: '#b26a00', marginBottom: 12 }}>
              Este presupuesto ya no está vigente. Autoriza uno nuevo cuando quieras volver a operar.
            </p>
          )}
          <button type="button" onClick={() => { setTotal(String(p.totalMaximo)); setDiario(p.maximoDiario === null ? '' : String(p.maximoDiario)); setEditando(true); }}>
            Cambiar el presupuesto
          </button>
        </>
      )}

      {editando && moneda !== null && (
        <div style={{ display: 'grid', gap: 12, maxWidth: 360 }}>
          <label>
            <div>Total máximo ({moneda})</div>
            <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="30000" aria-label={`Total máximo en ${moneda}`} />
          </label>
          <label>
            <div>Máximo diario ({moneda}) — opcional</div>
            <input value={diario} onChange={(e) => setDiario(e.target.value)} inputMode="decimal" placeholder="2500" aria-label={`Máximo diario en ${moneda}`} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={ocupado} onClick={() => void autorizar()}>
              {ocupado ? 'Guardando…' : 'Autorizar este presupuesto'}
            </button>
            <button type="button" disabled={ocupado} onClick={() => { setEditando(false); setError(null); }}>Cancelar</button>
          </div>
          <p style={{ color: 'var(--muted, #666)', margin: 0 }}>
            No se te pide ningún dato de pago. Esto es un límite, no un cobro.
          </p>
        </div>
      )}

      <p style={{ color: 'var(--muted, #666)', marginTop: 12, marginBottom: 0 }}>
        Autorizar un presupuesto no enciende ningún permiso: SOEC sigue sin poder cambiar nada en tu cuenta
        hasta que lo permitas más abajo, y nunca gasta más de lo que autorizas aquí.
      </p>
    </section>
  );
}
