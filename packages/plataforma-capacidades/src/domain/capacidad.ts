/**
 * @soec/plataforma-capacidades · dominio · CAPACIDAD EXTERNA (M4-A · núcleo de la PCE).
 *
 * Implementa el Título I de la Directiva Maestra PCE sobre una capacidad externa (event-sourced,
 * multi-tenant, determinista, neutral — sin SDKs, sin red ni reloj del sistema):
 *  - Art. 2/4: el dominio conoce Capacidades, no Proveedores. Sólo guarda REFERENCIAS opacas
 *    (`proveedorRef`, `secretRef`); NUNCA el valor de un secreto, NUNCA el proveedor concreto, NUNCA el costo.
 *  - Art. 3: Capacidad ≠ Activación. Ciclo de vida gobernado; nace SIMULADA; sólo un acto humano la
 *    lleva, paso a paso, a EN_USO/REAL.
 *  - Art. 7: todo cambio de configuración versiona (`configVersion`).
 *  - Art. 8: kill-switch (pausar/deshabilitar) devuelve la capacidad a modo SIMULADA al instante.
 *  - Art. 11: la política de degradación es OBLIGATORIA y explícita.
 *  - Art. 13: salud (observable ≠ confiable); NO_CONFIABLE en modo REAL → vuelve a SIMULADA (fail-safe).
 */
import type { RecordedEvent } from '@soec/contracts';

/** Ciclo de vida gobernado (Art. 3). DISPONIBLE = pre-registro (la capacidad aún no existe). */
export type EstadoCapacidad =
  | 'REGISTRADA'
  | 'CONFIGURADA'
  | 'HABILITADA'
  | 'AUTORIZADA'
  | 'EN_USO'
  | 'PAUSADA'
  | 'DESHABILITADA'
  | 'REEMPLAZADA'
  | 'ELIMINADA';

/** Modo efectivo. Nace SIMULADA; sólo un acto humano la vuelve REAL (Art. 3/8). */
export type ModoCapacidad = 'SIMULADA' | 'REAL';

/** Salud (Art. 13). Observable ≠ confiable: disponible puede responder mal. */
export type SaludCapacidad = 'SALUDABLE' | 'DEGRADADA' | 'NO_CONFIABLE';

/** Política de degradación declarada y explícita (Art. 11). Nunca implícita. */
export type PoliticaDegradacion = 'ABSTENER' | 'SIMULAR' | 'ALTERNATIVA' | 'CACHE' | 'DETENER';

export interface CapacidadState {
  readonly organizationId: string;
  readonly capacidadId: string;
  readonly tipo: string; // p. ej. 'generacion-contenido' (una Capacidad, no un proveedor)
  readonly version: number; // versión de eventos (event-sourcing)
  readonly existe: boolean;
  readonly estado: EstadoCapacidad;
  readonly modo: ModoCapacidad;
  readonly salud: SaludCapacidad;
  readonly politicaDegradacion: PoliticaDegradacion | null;
  readonly proveedorRef: string | null; // REFERENCIA opaca (Art. 2). No es el proveedor concreto.
  readonly secretRef: string | null; // REFERENCIA (Art. 4). NUNCA el valor del secreto.
  readonly alternativaCapacidadId: string | null; // objetivo de degradación ALTERNATIVA (Art. 11)
  readonly cacheRef: string | null; // referencia de caché para degradación CACHE (Art. 11)
  readonly configVersion: number; // versión de configuración (Art. 7)
  readonly reemplazadaPor: string | null;
  readonly terminada: boolean; // ELIMINADA o REEMPLAZADA
}

export const EVENTOS_CAPACIDAD = {
  registrada: 'capacidad.registrada',
  configurada: 'capacidad.configurada',
  transicionada: 'capacidad.transicionada',
  modoCambiado: 'capacidad.modo_cambiado',
  saludRegistrada: 'capacidad.salud_registrada',
} as const;

export function capacidadStreamId(org: string, capacidadId: string): string {
  return `capacidad-externa:${org}:${capacidadId}`;
}

export function estadoInicialCapacidad(org: string, capacidadId: string): CapacidadState {
  return {
    organizationId: org,
    capacidadId,
    tipo: '',
    version: 0,
    existe: false,
    estado: 'REGISTRADA',
    modo: 'SIMULADA',
    salud: 'SALUDABLE',
    politicaDegradacion: null,
    proveedorRef: null,
    secretRef: null,
    alternativaCapacidadId: null,
    cacheRef: null,
    configVersion: 0,
    reemplazadaPor: null,
    terminada: false,
  };
}

/** Transiciones válidas del ciclo de vida (Art. 3). */
export function transicionCicloValida(desde: EstadoCapacidad, hacia: EstadoCapacidad): boolean {
  if (desde === 'ELIMINADA' || desde === 'REEMPLAZADA') return false; // terminales
  if (hacia === 'ELIMINADA' || hacia === 'REEMPLAZADA') return true; // se puede terminar desde cualquier no-terminal
  if (hacia === 'DESHABILITADA') return true; // se puede deshabilitar desde cualquier no-terminal
  if (hacia === 'PAUSADA') return desde === 'CONFIGURADA' || desde === 'HABILITADA' || desde === 'AUTORIZADA' || desde === 'EN_USO';
  const avance: Record<string, EstadoCapacidad> = {
    REGISTRADA: 'CONFIGURADA',
    CONFIGURADA: 'HABILITADA',
    HABILITADA: 'AUTORIZADA',
    AUTORIZADA: 'EN_USO',
  };
  if (avance[desde] === hacia) return true;
  // Recuperación desde estados de pausa/deshabilitación: vuelven a CONFIGURADA (deben rehabilitarse/reautorizarse).
  if ((desde === 'PAUSADA' || desde === 'DESHABILITADA') && hacia === 'CONFIGURADA') return true;
  return false;
}

export function aplicarCapacidad(state: CapacidadState, ev: RecordedEvent): CapacidadState {
  const next = { ...state, version: state.version + 1 };
  switch (ev.type) {
    case EVENTOS_CAPACIDAD.registrada: {
      const p = ev.payload as { tipo: string; politicaDegradacion: PoliticaDegradacion };
      return { ...next, existe: true, tipo: p.tipo, estado: 'REGISTRADA', modo: 'SIMULADA', salud: 'SALUDABLE', politicaDegradacion: p.politicaDegradacion };
    }
    case EVENTOS_CAPACIDAD.configurada: {
      const p = ev.payload as { proveedorRef: string; secretRef: string; politicaDegradacion: PoliticaDegradacion; configVersion: number; alternativaCapacidadId?: string | null; cacheRef?: string | null };
      return { ...next, proveedorRef: p.proveedorRef, secretRef: p.secretRef, politicaDegradacion: p.politicaDegradacion, alternativaCapacidadId: p.alternativaCapacidadId ?? null, cacheRef: p.cacheRef ?? null, configVersion: p.configVersion, estado: state.estado === 'REGISTRADA' || state.estado === 'PAUSADA' || state.estado === 'DESHABILITADA' ? 'CONFIGURADA' : state.estado };
    }
    case EVENTOS_CAPACIDAD.transicionada: {
      const p = ev.payload as { estado: EstadoCapacidad; reemplazadaPor?: string };
      const terminada = p.estado === 'ELIMINADA' || p.estado === 'REEMPLAZADA';
      // Kill-switch (Art. 8): pausar/deshabilitar/terminar vuelven a modo SIMULADA.
      const modo: ModoCapacidad = p.estado === 'PAUSADA' || p.estado === 'DESHABILITADA' || terminada ? 'SIMULADA' : next.modo;
      return { ...next, estado: p.estado, modo, terminada, reemplazadaPor: p.reemplazadaPor ?? state.reemplazadaPor };
    }
    case EVENTOS_CAPACIDAD.modoCambiado: {
      const p = ev.payload as { modo: ModoCapacidad };
      return { ...next, modo: p.modo };
    }
    case EVENTOS_CAPACIDAD.saludRegistrada: {
      const p = ev.payload as { salud: SaludCapacidad };
      // Fail-safe (Art. 13): NO_CONFIABLE en modo REAL → vuelve a SIMULADA.
      const modo: ModoCapacidad = p.salud === 'NO_CONFIABLE' && state.modo === 'REAL' ? 'SIMULADA' : state.modo;
      return { ...next, salud: p.salud, modo };
    }
    default:
      return next;
  }
}

export function reconstruirCapacidad(org: string, capacidadId: string, eventos: readonly RecordedEvent[]): CapacidadState {
  return eventos.reduce(aplicarCapacidad, estadoInicialCapacidad(org, capacidadId));
}

/** ¿Puede activarse en modo REAL? (Art. 3/13): EN_USO + refs configuradas + salud SALUDABLE. */
export function puedeActivarReal(state: CapacidadState): { ok: boolean; motivo: string } {
  if (state.estado !== 'EN_USO') return { ok: false, motivo: 'la capacidad debe estar EN_USO para activarse en modo REAL' };
  if (!state.proveedorRef || !state.secretRef) return { ok: false, motivo: 'faltan referencias de proveedor/secreto (configurar primero)' };
  if (state.salud !== 'SALUDABLE') return { ok: false, motivo: `la salud es ${state.salud}; sólo una capacidad SALUDABLE puede ir a REAL` };
  return { ok: true, motivo: '' };
}

/** Veredicto de consumibilidad. Si no es consumible, `degradacion` indica la política a aplicar (Art. 11). */
export interface VeredictoConsumo {
  readonly consumible: boolean;
  readonly motivo: string;
  readonly modo: ModoCapacidad;
  readonly degradada: boolean;
  readonly degradacion: PoliticaDegradacion | null;
}

/**
 * AUTORIDAD ÚNICA de consumibilidad (M4A-2, Art. 3/13). Todo consumidor (M4-C/D/M5…) DEBE usar esto en
 * lugar de re-derivar `estado === EN_USO && salud === …`. Consumible sólo si existe, no terminal, EN_USO y
 * salud ≠ NO_CONFIABLE. DEGRADADA es consumible pero con degradación declarada. En cualquier otro caso, no
 * es consumible y devuelve la política de degradación aplicable.
 */
export function esConsumible(state: CapacidadState): VeredictoConsumo {
  const base = { modo: state.modo, degradacion: state.politicaDegradacion } as const;
  if (!state.existe) return { consumible: false, motivo: 'la capacidad no existe', degradada: false, ...base };
  if (state.terminada) return { consumible: false, motivo: `capacidad ${state.estado} (terminal)`, degradada: false, ...base };
  if (state.estado !== 'EN_USO') return { consumible: false, motivo: `no está EN_USO (${state.estado})`, degradada: false, ...base };
  if (state.salud === 'NO_CONFIABLE') return { consumible: false, motivo: 'salud NO_CONFIABLE', degradada: true, ...base };
  return { consumible: true, motivo: '', degradada: state.salud === 'DEGRADADA', ...base };
}
