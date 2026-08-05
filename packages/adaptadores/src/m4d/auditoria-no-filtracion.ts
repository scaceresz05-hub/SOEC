/**
 * @soec/adaptadores · M4-D (neutral) · HARNESS DE NO-FILTRACIÓN (Eje 6). Utilidad REUTILIZABLE por los tests
 * de cualquier adaptador (real o fake) para demostrar, con un sentinela SINTÉTICO, que un valor sensible no
 * aparece en ninguna de las superficies observables (resultado, evidencia, logs, serialización, errores).
 * Provider-agnóstica; no hace llamadas reales. Determinista.
 */
export interface ReporteNoFiltracion {
  readonly filtra: boolean;
  readonly superficiesFiltradas: readonly string[];
}

function aTexto(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}:${v.message}\n${v.stack ?? ''}`;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * Verifica que `sentinela` NO aparezca en ninguna de las superficies provistas. Devuelve las superficies que
 * lo filtran (vacío = sin fuga). Usar en tests con un sentinela inequívocamente sintético.
 */
export function auditarNoFiltracion(sentinela: string, superficies: Readonly<Record<string, unknown>>): ReporteNoFiltracion {
  const filtradas: string[] = [];
  for (const [nombre, valor] of Object.entries(superficies)) {
    if (aTexto(valor).includes(sentinela)) filtradas.push(nombre);
  }
  return { filtra: filtradas.length > 0, superficiesFiltradas: filtradas.sort() };
}
