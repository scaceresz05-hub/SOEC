/**
 * @soec/estrategia-creativa · dominio · ARTEFACTO de estrategia creativa de PRIMERA CLASE (Tramo D).
 *
 * Persiste la estrategia creativa como agregado versionado y trazable, ligado a programa/objetivo/
 * segmento/hipótesis/brief. Regla dura: toda afirmación comercial se vincula a evidencia; NO se
 * inventan funcionalidades, precios, testimonios, resultados ni integraciones. Sin respaldo → se
 * excluye la afirmación (o se abstiene). La prueba social solo se permite si hay evidencia real (aquí,
 * por diseño simulado, NO hay testimonios → false). Cambios generan nueva versión. Naturaleza SIMULADO.
 */
import type { RecordedEvent } from '@soec/contracts';
import type { Confianza } from '@soec/negocio';
import type { ConocimientoComercialState, EntidadComercial, HipotesisState } from '@soec/crm-comercial';
import { evaluarHipotesis } from '@soec/crm-comercial';
import type { BriefComercial, EstrategiaCreativa } from './estrategia-creativa';

export interface ArtefactoEstrategiaCreativa {
  readonly estrategiaCreativaId: string;
  readonly organizationId: string;
  readonly programaId: string;
  readonly objetivoId: string;
  readonly segmentoId: string;
  readonly hipotesisId: string;
  readonly briefId: string;
  readonly concepto: string;
  readonly angulo: string;
  readonly gancho: string;
  readonly mensajesClave: readonly string[];
  readonly tono: string;
  readonly cta: string;
  readonly objeciones: readonly string[];
  readonly respuestaObjeciones: readonly string[];
  readonly pruebaSocialPermitida: boolean;
  readonly afirmacionesPermitidas: readonly string[];
  readonly restricciones: readonly string[];
  readonly evidencias: readonly string[];
  readonly confianza: Confianza;
  readonly faltantes: readonly string[];
  readonly politicaVersion: string;
  readonly naturaleza: 'SIMULADO';
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ArtefactoCreativoState {
  readonly organizationId: string;
  readonly estrategiaCreativaId: string;
  readonly version: number;
  readonly existe: boolean;
  readonly artefacto: ArtefactoEstrategiaCreativa | null;
}

export const EVENTOS_ARTEFACTO = { registrada: 'creativa.artefacto_registrado', actualizada: 'creativa.artefacto_actualizado' } as const;

export function artefactoCreativoStreamId(org: string, estrategiaCreativaId: string): string {
  return `creativa-artefacto:${org}:${estrategiaCreativaId}`;
}

export function estrategiaCreativaId(programaId: string, hipotesisId: string): string {
  return `estcr-${programaId}-${hipotesisId}`;
}

function valor(ent: EntidadComercial | null, clave: string): string | null {
  const v = ent?.campos[clave]?.valor;
  return v && v.trim() ? v.trim() : null;
}
function procedencia(ent: EntidadComercial | null, clave: string): string | null {
  const c = ent?.campos[clave];
  return c ? `${ent!.tipo}.${clave} (${c.origen})` : null;
}

export interface ContenidoArtefacto {
  readonly programaId: string;
  readonly objetivoId: string;
  readonly segmentoId: string;
  readonly hipotesisId: string;
  readonly briefId: string;
  readonly concepto: string;
  readonly angulo: string;
  readonly gancho: string;
  readonly mensajesClave: readonly string[];
  readonly tono: string;
  readonly cta: string;
  readonly objeciones: readonly string[];
  readonly respuestaObjeciones: readonly string[];
  readonly pruebaSocialPermitida: boolean;
  readonly afirmacionesPermitidas: readonly string[];
  readonly restricciones: readonly string[];
  readonly evidencias: readonly string[];
  readonly confianza: Confianza;
  readonly faltantes: readonly string[];
  readonly politicaVersion: string;
}

/** Claves de CONTENIDO del artefacto (excluye metadata: id/org/version/naturaleza/timestamps). */
const CLAVES_CONTENIDO: readonly (keyof ContenidoArtefacto)[] = [
  'programaId', 'objetivoId', 'segmentoId', 'hipotesisId', 'briefId', 'concepto', 'angulo', 'gancho',
  'mensajesClave', 'tono', 'cta', 'objeciones', 'respuestaObjeciones', 'pruebaSocialPermitida',
  'afirmacionesPermitidas', 'restricciones', 'evidencias', 'confianza', 'faltantes', 'politicaVersion',
];

/**
 * Serialización CANÓNICA del contenido del artefacto: proyecta sólo las claves de contenido, en orden
 * fijo, con arrays serializados por su contenido. Estable frente a orden de inserción y a la metadata
 * (version/timestamps/naturaleza) — de modo que re-derivar un contenido idéntico compara igual (B-1).
 */
export function contenidoArtefactoCanonico(x: ContenidoArtefacto | ArtefactoEstrategiaCreativa): string {
  return JSON.stringify(CLAVES_CONTENIDO.map((k) => (x as Record<string, unknown>)[k] ?? null));
}

/**
 * Deriva el CONTENIDO del artefacto desde el conocimiento + brief + estrategia + una hipótesis. Solo
 * incorpora afirmaciones con procedencia; nunca inventa prueba social/testimonios (pruebaSocialPermitida
 * = false salvo evidencia real, inexistente en modo simulado).
 */
export function derivarContenidoArtefacto(
  state: ConocimientoComercialState,
  brief: BriefComercial,
  estrategia: EstrategiaCreativa,
  hip: HipotesisState,
  ids: { programaId: string; objetivoId: string; segmentoId: string; briefId: string; politicaVersion: string },
): ContenidoArtefacto {
  const empresa = state.empresa;
  const producto = Object.values(state.entidades).find((e) => e.tipo === 'PRODUCTO') ?? null;
  const icp = Object.values(state.entidades).find((e) => e.tipo === 'CLIENTE_IDEAL') ?? null;

  // Afirmaciones SOLO si tienen procedencia (evidencia).
  const afirmaciones: string[] = [];
  const evidencias: string[] = [];
  const agregar = (ent: EntidadComercial | null, clave: string, texto: string | null) => {
    const p = procedencia(ent, clave);
    if (texto && p) {
      afirmaciones.push(texto);
      evidencias.push(p);
    }
  };
  agregar(empresa, 'propuestaValor', valor(empresa, 'propuestaValor'));
  agregar(producto, 'beneficios', valor(producto, 'beneficios'));
  agregar(producto, 'problemaQueResuelve', `resuelve: ${valor(producto, 'problemaQueResuelve')}`);

  const objeciones = valor(icp, 'objeciones') ? [valor(icp, 'objeciones')!] : [];
  const ev = evaluarHipotesis(hip);

  return {
    programaId: ids.programaId,
    objetivoId: ids.objetivoId,
    segmentoId: ids.segmentoId,
    hipotesisId: hip.hipotesisId,
    briefId: ids.briefId,
    concepto: estrategia.concepto,
    angulo: estrategia.angulo,
    gancho: estrategia.gancho,
    mensajesClave: estrategia.mensajesClave,
    tono: estrategia.tono,
    cta: estrategia.mensajesClave[0] ?? 'Solicita más información',
    objeciones,
    respuestaObjeciones: [], // no se inventan respuestas sin respaldo
    pruebaSocialPermitida: false, // sin evidencia de testimonios (modo simulado) → nunca se inventa
    afirmacionesPermitidas: afirmaciones,
    restricciones: [`no afirmar más allá de la evidencia (${evidencias.length} fuentes)`],
    evidencias,
    confianza: ev.confianza,
    faltantes: ev.faltantes,
    politicaVersion: ids.politicaVersion,
  };
}

export function estadoInicialArtefacto(org: string, id: string): ArtefactoCreativoState {
  return { organizationId: org, estrategiaCreativaId: id, version: 0, existe: false, artefacto: null };
}

export function aplicarArtefacto(state: ArtefactoCreativoState, event: RecordedEvent): ArtefactoCreativoState {
  const next = { ...state, version: state.version + 1 };
  if (event.type === EVENTOS_ARTEFACTO.registrada || event.type === EVENTOS_ARTEFACTO.actualizada) {
    const c = event.payload as ContenidoArtefacto;
    const prev = state.artefacto;
    const artefacto: ArtefactoEstrategiaCreativa = {
      estrategiaCreativaId: state.estrategiaCreativaId,
      organizationId: state.organizationId,
      ...c,
      naturaleza: 'SIMULADO',
      version: (prev?.version ?? 0) + 1,
      createdAt: prev?.createdAt ?? event.recordedAt,
      updatedAt: event.recordedAt,
    };
    return { ...next, existe: true, artefacto };
  }
  return next;
}

export function reconstruirArtefacto(org: string, id: string, events: readonly RecordedEvent[]): ArtefactoCreativoState {
  return events.reduce(aplicarArtefacto, estadoInicialArtefacto(org, id));
}
