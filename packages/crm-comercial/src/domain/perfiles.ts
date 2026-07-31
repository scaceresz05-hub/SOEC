/**
 * @soec/crm-comercial · dominio · Perfiles comerciales TIPADOS.
 *
 * Extiende el almacén libre de `@soec/negocio` (atributos `Record<string,string>` sin esquema ni
 * procedencia por campo) con: (a) un ESQUEMA de campos esperados por tipo de entidad comercial, y
 * (b) PROCEDENCIA epistémica por campo (origen + confianza + fuente), y (c) faltantes de primera
 * clase. Así SOEC puede comprender un negocio y, sobre todo, saber QUÉ le falta saber (Evaluabilidad).
 * Event-sourced sobre stream `conocimiento-comercial:<org>`; la última versión por campo gobierna.
 */
import type { RecordedEvent } from '@soec/contracts';
import { type Confianza, type TipoEvidencia, confianzaPorDefecto } from '@soec/negocio';

export type TipoPerfil = 'EMPRESA' | 'PRODUCTO' | 'SERVICIO' | 'CLIENTE_IDEAL' | 'COMPETIDOR' | 'MERCADO';

/** Un dato comercial con su procedencia: nunca un valor "pelado" sin saber de dónde viene. */
export interface Campo {
  readonly valor: string;
  readonly origen: TipoEvidencia;
  readonly confianza: Confianza;
  readonly fuente: string | null;
}

export function campo(valor: string, origen: TipoEvidencia, fuente: string | null = null): Campo {
  return { valor, origen, confianza: confianzaPorDefecto(origen), fuente };
}

/** Esquema de campos ESPERADOS por tipo (la "forma" del conocimiento comercial que SOEC persigue). */
export const ESQUEMAS: Record<TipoPerfil, readonly string[]> = {
  EMPRESA: ['historia', 'rubro', 'tamano', 'objetivos', 'propuestaValor', 'fortalezas', 'debilidades', 'ventajas', 'restricciones', 'politicas'],
  PRODUCTO: ['problemaQueResuelve', 'paraQuien', 'objeciones', 'beneficios', 'diferenciadores', 'competidores', 'margen', 'prioridad', 'cicloVenta', 'material', 'estado'],
  SERVICIO: ['problemaQueResuelve', 'paraQuien', 'objeciones', 'beneficios', 'diferenciadores', 'competidores', 'margen', 'prioridad', 'cicloVenta', 'material', 'estado'],
  CLIENTE_IDEAL: ['problemas', 'dolores', 'objetivos', 'miedos', 'motivaciones', 'objeciones', 'preguntasFrecuentes', 'capacidadEconomica', 'comportamientoDigital', 'redes', 'horarios', 'estacionalidad'],
  COMPETIDOR: ['fortalezas', 'debilidades', 'precios', 'contenido', 'seo', 'sem', 'redes', 'propuestaComercial', 'tipoCampanas', 'frecuencia', 'landingPages', 'embudos'],
  MERCADO: ['tendencias', 'estacionalidad', 'demanda', 'oportunidades', 'amenazas', 'palabrasClave', 'busquedas', 'eventos', 'cambiosRegulatorios'],
} as const;

export function claveValida(tipo: TipoPerfil, clave: string): boolean {
  return ESQUEMAS[tipo].includes(clave);
}

export interface FaltantePerfil {
  readonly sobre: string;
  readonly motivo: string;
}

export interface EntidadComercial {
  readonly id: string;
  readonly tipo: TipoPerfil;
  readonly nombre: string;
  readonly campos: Readonly<Record<string, Campo>>;
  readonly faltantes: readonly FaltantePerfil[];
}

export interface ConocimientoComercialState {
  readonly organizacionId: string;
  readonly version: number;
  /** Perfil de empresa: singleton (id fijo 'empresa'). */
  readonly empresa: EntidadComercial | null;
  readonly entidades: Readonly<Record<string, EntidadComercial>>;
}

export const ID_EMPRESA = 'empresa';

export const EVENTOS_PERFIL = {
  registrada: 'perfil.entidad_registrada',
  campo: 'perfil.campo_establecido',
  faltante: 'perfil.faltante_declarado',
} as const;

export function conocimientoComercialStreamId(organizacionId: string): string {
  return `conocimiento-comercial:${organizacionId}`;
}

export function estadoInicialConocimientoComercial(organizacionId: string): ConocimientoComercialState {
  return { organizacionId, version: 0, empresa: null, entidades: {} };
}

interface PRegistrada {
  id: string;
  tipo: TipoPerfil;
  nombre: string;
}
interface PCampo {
  id: string;
  clave: string;
  campo: Campo;
}
interface PFaltante {
  id: string;
  sobre: string;
  motivo: string;
}

function obtener(state: ConocimientoComercialState, id: string): EntidadComercial | null {
  return id === ID_EMPRESA ? state.empresa : (state.entidades[id] ?? null);
}
function guardar(state: ConocimientoComercialState, ent: EntidadComercial): ConocimientoComercialState {
  if (ent.id === ID_EMPRESA) return { ...state, empresa: ent };
  return { ...state, entidades: { ...state.entidades, [ent.id]: ent } };
}

export function aplicarConocimientoComercial(state: ConocimientoComercialState, event: RecordedEvent): ConocimientoComercialState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_PERFIL.registrada: {
      const p = event.payload as PRegistrada;
      if (obtener(state, p.id)) return next; // idempotente
      const ent: EntidadComercial = { id: p.id, tipo: p.tipo, nombre: p.nombre, campos: {}, faltantes: [] };
      return { ...guardar(next, ent) };
    }
    case EVENTOS_PERFIL.campo: {
      const p = event.payload as PCampo;
      const ent = obtener(state, p.id);
      if (!ent) return next;
      return { ...guardar(next, { ...ent, campos: { ...ent.campos, [p.clave]: p.campo } }) };
    }
    case EVENTOS_PERFIL.faltante: {
      const p = event.payload as PFaltante;
      const ent = obtener(state, p.id);
      if (!ent) return next;
      return { ...guardar(next, { ...ent, faltantes: [...ent.faltantes, { sobre: p.sobre, motivo: p.motivo }] }) };
    }
    default:
      return next;
  }
}

export function reconstruirConocimientoComercial(organizacionId: string, events: readonly RecordedEvent[]): ConocimientoComercialState {
  return events.reduce(aplicarConocimientoComercial, estadoInicialConocimientoComercial(organizacionId));
}

/** Cobertura del conocimiento de una entidad: qué campos del esquema están y cuáles faltan. */
export interface Cobertura {
  readonly tipo: TipoPerfil;
  readonly esperados: readonly string[];
  readonly presentes: readonly string[];
  readonly faltantes: readonly string[];
  /** Fracción 0..1 de campos del esquema con dato. */
  readonly completitud: number;
}

export function coberturaDe(ent: EntidadComercial): Cobertura {
  const esperados = ESQUEMAS[ent.tipo];
  const presentes = esperados.filter((k) => k in ent.campos);
  const faltantes = esperados.filter((k) => !(k in ent.campos));
  return { tipo: ent.tipo, esperados, presentes, faltantes, completitud: esperados.length === 0 ? 1 : presentes.length / esperados.length };
}
