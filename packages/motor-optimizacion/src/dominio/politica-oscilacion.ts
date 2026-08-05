/**
 * @soec/motor-optimizacion · dominio · GUARDAS CONTRA OSCILACIÓN (puro, determinista).
 *
 * Impide cambios reactivos y ciclos infinitos: mínimo de evidencia/tiempo, período de enfriamiento, máximo
 * de cambios por ventana, prohibición de alternar A→B→A→B, y límite de reoptimizaciones. Reloj INYECTADO.
 */
export interface PoliticaOscilacion {
  readonly cooldownMs: number;
  readonly maxCambiosPorVentana: number;
  readonly ventanaMs: number;
  readonly maxReoptimizaciones: number;
  readonly minEvidencia: number;
}

export interface CambioAplicado {
  readonly variable: string;
  readonly valor: string;
  readonly en: string; // ISO
}

export interface VeredictoOscilacion { readonly permitido: boolean; readonly motivo: string }

/**
 * ¿Se permite aplicar `cambio` dado el `historial` de cambios de la organización?
 * Bloquea: cooldown activo, exceso de cambios en la ventana, oscilación A→B→A, y tope de reoptimizaciones.
 */
export function permitirCambio(historial: readonly CambioAplicado[], cambio: { variable: string; valor: string }, pol: PoliticaOscilacion, ahora: string): VeredictoOscilacion {
  const t = Date.parse(ahora);
  const delVar = historial.filter((h) => h.variable === cambio.variable).sort((a, b) => Date.parse(a.en) - Date.parse(b.en));

  if (delVar.length >= pol.maxReoptimizaciones) return { permitido: false, motivo: `tope de reoptimizaciones (${pol.maxReoptimizaciones}) para ${cambio.variable}` };

  const ultimo = delVar[delVar.length - 1];
  if (ultimo && t - Date.parse(ultimo.en) < pol.cooldownMs) return { permitido: false, motivo: `período de enfriamiento activo para ${cambio.variable}` };

  const enVentana = delVar.filter((h) => t - Date.parse(h.en) <= pol.ventanaMs).length;
  if (enVentana >= pol.maxCambiosPorVentana) return { permitido: false, motivo: `máximo de cambios por ventana alcanzado para ${cambio.variable}` };

  // Oscilación A→B→A: el nuevo valor coincide con el ANTEPENÚLTIMO y difiere del último.
  const anteultimo = delVar[delVar.length - 2];
  if (ultimo && anteultimo && cambio.valor === anteultimo.valor && cambio.valor !== ultimo.valor) {
    return { permitido: false, motivo: `oscilación detectada (A→B→A) en ${cambio.variable}` };
  }
  return { permitido: true, motivo: '' };
}
