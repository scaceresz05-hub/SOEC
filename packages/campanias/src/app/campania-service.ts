/**
 * Servicio de campañas gobernadas (Bloque C). Una campaña SOLO nace de una decisión de
 * marketing válida y de la MISMA organización. Aplica los invariantes de gobierno antes de
 * emitir el evento `campania.creada`:
 *
 *  1. No huérfana: la decisión referenciada debe existir.
 *  2. Separación multi-tenant: la decisión debe pertenecer a la organización del contexto.
 *  3. Ejecutabilidad: si la política exige aprobación, la decisión debe estar APROBADA
 *     (ejecutable). Una decisión NO_EVALUABLE nunca deriva campaña.
 *  4. Presupuesto compatible: no puede exceder `politica.presupuestoMaximo`.
 *  5. Experimentalidad: sin hipótesis solo se admite si la política lo permite explícitamente.
 *
 * Event-sourced (`campania:<org>:<id>`).
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import { DecisionMktService, esEjecutable } from '@soec/decisiones-mkt';
import {
  type Campania,
  type EstadoCampania,
  type PoliticaCampania,
  type Presupuesto,
  EVENTOS_CAMPANIA,
  POLITICA_CAMPANIA_CONSERVADORA,
  campaniaStreamId,
  reconstruirCampania,
  transicionCampaniaValida,
} from '../domain/campania';
import { CampaniaInvalidaError, SeparacionCampaniaVioladaError, TransicionCampaniaInvalidaError } from '../domain/errors';

/** Datos con que se propone una campaña. `decisionId` es obligatorio: no hay campañas huérfanas. */
export interface EntradaCampania {
  readonly organizacionId: string;
  readonly decisionId: string;
  readonly objetivo: string;
  readonly publico: string;
  readonly propuesta: string;
  readonly mensaje: string;
  readonly canal: string;
  readonly contenidoRequerido?: readonly string[];
  readonly calendario: string;
  readonly presupuesto: Presupuesto;
  readonly hipotesis?: readonly string[];
  readonly metricas?: readonly string[];
  readonly criterioExito: string;
  readonly criterioPausa: string;
  readonly nivelAutonomia?: number;
  readonly riesgos?: readonly string[];
}

export class CampaniaService {
  private readonly decisiones: DecisionMktService;
  constructor(private readonly store: EventStore) {
    this.decisiones = new DecisionMktService(store);
  }

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  cargar(ctx: RequestContext, campaniaId: string): Promise<Campania> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, campaniaStreamId(org, campaniaId)).then((e) => reconstruirCampania(org, campaniaId, e));
  }

  /** Deriva una campaña gobernada desde una decisión. Rechaza si viola cualquier invariante. */
  async crearDesdeDecision(
    ctx: RequestContext,
    campaniaId: string,
    entrada: EntradaCampania,
    politica: PoliticaCampania,
    a: Attribution,
    o: string,
  ): Promise<Campania> {
    const org = this.org(ctx);
    if (entrada.organizacionId !== org) {
      throw new SeparacionCampaniaVioladaError('organizacionId de la campaña no coincide con el contexto');
    }
    if (!entrada.decisionId) throw new CampaniaInvalidaError('la campaña debe referenciar una decisión (no puede ser huérfana)');

    // La decisión se carga SIEMPRE dentro de la organización del contexto: una decisión de otra
    // org simplemente no existe en este stream → se rechaza como inexistente/ajena.
    const decision = await this.decisiones.cargar(ctx, entrada.decisionId);
    if (!decision.existe) {
      throw new CampaniaInvalidaError(`la decisión ${entrada.decisionId} no existe en la organización ${org}`);
    }
    if (decision.organizacionId !== org) {
      throw new SeparacionCampaniaVioladaError('la decisión referenciada pertenece a otra organización');
    }

    // Evaluabilidad + aprobación: NO_EVALUABLE jamás deriva campaña; si la política exige
    // aprobación, la decisión debe ser ejecutable (APROBADA).
    if (decision.estado === 'NO_EVALUABLE') {
      throw new CampaniaInvalidaError('una decisión NO_EVALUABLE no puede derivar una campaña');
    }
    if (politica.requiereAprobacion && !esEjecutable(decision.estado)) {
      throw new CampaniaInvalidaError(`la política exige una decisión APROBADA; estado actual: ${decision.estado}`);
    }

    // Presupuesto compatible con la política.
    if (!(entrada.presupuesto.monto > 0)) throw new CampaniaInvalidaError('el presupuesto debe ser positivo');
    if (entrada.presupuesto.monto > politica.presupuestoMaximo) {
      throw new CampaniaInvalidaError(`presupuesto ${entrada.presupuesto.monto} excede el máximo de política ${politica.presupuestoMaximo}`);
    }

    // Experimentalidad: sin hipótesis solo si la política lo permite.
    const hipotesis = entrada.hipotesis ?? [];
    if (hipotesis.length === 0 && !politica.permiteNoExperimental) {
      throw new CampaniaInvalidaError('una campaña sin hipótesis requiere una política que permita campañas no experimentales');
    }

    const existente = await this.cargar(ctx, campaniaId);
    if (existente.existe) return existente;

    const payload: Omit<Campania, 'autor' | 'en' | 'version' | 'existe'> = {
      campaniaId,
      organizacionId: org,
      decisionId: entrada.decisionId,
      objetivo: entrada.objetivo,
      publico: entrada.publico,
      propuesta: entrada.propuesta,
      mensaje: entrada.mensaje,
      canal: entrada.canal,
      contenidoRequerido: entrada.contenidoRequerido ?? [],
      calendario: entrada.calendario,
      presupuesto: entrada.presupuesto,
      hipotesis,
      metricas: entrada.metricas ?? [],
      criterioExito: entrada.criterioExito,
      criterioPausa: entrada.criterioPausa,
      nivelAutonomia: entrada.nivelAutonomia ?? 0,
      aprobaciones: [],
      riesgos: entrada.riesgos ?? [],
      estado: 'BORRADOR',
    };
    const input: EventInput = {
      type: EVENTOS_CAMPANIA.creada,
      payload,
      attribution: a,
      occurredAt: o,
      idempotencyKey: `crear:${campaniaStreamId(org, campaniaId)}`,
    };
    await this.store.append(ctx, campaniaStreamId(org, campaniaId), existente.version, [input]);
    return this.cargar(ctx, campaniaId);
  }

  /** Transición gobernada por la máquina de estados de la campaña. */
  async transicionar(ctx: RequestContext, campaniaId: string, hacia: EstadoCampania, a: Attribution, o: string): Promise<Campania> {
    const c = await this.cargar(ctx, campaniaId);
    if (!c.existe) throw new CampaniaInvalidaError('la campaña no existe');
    if (!transicionCampaniaValida(c.estado, hacia)) {
      throw new TransicionCampaniaInvalidaError(`transición no permitida: ${c.estado} → ${hacia}`);
    }
    const input: EventInput = { type: EVENTOS_CAMPANIA.transicionada, payload: { estado: hacia }, attribution: a, occurredAt: o };
    await this.store.append(ctx, campaniaStreamId(this.org(ctx), campaniaId), c.version, [input]);
    return this.cargar(ctx, campaniaId);
  }
}

export { POLITICA_CAMPANIA_CONSERVADORA };
