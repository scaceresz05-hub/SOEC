'use client';

/**
 * Selector de empresa PERSISTENTE en la barra superior. Mientras estás dentro de un negocio, es
 * imposible olvidar cuál es. Al cambiar: recarga completa al panel del nuevo negocio, de modo que
 * NUNCA queden datos del tenant anterior en pantalla (Fase 4 del rediseño).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fijarOrgActiva, orgActiva } from '../lib/org-activa';
import { listarMisNegocios, type Negocio } from '../lib/mis-negocios';
import { colorDeNegocio, iniciales } from './ui';

export default function BusinessSelector(): React.ReactElement | null {
  const [lista, setLista] = useState<Negocio[]>([]);
  const [org, setOrg] = useState<string | null | undefined>(undefined);
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrg(orgActiva());
  }, []);

  useEffect(() => {
    listarMisNegocios()
      .then(setLista)
      .catch(() => setLista([]));
  }, []);

  useEffect(() => {
    function fuera(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const elegir = useCallback((id: string) => {
    fijarOrgActiva(id);
    // Recarga dura al panel del nuevo negocio: sin datos transitorios del tenant anterior.
    window.location.assign(`/negocios?org=${encodeURIComponent(id)}`);
  }, []);

  if (org === undefined) return null;
  const actual = lista.find((n) => n.organizationId === org) ?? null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="bizchip"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        {actual ? (
          <>
            <span className="av" style={{ background: colorDeNegocio(actual.organizationId) }} aria-hidden="true">
              {iniciales(actual.displayName)}
            </span>
            <span className="nm">{actual.displayName}</span>
          </>
        ) : (
          <>
            <span className="cr">Elegí una empresa</span>
          </>
        )}
        <span className="cr" aria-hidden="true">▾</span>
      </button>

      {abierto && (
        <div className="bizmenu" role="listbox" aria-label="Cambiar de empresa">
          {lista.map((n) => (
            <button
              key={n.organizationId}
              type="button"
              role="option"
              aria-selected={n.organizationId === org}
              data-on={n.organizationId === org}
              onClick={() => elegir(n.organizationId)}
            >
              <span className="av" style={{ background: colorDeNegocio(n.organizationId) }} aria-hidden="true">
                {iniciales(n.displayName)}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 650, display: 'block' }}>{n.displayName}</span>
                <span className="cr">
                  {n.modeloDeNegocio === 'ECOMMERCE_DISTRIBUCION'
                    ? 'E-commerce / distribución'
                    : n.modeloDeNegocio === 'SAAS_FUNNEL'
                      ? 'Software (SaaS)'
                      : n.modeloDeNegocio || 'Empresa nueva'}
                </span>
              </span>
            </button>
          ))}
          {lista.length === 0 && (
            <button type="button" disabled>
              <span className="cr">No hay empresas registradas</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
