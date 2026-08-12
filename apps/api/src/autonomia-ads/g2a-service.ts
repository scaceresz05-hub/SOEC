/**
 * apps/api · CAPA DE COMPOSICIÓN · G2-A · Orquestador de la cadena WRITE GOBERNADA (dry-run).
 *
 * Une: propuesta desde datos REALES (reusa el planificador G1, evidencia honesta) → IntenciónDeCambio persistente
 * → solicitud de APROBACIÓN humana real → (al aprobar) Executor gobernado en DRY-RUN → read-back/rollback simulados
 * → auditoría. Con la evidencia actual la propuesta puede ser CERO (VEREDICTO OBSERVAR) y eso es correcto.
 * AUTONOMOUS_REAL permanece false: ningún mutate real.
 */
import { ActorId, OrganizationId, type Attribution, type EventStore, type RequestContext } from '@soec/contracts';
import { ObservacionService } from '@soec/motor-medicion';
import { CAMPANIA_SMILEFLOW } from '../real-director/criterio-smileflow';
import { LecturaDirectorRealService } from '../real-director/lectura-director-real';
import { LIMITES_SMILEFLOW } from './limites-smileflow';
import { planificarCambios, type InsumosPlan } from './intencion';
import { CONFINAMIENTO } from './capacidad-negativa';
import { IntencionService, intencionId, type IntencionDeCambio } from './intencion-cambio';
import { AprobacionService, type MetaAprobacion } from './aprobacion-service';
import { ExecutorGovernado, type EscenarioSimulado, type ResultadoEjecucionG2A } from './executor-governado';

export const ORG_REAL = 'org-smileflow';

const ATRIB: Attribution = {
  source: 'g2a-service', purpose: 'preparación write gobernada (dry-run)', assumptions: ['AUTONOMOUS_REAL apagado; ningún mutate real'],
  claimType: 'observational', regime: 'empirical', uncertainty: 'baja',
};

/** Vista en lenguaje simple para un usuario sin conocimientos de Google Ads. */
export interface VistaAprobacion {
  readonly intencionId: string;
  readonly estadoIntencion: string;
  readonly estadoAprobacion: string;
  readonly queDetecte: string;
  readonly porQueImporta: string;
  readonly queHare: string;
  readonly riesgo: string;
  readonly impactoEsperado: string;
  readonly detalleTecnico: { readonly keyword: string; readonly match: string; readonly campaign: string; readonly diff: string };
  readonly acciones: readonly ('AUTORIZAR' | 'RECHAZAR' | 'VER_DETALLES')[];
}

export interface ResultadoProponer {
  readonly veredicto: 'OBSERVAR' | 'PROPUESTA_CREADA';
  readonly intencionesCreadas: number;
  readonly motivo: string;
}

export class G2AService {
  private readonly observaciones: ObservacionService;
  private readonly lectura: LecturaDirectorRealService;
  private readonly intenciones: IntencionService;
  private readonly aprobaciones: AprobacionService;
  private readonly executor: ExecutorGovernado;

  constructor(private readonly store: EventStore) {
    this.observaciones = new ObservacionService(store, {} as never);
    this.lectura = new LecturaDirectorRealService(store);
    this.intenciones = new IntencionService(store);
    this.aprobaciones = new AprobacionService(store);
    this.executor = new ExecutorGovernado(store);
  }

  private ctx(org: string): RequestContext {
    const o = OrganizationId(org);
    return { organizationId: o, actor: ActorId('g2a'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: `g2a-${org}` };
  }

  /** Términos de búsqueda REALES agregados (excluye diagnóstico). */
  private async leerTerminos(ctx: RequestContext): Promise<{ termino: string; impresiones: number; clics: number }[]> {
    const ids = await this.observaciones.listarIds(ctx);
    const map = new Map<string, { impresiones: number; clics: number }>();
    for (const id of ids) {
      const st = await this.observaciones.cargar(ctx, id);
      const d = st.datos;
      if (!d || d.naturaleza !== 'REAL' || !d.provenanciaReal) continue;
      const p = d.provenanciaReal;
      if (p.provider !== 'google-ads' || p.diagnostico || p.eventName !== 'ads_search_term' || !p.utmContent) continue;
      const acc = map.get(p.utmContent) ?? { impresiones: 0, clics: 0 };
      if (d.metrica === 'search_term_impressions') acc.impresiones += d.valor ?? 0;
      else if (d.metrica === 'search_term_clicks') acc.clics += d.valor ?? 0;
      map.set(p.utmContent, acc);
    }
    return [...map.entries()].map(([termino, v]) => ({ termino, ...v }));
  }

  /** Construye una IntenciónDeCambio (ADD_NEGATIVE_KEYWORD) desde un término. IDs de tenant FIJOS por composición. */
  private intencionNegativa(org: string, termino: string, evidenciaResumen: string, muestra: number, ahora: string): IntencionDeCambio {
    const id = intencionId(org, CONFINAMIENTO.customerId, 'ADD_NEGATIVE_KEYWORD', termino);
    return {
      id, org, customerId: CONFINAMIENTO.customerId, campaignId: CAMPANIA_SMILEFLOW.campaignId,
      lever: 'negativa_termino', entityRef: termino, actionType: 'ADD_NEGATIVE_KEYWORD',
      before: 'la búsqueda muestra el anuncio', after: 'la búsqueda queda excluida (palabra negativa)',
      reason: `El término "${termino}" mostró el anuncio ${muestra} veces con 0 clics y sin relación con el público objetivo.`,
      evidence: { resumen: evidenciaResumen, muestra, suficiente: true, sinConversionAtribuible: true, ventana: 'acumulado' },
      confidence: 'alta', risk: 'bajo', authorizationRef: null, createdAt: ahora, status: 'PROPUESTA',
    };
  }

  /**
   * Propone desde datos REALES (reusa el planificador honesto). Con la evidencia actual ⇒ 0 propuestas ⇒ OBSERVAR.
   * Cada propuesta se persiste (PROPUESTA → PENDIENTE_APROBACION) y solicita aprobación humana real.
   */
  async proponerDesdeReal(org: string, ahora: string): Promise<ResultadoProponer> {
    const ctx = this.ctx(org);
    const lect = await this.lectura.leerUltima(org);
    const terminos = await this.leerTerminos(ctx);
    const insumos: InsumosPlan = {
      org, customerId: CONFINAMIENTO.customerId, campaniaRef: CAMPANIA_SMILEFLOW.campaniaRef,
      evidenciaSuficiente: lect?.interpretacion.evidenciaSuficiente ?? false,
      clasificacionDesempeno: lect?.interpretacion.clasificacionDesempeno ?? 'sin_datos',
      roiClasificacion: lect?.interpretacion.roi.clasificacion ?? 'NO_EVALUABLE',
      decisionTipo: null, terminos, limites: LIMITES_SMILEFLOW,
    };
    const propuestas = planificarCambios(insumos); // honesto: evidencia insuficiente ⇒ []
    for (const p of propuestas) {
      const intencion = this.intencionNegativa(org, p.entidadRef, p.evidencia.resumen, p.evidencia.muestra, ahora);
      await this.registrarIntencion(org, intencion, ahora);
    }
    return propuestas.length === 0
      ? { veredicto: 'OBSERVAR', intencionesCreadas: 0, motivo: 'evidencia por-término insuficiente: SOEC observa, no propone' }
      : { veredicto: 'PROPUESTA_CREADA', intencionesCreadas: propuestas.length, motivo: 'términos con evidencia suficiente de irrelevancia' };
  }

  /** Persiste una intención y solicita su aprobación humana (idempotente). Usado por real y por el E2E fixture. */
  async registrarIntencion(org: string, intencion: IntencionDeCambio, ahora: string, expiraHoras = 72): Promise<void> {
    const ctx = this.ctx(org);
    // Confinamiento duro: rechazar cualquier intención cuyo tenant/customer no sean los fijos.
    if (intencion.org !== CONFINAMIENTO.org || intencion.customerId !== CONFINAMIENTO.customerId) {
      throw new Error('intención rechazada: tenant/customerId fuera del confinamiento');
    }
    await this.intenciones.proponer(ctx, intencion, ATRIB, ahora);
    await this.intenciones.marcarPendiente(ctx, intencion.id, ATRIB, ahora).catch(() => undefined); // idempotente si ya está
    const expiraEn = new Date(new Date(ahora).getTime() + expiraHoras * 3600_000).toISOString();
    const meta: MetaAprobacion = {
      campaignId: intencion.campaignId, accion: intencion.actionType, entidadRef: intencion.entityRef,
      antes: intencion.before, despues: intencion.after, evidencia: intencion.evidence.resumen,
      confianza: intencion.confidence, riesgo: intencion.risk, limites: [`máx ${LIMITES_SMILEFLOW.maxCambiosPorDia} cambios/día`, `cooldown ${LIMITES_SMILEFLOW.cooldownHoras}h`],
    };
    await this.aprobaciones.solicitar(ctx, intencion.id, meta, expiraEn, ATRIB, ahora);
  }

  /** Bandeja de propuestas pendientes (vista de usuario, lenguaje simple). */
  async bandeja(org: string, ahora: string): Promise<VistaAprobacion[]> {
    const ctx = this.ctx(org);
    const ids = await this.intenciones.listarIds(ctx);
    const out: VistaAprobacion[] = [];
    for (const id of ids) {
      const st = await this.intenciones.cargar(ctx, id);
      if (!st.intencion) continue;
      const aprob = await this.aprobaciones.estado(ctx, id, ahora);
      out.push(this.vista(st.intencion, aprob.estado));
    }
    return out;
  }

  private vista(i: IntencionDeCambio, estadoAprobacion: string): VistaAprobacion {
    return {
      intencionId: i.id, estadoIntencion: i.status, estadoAprobacion,
      queDetecte: `Personas buscaron "${i.entityRef}" y vieron tu anuncio, pero nadie hizo clic. La evidencia indica que no corresponde a tu público objetivo.`,
      porQueImporta: 'Mostrar el anuncio en búsquedas que no atraen clientes gasta presupuesto sin retorno.',
      queHare: `Evitar que tu anuncio aparezca para la búsqueda "${i.entityRef}" (la agrego como palabra excluida).`,
      riesgo: 'Bajo: si en el futuro esa búsqueda fuera útil, se puede quitar la exclusión en segundos.',
      impactoEsperado: 'No sube tu gasto; puede reducir desperdicio. No cambia tus anuncios ni tu presupuesto.',
      detalleTecnico: { keyword: i.entityRef, match: 'EXACT (negativa)', campaign: `${CAMPANIA_SMILEFLOW.nombre} (${i.campaignId})`, diff: `${i.before} → ${i.after}` },
      acciones: ['AUTORIZAR', 'RECHAZAR', 'VER_DETALLES'],
    };
  }

  /** Aprueba (humano) y ejecuta en DRY-RUN. Nunca ejecuta real (AUTONOMOUS_REAL=false). */
  async aprobarYEjecutar(org: string, id: string, actorHumano: string, ahora: string, escenario?: EscenarioSimulado): Promise<{ aprobado: boolean; ejecucion: ResultadoEjecucionG2A }> {
    const ctx = this.ctx(org);
    const aprob = await this.aprobaciones.aprobar(ctx, id, actorHumano, ahora, ATRIB, ahora); // lanza si SOEC/ vacío/ expirada
    await this.intenciones.aprobar(ctx, id, aprob.authorizationRef!, ATRIB, ahora);
    const ejecucion = await this.executor.ejecutar(org, id, ahora, escenario);
    return { aprobado: true, ejecucion };
  }

  async rechazar(org: string, id: string, actorHumano: string, motivo: string, ahora: string): Promise<void> {
    const ctx = this.ctx(org);
    await this.aprobaciones.rechazar(ctx, id, actorHumano, motivo, ahora, ATRIB, ahora);
    await this.intenciones.rechazar(ctx, id, ATRIB, ahora).catch(() => undefined);
  }
}
