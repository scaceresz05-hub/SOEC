/**
 * @soec/motor-estrategico · CONTRATOS (puertos).
 *
 * Fronteras explícitas entre el PRODUCTOR de conocimiento (M5) y sus CONSUMIDORES (M6–M9). Los bloques
 * posteriores dependen de `LecturaConocimiento` (solo lectura + evaluación) y NUNCA de la implementación
 * ni de la escritura: así consumen el conocimiento sin poder modificarlo (Bloque Maestro: «M5 produce,
 * los demás consumen»). La escritura vive en `EscrituraConocimiento`, reservada a los flujos que ingresan
 * conocimiento. El servicio implementa ambos; un consumidor solo debería recibir el puerto de lectura.
 */
import type { Attribution, RequestContext } from '@soec/contracts';
import type { AfirmacionState, ClaseAfirmacion, SujetoRef, TipoEnlace } from '../dominio/afirmacion';
import type { EntradaIndice } from '../dominio/indice';
import type { Sentido, TipoEvidencia } from '../nucleo/evidencia';
import type { Evaluacion, PoliticaEvaluacion } from '../nucleo/evaluar';

/** Una afirmación con su veredicto DERIVADO (nunca almacenado): conocimiento + su consecuencia. */
export interface AfirmacionEvaluada {
  readonly afirmacion: AfirmacionState;
  readonly evaluacion: Evaluacion;
}

/** Datos para aportar una evidencia (el servicio completa procedencia/pertinencia y la sella). */
export interface EntradaEvidencia {
  readonly evidenciaId: string;
  readonly enunciado: string;
  readonly origen: TipoEvidencia;
  readonly sentido: Sentido;
  readonly pertinente: boolean;
  readonly motivoPertinencia?: string | null;
  readonly fuente?: string | null;
}

/**
 * PUERTO DE LECTURA — lo único que M6–M9 necesitan. Solo lectura y evaluación; no puede mutar el estado.
 * Contratos del Bloque Maestro cubiertos: lectura, evaluación, consultas.
 */
export interface LecturaConocimiento {
  /** Lectura: reconstruye una afirmación por replay. */
  cargar(ctx: RequestContext, afirmacionId: string): Promise<AfirmacionState>;
  /** Evaluación: deriva el estado de evaluabilidad en el momento (no lo almacena). */
  evaluar(ctx: RequestContext, afirmacionId: string, politica?: PoliticaEvaluacion): Promise<AfirmacionEvaluada>;
  /** Consultas: lista el índice de conocimiento de la organización (opcionalmente por clase). */
  listar(ctx: RequestContext, clase?: ClaseAfirmacion): Promise<readonly EntradaIndice[]>;
}

/**
 * PUERTO DE ESCRITURA — reservado a los flujos que INGRESAN conocimiento. Cubre los contratos de
 * escritura, actualización y evidencia. Un consumidor M6–M9 no debería recibir este puerto.
 */
export interface EscrituraConocimiento {
  /** Escritura: registra una afirmación estratégica (idempotente por id). */
  registrar(
    ctx: RequestContext,
    afirmacionId: string,
    clase: ClaseAfirmacion,
    enunciado: string,
    a: Attribution,
    o: string,
    opts?: { sujetoRef?: SujetoRef },
  ): Promise<void>;
  /** Evidencia: aporta una pieza de evidencia (a favor / en contra, con pertinencia declarada). */
  agregarEvidencia(
    ctx: RequestContext,
    afirmacionId: string,
    evidencia: EntradaEvidencia,
    a: Attribution,
    o: string,
  ): Promise<void>;
  /** Actualización: enlaza esta afirmación con otra existente de la misma organización (relación tipada). */
  enlazar(
    ctx: RequestContext,
    afirmacionId: string,
    tipo: TipoEnlace,
    hacia: string,
    a: Attribution,
    o: string,
    opts?: { nota?: string },
  ): Promise<void>;
  /** Actualización: asocia (o corrige) el sujeto descriptivo referido (perfil crm / ítem negocio / hipótesis). */
  asignarSujeto(ctx: RequestContext, afirmacionId: string, sujeto: SujetoRef, a: Attribution, o: string): Promise<void>;
  /** Actualización: retira una afirmación del cómputo (conserva su historia). */
  retirar(ctx: RequestContext, afirmacionId: string, motivo: string, a: Attribution, o: string): Promise<void>;
}
