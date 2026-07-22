/**
 * Organización piloto (F2-PILOT-01 §4–§7, §9). Agregado GENÉRICO (no pertenece a
 * marketing) que representa la preparación operacional de una organización:
 * identidad + estado + departamentos + onboarding reanudable + perfil operacional +
 * presupuesto de piloto + conexiones previstas. No exige datos reales; distingue dato
 * real / sintético / pendiente / no aplicable, y nunca inventa lo faltante.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { Entorno } from './entorno';

export type EstadoOrganizacion =
  | 'borrador'
  | 'en_onboarding'
  | 'configuracion_incompleta'
  | 'lista_para_ensayo'
  | 'ensayo_en_curso'
  | 'lista_para_activacion'
  | 'activacion_pendiente'
  | 'activa'
  | 'pausada'
  | 'suspendida'
  | 'cerrada';

export type ClaseDato = 'real' | 'sintetico' | 'pendiente' | 'no_aplicable';

export interface IdentidadOrganizacion {
  readonly nombreComercial: string;
  readonly nombreLegal: string;
  readonly identificadorTributario: string | null; // opcional; no se exige para fixtures
  readonly pais: string;
  readonly territorio: string;
  readonly zonaHoraria: string;
  readonly idioma: string;
  readonly moneda: string;
  readonly sector: string;
  readonly tamano: string;
  readonly responsables: readonly { nombre: string; rol: string; contacto: string }[];
  readonly claseDatos: ClaseDato; // sintético en este bloque
}

export type EtapaOnboarding =
  | 'identidad'
  | 'responsables'
  | 'contexto'
  | 'marca'
  | 'objetivos'
  | 'audiencia'
  | 'canales'
  | 'presupuesto'
  | 'politicas'
  | 'autonomia'
  | 'horarios'
  | 'aprobaciones'
  | 'pausa'
  | 'medicion'
  | 'exito'
  | 'suspension'
  | 'revision';

export const ETAPAS: readonly EtapaOnboarding[] = ['identidad', 'responsables', 'contexto', 'marca', 'objetivos', 'audiencia', 'canales', 'presupuesto', 'politicas', 'autonomia', 'horarios', 'aprobaciones', 'pausa', 'medicion', 'exito', 'suspension', 'revision'];

export type EstadoEtapa = 'pendiente' | 'incompleta' | 'completa' | 'no_aplicable';

export interface EtapaState {
  readonly estado: EstadoEtapa;
  readonly datos: Readonly<Record<string, string>>;
  readonly faltantes: readonly string[];
  readonly responsable: string;
  readonly en: string;
}

export interface PerfilOperacional {
  readonly departamentoPiloto: string; // 'marketing' es el primero, pero el contrato no se cierra a marketing
  readonly capacidades: readonly string[];
  readonly actividadesPermitidas: readonly string[];
  readonly actividadesProhibidas: readonly string[];
  readonly canales: readonly string[];
  readonly modo: Entorno;
  readonly nivelAutonomia: number;
  readonly ventanaOperacional: string;
  readonly volumenMaximo: number;
  readonly frecuenciaMaxima: number;
  readonly duracionDias: number;
}

export interface PresupuestoPiloto {
  readonly moneda: string;
  readonly produccion: number;
  readonly distribucion: number;
  readonly publicidad: number;
  readonly integracion: number;
  readonly contingencia: number;
  readonly limiteTotal: number;
  readonly limiteDiario: number;
  readonly comprometido: number;
  readonly reservado: number;
  /** Gasto SINTÉTICO/emulado. El gasto REAL permanece en cero durante este bloque. */
  readonly ejecutadoSintetico: number;
  readonly ejecutadoReal: 0;
}

export type EstadoConexion = 'no_configurada' | 'declarada' | 'pendiente_credencial' | 'pendiente_permisos' | 'lista_para_verificar' | 'verificada_sandbox' | 'preparada_para_real' | 'revocada' | 'invalida' | 'bloqueada';

export interface ConexionPrevista {
  readonly proveedor: string;
  readonly canal: string;
  readonly cuentaLogica: string;
  readonly entorno: Entorno;
  readonly credencialRef: string | null; // referencia; NUNCA el token
  readonly capacidades: readonly string[];
  readonly permisosRequeridos: readonly string[];
  readonly permisosConcedidos: readonly string[];
  readonly estado: EstadoConexion;
}

export const EVENTOS_ORG = {
  registrada: 'org.registrada',
  etapa: 'org.etapa_actualizada',
  perfil: 'org.perfil_definido',
  presupuesto: 'org.presupuesto_definido',
  conexion: 'org.conexion_declarada',
  politicaAceptada: 'org.politica_aceptada',
  transicion: 'org.estado_transicion',
} as const;

export function orgStreamId(orgId: string): string {
  return `org:${orgId}`;
}

export interface OrgState {
  readonly orgId: string;
  readonly organizationId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly identidad: IdentidadOrganizacion | null;
  readonly estado: EstadoOrganizacion;
  readonly departamentos: readonly string[];
  readonly etapas: Readonly<Partial<Record<EtapaOnboarding, EtapaState>>>;
  readonly perfil: PerfilOperacional | null;
  readonly presupuesto: PresupuestoPiloto | null;
  readonly conexiones: Readonly<Record<string, ConexionPrevista>>;
  readonly politicaAceptadaVersion: number | null;
}

export function estadoInicialOrg(orgId: string, organizationId: string): OrgState {
  return { orgId, organizationId, version: 0, existe: false, identidad: null, estado: 'borrador', departamentos: [], etapas: {}, perfil: null, presupuesto: null, conexiones: {}, politicaAceptadaVersion: null };
}

const TRANSICIONES: Readonly<Record<EstadoOrganizacion, readonly EstadoOrganizacion[]>> = {
  borrador: ['en_onboarding', 'cerrada'],
  en_onboarding: ['configuracion_incompleta', 'lista_para_ensayo', 'cerrada'],
  configuracion_incompleta: ['en_onboarding', 'lista_para_ensayo', 'cerrada'],
  lista_para_ensayo: ['ensayo_en_curso', 'en_onboarding', 'cerrada'],
  ensayo_en_curso: ['lista_para_ensayo', 'lista_para_activacion', 'suspendida', 'cerrada'],
  lista_para_activacion: ['activacion_pendiente', 'ensayo_en_curso', 'pausada', 'cerrada'],
  // 'activa' en modo real es inalcanzable en este bloque (guardarraíl en el servicio de activación).
  activacion_pendiente: ['lista_para_activacion', 'pausada', 'cerrada'],
  activa: ['pausada', 'suspendida', 'cerrada'],
  pausada: ['lista_para_activacion', 'suspendida', 'cerrada'],
  suspendida: ['cerrada'],
  cerrada: [],
};
export function transicionOrgValida(desde: EstadoOrganizacion, hacia: EstadoOrganizacion): boolean {
  if (desde === hacia) return true;
  return (TRANSICIONES[desde] ?? []).includes(hacia);
}

interface PReg {
  identidad: IdentidadOrganizacion;
  departamentos: string[];
}
interface PEtapa {
  etapa: EtapaOnboarding;
  estado: EstadoEtapa;
  datos: Record<string, string>;
  faltantes: string[];
  responsable: string;
}
interface PPerfil {
  perfil: PerfilOperacional;
}
interface PPres {
  presupuesto: PresupuestoPiloto;
}
interface PConex {
  conexion: ConexionPrevista;
}
interface PPol {
  version: number;
}
interface PTrans {
  nuevoEstado: EstadoOrganizacion;
}

export function aplicarOrg(state: OrgState, event: RecordedEvent): OrgState {
  const next = { ...state, version: state.version + 1 };
  switch (event.type) {
    case EVENTOS_ORG.registrada: {
      const p = event.payload as PReg;
      return { ...next, existe: true, identidad: p.identidad, departamentos: p.departamentos, estado: 'en_onboarding' };
    }
    case EVENTOS_ORG.etapa: {
      const p = event.payload as PEtapa;
      return { ...next, etapas: { ...state.etapas, [p.etapa]: { estado: p.estado, datos: p.datos, faltantes: p.faltantes, responsable: p.responsable, en: event.recordedAt } } };
    }
    case EVENTOS_ORG.perfil:
      return { ...next, perfil: (event.payload as PPerfil).perfil };
    case EVENTOS_ORG.presupuesto:
      return { ...next, presupuesto: (event.payload as PPres).presupuesto };
    case EVENTOS_ORG.conexion: {
      const p = event.payload as PConex;
      return { ...next, conexiones: { ...state.conexiones, [`${p.conexion.canal}:${p.conexion.cuentaLogica}`]: p.conexion } };
    }
    case EVENTOS_ORG.politicaAceptada:
      return { ...next, politicaAceptadaVersion: (event.payload as PPol).version };
    case EVENTOS_ORG.transicion: {
      const p = event.payload as PTrans;
      if (!transicionOrgValida(state.estado, p.nuevoEstado)) return next;
      return { ...next, estado: p.nuevoEstado };
    }
    default:
      return next;
  }
}

export function reconstruirOrg(orgId: string, organizationId: string, events: readonly RecordedEvent[]): OrgState {
  return events.reduce(aplicarOrg, estadoInicialOrg(orgId, organizationId));
}

const OBLIGATORIOS_IDENTIDAD: ReadonlyArray<keyof IdentidadOrganizacion> = ['nombreComercial', 'pais', 'zonaHoraria', 'idioma', 'moneda'];
export function validarIdentidad(i: IdentidadOrganizacion): string[] {
  return OBLIGATORIOS_IDENTIDAD.filter((k) => { const v = i[k]; return typeof v === 'string' ? v.trim() === '' : v == null; }).map(String);
}
