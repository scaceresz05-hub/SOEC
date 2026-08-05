/**
 * @soec/adaptadores · dominio · REGISTRO DE ADAPTADOR (M4-C-B). Agregado event-sourced, multi-tenant y
 * determinista que gobierna el CICLO DE VIDA OPERATIVO de un adaptador (no la máquina de estados de la
 * capacidad, que es de M4-A). SSOT del adaptador operativo: estado, versión de contrato/implementación,
 * salud operativa, circuit breaker, límites, revocación, expiración y baja lógica. Guarda a lo sumo una
 * `secretRef` (referencia opaca); NUNCA el valor, ni el nombre comercial del proveedor, ni payload de SDK.
 * El instante (`en`) se inyecta (sin reloj interno).
 */
import type { RecordedEvent } from '@soec/contracts';
import {
  CIRCUIT_BREAKER_CERRADO,
  type CompatibilidadAdaptador,
  type EstadoCircuitBreaker,
  type LimiteConcurrencia,
} from './operativo-tipos';
import type { DescriptorAdaptador } from './descriptor';
import type { NivelActivacion } from '../m4d/activacion';

export type EstadoRegistroAdaptador =
  | 'REGISTRADO'
  | 'CONFIGURADO'
  | 'HABILITADO'
  | 'AUTORIZADO'
  | 'PAUSADO'
  | 'REVOCADO'
  | 'EXPIRADO'
  | 'REEMPLAZADO'
  | 'ELIMINADO';

export type ModoRegistro = 'SIMULADO' | 'REAL';
export type SaludRegistro = 'DESCONOCIDA' | 'SALUDABLE' | 'DEGRADADA' | 'NO_CONFIABLE';

export interface RegistroAdaptador {
  readonly organizationId: string;
  readonly adaptadorId: string; // identificador LÓGICO (p. ej. 'generation-primary'); nunca comercial
  readonly capacidadId: string;
  readonly contratoId: string;
  readonly contratoVersion: string;
  readonly implementacionVersion: string;
  readonly estado: EstadoRegistroAdaptador;
  readonly modo: ModoRegistro;
  readonly secretRef: string | null;
  readonly salud: SaludRegistro;
  readonly compatibilidad: CompatibilidadAdaptador | null;
  readonly limites: LimiteConcurrencia | null;
  readonly circuitBreaker: EstadoCircuitBreaker;
  readonly expiraEn: string | null;
  readonly revocadoMotivo: string | null;
  readonly reemplazadoPor: string | null;
  readonly descriptor: DescriptorAdaptador | null; // autoridad de capacidades (M4-C-C)
  readonly nivelActivacion: NivelActivacion; // activación progresiva (M4-D); nace SIMULADO
  readonly creadoPor: string | null;
  readonly actualizadoPor: string | null;
  readonly existe: boolean;
  readonly terminada: boolean; // REEMPLAZADO o ELIMINADO
  readonly version: number; // versión de eventos
}

export const EVENTOS_ADAPTADOR = {
  registrado: 'adaptador.registrado',
  configurado: 'adaptador.configurado',
  habilitado: 'adaptador.habilitado',
  autorizado: 'adaptador.autorizado',
  modoCambiado: 'adaptador.modo_cambiado',
  pausado: 'adaptador.pausado',
  reanudado: 'adaptador.reanudado',
  revocado: 'adaptador.revocado',
  expirado: 'adaptador.expirado',
  reemplazado: 'adaptador.reemplazado',
  eliminado: 'adaptador.eliminado',
  saludRegistrada: 'adaptador.salud_registrada',
  breakerActualizado: 'adaptador.breaker_actualizado',
  versionCambiada: 'adaptador.version_cambiada',
  descriptorRegistrado: 'adaptador.descriptor_registrado',
  descriptorActualizado: 'adaptador.descriptor_actualizado',
  descriptorReemplazado: 'adaptador.descriptor_reemplazado',
  nivelCambiado: 'adaptador.nivel_cambiado',
} as const;

export function adaptadorStreamId(org: string, adaptadorId: string): string {
  return `adaptador:${org}:${adaptadorId}`;
}

export function estadoInicialAdaptadorRegistro(org: string, adaptadorId: string): RegistroAdaptador {
  return {
    organizationId: org,
    adaptadorId,
    capacidadId: '',
    contratoId: '',
    contratoVersion: '',
    implementacionVersion: '',
    estado: 'REGISTRADO',
    modo: 'SIMULADO',
    secretRef: null,
    salud: 'DESCONOCIDA',
    compatibilidad: null,
    limites: null,
    circuitBreaker: CIRCUIT_BREAKER_CERRADO,
    expiraEn: null,
    revocadoMotivo: null,
    reemplazadoPor: null,
    descriptor: null,
    nivelActivacion: 'SIMULADO',
    creadoPor: null,
    actualizadoPor: null,
    existe: false,
    terminada: false,
    version: 0,
  };
}

/** Matriz de transiciones del ciclo de vida operativo. Sin atajos. */
const TRANSICIONES: Readonly<Record<EstadoRegistroAdaptador, readonly EstadoRegistroAdaptador[]>> = {
  REGISTRADO: ['CONFIGURADO', 'ELIMINADO'],
  CONFIGURADO: ['HABILITADO', 'CONFIGURADO', 'PAUSADO', 'REVOCADO', 'EXPIRADO', 'REEMPLAZADO', 'ELIMINADO'],
  HABILITADO: ['AUTORIZADO', 'PAUSADO', 'REVOCADO', 'EXPIRADO', 'REEMPLAZADO', 'ELIMINADO'],
  AUTORIZADO: ['PAUSADO', 'REVOCADO', 'EXPIRADO', 'REEMPLAZADO', 'ELIMINADO'],
  PAUSADO: ['AUTORIZADO', 'REVOCADO', 'EXPIRADO', 'REEMPLAZADO', 'ELIMINADO'],
  REVOCADO: ['ELIMINADO'], // no vuelve a ejecutar sin nueva autorización/versionado (re-registro)
  EXPIRADO: ['REVOCADO', 'REEMPLAZADO', 'ELIMINADO'],
  REEMPLAZADO: [], // terminal para consumo
  ELIMINADO: [], // baja lógica, terminal
};

export function transicionOperativaValida(desde: EstadoRegistroAdaptador, hacia: EstadoRegistroAdaptador): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hacia);
}

export function aplicarAdaptador(state: RegistroAdaptador, ev: RecordedEvent): RegistroAdaptador {
  const next = { ...state, version: state.version + 1 };
  const p = ev.payload as Record<string, unknown>;
  const actor = (p.actor as string) ?? (p.actorHumano as string) ?? state.actualizadoPor;
  switch (ev.type) {
    case EVENTOS_ADAPTADOR.registrado:
      return {
        ...next,
        existe: true,
        estado: 'REGISTRADO',
        capacidadId: p.capacidadId as string,
        contratoId: p.contratoId as string,
        contratoVersion: p.contratoVersion as string,
        implementacionVersion: p.implementacionVersion as string,
        creadoPor: p.creadoPor as string,
        actualizadoPor: p.creadoPor as string,
      };
    case EVENTOS_ADAPTADOR.configurado:
      return {
        ...next,
        estado: 'CONFIGURADO',
        compatibilidad: (p.compatibilidad as CompatibilidadAdaptador) ?? state.compatibilidad,
        limites: (p.limites as LimiteConcurrencia) ?? state.limites,
        secretRef: (p.secretRef as string | null) ?? state.secretRef,
        expiraEn: (p.expiraEn as string | null) ?? state.expiraEn,
        actualizadoPor: actor,
      };
    case EVENTOS_ADAPTADOR.habilitado:
      return { ...next, estado: 'HABILITADO', actualizadoPor: actor };
    case EVENTOS_ADAPTADOR.autorizado:
      return { ...next, estado: 'AUTORIZADO', actualizadoPor: actor };
    case EVENTOS_ADAPTADOR.modoCambiado:
      return { ...next, modo: p.modo as ModoRegistro, actualizadoPor: actor };
    case EVENTOS_ADAPTADOR.pausado:
      return { ...next, estado: 'PAUSADO', actualizadoPor: actor };
    case EVENTOS_ADAPTADOR.reanudado:
      return { ...next, estado: 'AUTORIZADO', actualizadoPor: actor };
    case EVENTOS_ADAPTADOR.revocado:
      return { ...next, estado: 'REVOCADO', modo: 'SIMULADO', revocadoMotivo: p.motivo as string, actualizadoPor: actor };
    case EVENTOS_ADAPTADOR.expirado:
      return { ...next, estado: 'EXPIRADO', modo: 'SIMULADO', actualizadoPor: actor };
    case EVENTOS_ADAPTADOR.reemplazado:
      return { ...next, estado: 'REEMPLAZADO', terminada: true, reemplazadoPor: p.porAdaptadorId as string, actualizadoPor: actor };
    case EVENTOS_ADAPTADOR.eliminado:
      return { ...next, estado: 'ELIMINADO', terminada: true, modo: 'SIMULADO', actualizadoPor: actor };
    case EVENTOS_ADAPTADOR.saludRegistrada:
      return { ...next, salud: p.salud as SaludRegistro };
    case EVENTOS_ADAPTADOR.breakerActualizado:
      return { ...next, circuitBreaker: p.circuitBreaker as EstadoCircuitBreaker };
    case EVENTOS_ADAPTADOR.versionCambiada:
      return {
        ...next,
        contratoVersion: (p.contratoVersion as string) ?? state.contratoVersion,
        implementacionVersion: (p.implementacionVersion as string) ?? state.implementacionVersion,
        compatibilidad: (p.compatibilidad as CompatibilidadAdaptador) ?? state.compatibilidad,
        actualizadoPor: actor,
      };
    case EVENTOS_ADAPTADOR.descriptorRegistrado:
    case EVENTOS_ADAPTADOR.descriptorActualizado:
    case EVENTOS_ADAPTADOR.descriptorReemplazado:
      return { ...next, descriptor: p.descriptor as DescriptorAdaptador, actualizadoPor: actor };
    case EVENTOS_ADAPTADOR.nivelCambiado:
      return { ...next, nivelActivacion: p.nivel as NivelActivacion, actualizadoPor: actor };
    default:
      return next;
  }
}

export function reconstruirAdaptador(org: string, adaptadorId: string, eventos: readonly RecordedEvent[]): RegistroAdaptador {
  return eventos.reduce(aplicarAdaptador, estadoInicialAdaptadorRegistro(org, adaptadorId));
}

/**
 * Autorización de CICLO DE VIDA del adaptador (complementa a `esConsumible` de la capacidad, no la
 * reemplaza). Sólo un adaptador AUTORIZADO, no terminal, no revocado, no expirado y no pausado está
 * operativamente autorizado. `ahora` (ISO) se inyecta para evaluar la expiración sin reloj interno.
 * La salud (fail-safe) y el circuit breaker son gates RUNTIME SEPARADOS (los evalúa el orquestador con
 * `efectoSalud` y `evaluarBreaker`), para distinguir su causa (`NO_DISPONIBLE`) del rechazo de autorización.
 */
export function puedeConsumirOperativo(reg: RegistroAdaptador, ahora: string): { ok: boolean; motivo: string } {
  if (!reg.existe) return { ok: false, motivo: 'adaptador no existe' };
  if (reg.terminada) return { ok: false, motivo: `adaptador ${reg.estado} (terminal)` };
  if (reg.estado === 'REVOCADO') return { ok: false, motivo: 'adaptador REVOCADO' };
  if (reg.estado === 'EXPIRADO' || (reg.expiraEn !== null && reg.expiraEn <= ahora)) return { ok: false, motivo: 'adaptador EXPIRADO' };
  if (reg.estado === 'PAUSADO') return { ok: false, motivo: 'adaptador PAUSADO' };
  if (reg.estado !== 'AUTORIZADO') return { ok: false, motivo: `adaptador no AUTORIZADO (${reg.estado})` };
  return { ok: true, motivo: '' };
}
