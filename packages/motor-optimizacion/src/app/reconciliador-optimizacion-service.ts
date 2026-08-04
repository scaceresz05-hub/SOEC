/**
 * @soec/motor-optimizacion · aplicación · RECONCILIADOR M9 (recuperación transversal del ciclo).
 *
 * Recorre ciclos, propuestas y memoria; detecta la matriz de inconsistencias del Bloque Maestro y repara
 * idempotentemente o clasifica honestamente. No borra historia. Determinista. Dos reconciliadores
 * concurrentes convergen. Clasificaciones: REPARADA · NO_REQUIERE_ACCION · NO_REPARABLE · REQUIERE_INTERVENCION.
 */
import { ConcurrencyError, type Attribution, type RequestContext } from '@soec/contracts';
import { propuestaStreamId, EVENTOS_PROPUESTA } from '../dominio/propuesta';
import { permitirCambio, type PoliticaOscilacion } from '../dominio/politica-oscilacion';
import { OptimizacionService } from './optimizacion-service';
import { PropuestaService } from './propuesta-service';
import { MemoriaDecisionesService } from './memoria-decisiones-service';
import type { EventStore } from '@soec/contracts';

export type ClaseHallazgoOpt =
  | 'CICLO_SIN_EVIDENCIA' | 'PROPUESTA_SIN_CICLO' | 'PROPUESTA_APROBADA_OBSOLETA' | 'APLICACION_SIN_APROBACION'
  | 'APLICACION_PARCIAL' | 'DERIVACION_SIN_PROPUESTA' | 'PROPUESTA_APLICADA_DOS_VECES' | 'PRESUPUESTO_INCONSISTENTE'
  | 'MEMORIA_INCOMPLETA' | 'RESULTADO_NO_VINCULADO' | 'CICLO_ABIERTO_SIN_ACTIVIDAD' | 'PROPUESTA_TERMINAL_EJECUTABLE'
  | 'READ_MODEL_INCOMPLETO' | 'EXPLICACION_AUSENTE' | 'OSCILACION_NO_DETECTADA' | 'REFERENCIA_CROSS_TENANT';

export type Clasificacion = 'REPARADA' | 'NO_REQUIERE_ACCION' | 'NO_REPARABLE' | 'REQUIERE_INTERVENCION';
export interface HallazgoOpt { readonly clase: ClaseHallazgoOpt; readonly clasificacion: Clasificacion; readonly ref?: string; readonly detalle: string }

export class ReconciliadorOptimizacionService {
  constructor(
    private readonly store: EventStore,
    private readonly optimizacion: OptimizacionService,
    private readonly propuestas: PropuestaService,
    private readonly memoria: MemoriaDecisionesService,
    private readonly politicaOscilacion: PoliticaOscilacion,
  ) {}

  private org(ctx: RequestContext): string { return String(ctx.organizationId); }
  private async intentar(fn: () => Promise<unknown>): Promise<Clasificacion> {
    try { await fn(); return 'REPARADA'; } catch (e) { return e instanceof ConcurrencyError ? 'NO_REQUIERE_ACCION' : 'NO_REPARABLE'; }
  }

  async reconciliar(ctx: RequestContext, ahora: string, a: Attribution, o: string): Promise<readonly HallazgoOpt[]> {
    const org = this.org(ctx);
    const h: HallazgoOpt[] = [];
    const push = (x: HallazgoOpt) => h.push(x);

    for (const cicloId of await this.optimizacion.listarIds(ctx)) {
      const st = await this.optimizacion.cargar(ctx, cicloId);
      if (!st.existe) continue;
      const c = st.cuerpo;
      // READ_MODEL_INCOMPLETO: propuesta referenciada por el ciclo pero ausente del índice de propuestas.
      if (c.propuestaId) {
        const prop = await this.propuestas.cargar(ctx, c.propuestaId);
        if (prop.existe && !(await this.propuestas.estaEnIndice(ctx, c.propuestaId))) {
          const cls = await this.intentar(() => this.propuestas.reindexar(ctx, c.propuestaId!, a, o));
          push({ clase: 'READ_MODEL_INCOMPLETO', clasificacion: cls, ref: c.propuestaId, detalle: 'propuesta referenciada ausente del índice → reindexar' });
        }
      }
      if ((st.estado === 'EVALUABLE' || st.estado === 'PROPUESTAS_GENERADAS') && c.evaluacionesM8.length === 0)
        push({ clase: 'CICLO_SIN_EVIDENCIA', clasificacion: 'REQUIERE_INTERVENCION', ref: cicloId, detalle: 'ciclo evaluable sin evidencia M8' });
      if (st.estado === 'ABIERTO')
        push({ clase: 'CICLO_ABIERTO_SIN_ACTIVIDAD', clasificacion: 'REQUIERE_INTERVENCION', ref: cicloId, detalle: 'ciclo abierto sin recopilar evidencia' });
      // Presupuesto inconsistente: alguna alternativa cuesta más que el presupuesto disponible.
      if (c.alternativas.some((x) => x.costoEstimado > c.presupuestoDisponible))
        push({ clase: 'PRESUPUESTO_INCONSISTENTE', clasificacion: 'REQUIERE_INTERVENCION', ref: cicloId, detalle: 'alternativa con costo mayor que el presupuesto disponible' });
    }

    for (const propuestaId of await this.propuestas.listarIds(ctx)) {
      const st = await this.propuestas.cargar(ctx, propuestaId);
      if (!st.existe || !st.cuerpo) continue;
      const cuerpo = st.cuerpo;
      const ciclo = await this.optimizacion.cargar(ctx, cuerpo.cicloId);

      if (!ciclo.existe) push({ clase: 'PROPUESTA_SIN_CICLO', clasificacion: 'REQUIERE_INTERVENCION', ref: propuestaId, detalle: 'propuesta referencia un ciclo inexistente (o de otra organización)' });
      if (!cuerpo.explicacion?.trim()) push({ clase: 'EXPLICACION_AUSENTE', clasificacion: 'REQUIERE_INTERVENCION', ref: propuestaId, detalle: 'propuesta sin explicación' });

      // Propuesta APROBADA con versiones ya obsoletas ⇒ obsoletar (reparación segura).
      if (st.estado === 'APROBADA') {
        const coh = await this.optimizacion.verificarCoherencia(ctx, { objetivo: '', segmento: '', versionesBase: cuerpo.versionesBase, presupuestoDisponible: 0 });
        if (!coh.coherente) {
          const cls = await this.intentar(() => this.propuestas.obsoletar(ctx, propuestaId, `reconciliación: ${coh.motivo}`, a, o));
          push({ clase: 'PROPUESTA_APROBADA_OBSOLETA', clasificacion: cls, ref: propuestaId, detalle: 'propuesta aprobada con versiones obsoletas → obsoletar' });
        }
      }
      // Aplicación sin aprobación (corrupción): APLICADA sin registro de aprobación.
      if (st.estado === 'APLICADA_SIMULADA' && st.aprobacion === null)
        push({ clase: 'APLICACION_SIN_APROBACION', clasificacion: 'REQUIERE_INTERVENCION', ref: propuestaId, detalle: 'aplicación sin aprobación registrada' });
      // Aplicación parcial: menos derivaciones que variables que la alternativa declara cambiar.
      if (st.estado === 'APLICADA_SIMULADA' && cuerpo.alternativaElegida && st.derivaciones.length < cuerpo.alternativaElegida.cambia.length)
        push({ clase: 'APLICACION_PARCIAL', clasificacion: 'REQUIERE_INTERVENCION', ref: propuestaId, detalle: 'aplicación parcial (faltan derivaciones)' });
      // Aplicada dos veces (corrupción): más de un evento de aplicación.
      const eventos = await this.store.readStream(ctx, propuestaStreamId(org, propuestaId));
      if (eventos.filter((e) => e.type === EVENTOS_PROPUESTA.aplicada).length > 1)
        push({ clase: 'PROPUESTA_APLICADA_DOS_VECES', clasificacion: 'REQUIERE_INTERVENCION', ref: propuestaId, detalle: 'más de una aplicación' });
      // Propuesta terminal pero el ciclo la sigue creyendo pendiente.
      if ((st.estado === 'RECHAZADA' || st.estado === 'OBSOLETA') && ciclo.existe && ciclo.estado === 'PENDIENTE_APROBACION')
        push({ clase: 'PROPUESTA_TERMINAL_EJECUTABLE', clasificacion: 'REQUIERE_INTERVENCION', ref: propuestaId, detalle: 'propuesta terminal con ciclo aún pendiente' });
      // Read-model incompleto: propuesta con stream pero ausente del índice.
      if (!(await this.propuestas.estaEnIndice(ctx, propuestaId))) {
        const cls = await this.intentar(() => this.propuestas.reindexar(ctx, propuestaId, a, o));
        push({ clase: 'READ_MODEL_INCOMPLETO', clasificacion: cls, ref: propuestaId, detalle: 'propuesta ausente del índice → reindexar' });
      }
      // Memoria incompleta: APROBADA/APLICADA sin entrada de decisión.
      const memo = await this.memoria.listar(ctx);
      if ((st.estado === 'APROBADA' || st.estado === 'APLICADA_SIMULADA') && !memo.some((m) => m.propuestaId === propuestaId))
        push({ clase: 'MEMORIA_INCOMPLETA', clasificacion: 'REQUIERE_INTERVENCION', ref: propuestaId, detalle: 'decisión sin entrada en la memoria' });
    }

    // Cross-tenant / derivación sin propuesta / resultado no vinculado / oscilación, desde la memoria.
    const memo = await this.memoria.listar(ctx);
    for (const m of memo) {
      const prop = await this.propuestas.cargar(ctx, m.propuestaId);
      if (!prop.existe) push({ clase: 'DERIVACION_SIN_PROPUESTA', clasificacion: 'REQUIERE_INTERVENCION', ref: m.propuestaId, detalle: 'memoria referencia una propuesta inexistente (posible cross-tenant)' });
      if (m.aplicada) {
        const ciclo = await this.optimizacion.cargar(ctx, m.cicloId);
        if (ciclo.existe && ciclo.estado !== 'APLICADO_SIMULADO') push({ clase: 'RESULTADO_NO_VINCULADO', clasificacion: 'REQUIERE_INTERVENCION', ref: m.propuestaId, detalle: 'decisión aplicada no vinculada a un ciclo aplicado' });
      }
    }
    // Referencia cross-tenant explícita (una propuesta cuyo ciclo no existe en esta organización).
    for (const propuestaId of await this.propuestas.listarIds(ctx)) {
      const st = await this.propuestas.cargar(ctx, propuestaId);
      if (st.existe && st.cuerpo && !(await this.optimizacion.estaEnIndice(ctx, st.cuerpo.cicloId)) && !(await this.optimizacion.cargar(ctx, st.cuerpo.cicloId)).existe)
        push({ clase: 'REFERENCIA_CROSS_TENANT', clasificacion: 'REQUIERE_INTERVENCION', ref: propuestaId, detalle: 'referencia a ciclo ausente del índice de esta organización' });
    }
    // Oscilación no detectada previamente: el historial muestra A→B→A aplicado.
    const historial = await this.memoria.historialCambios(ctx);
    const porVar = new Map<string, string[]>();
    for (const cambio of historial) { const l = porVar.get(cambio.variable) ?? []; l.push(cambio.valor); porVar.set(cambio.variable, l); }
    for (const [variable, valores] of porVar) {
      for (let i = 2; i < valores.length; i++) if (valores[i] === valores[i - 2] && valores[i] !== valores[i - 1]) {
        // Un patrón A→B→A YA aplicado en el historial es una oscilación que debió bloquearse: intervención.
        push({ clase: 'OSCILACION_NO_DETECTADA', clasificacion: 'REQUIERE_INTERVENCION', ref: variable, detalle: 'patrón de oscilación A→B→A en el historial de cambios aplicados' });
        break;
      }
    }
    void permitirCambio;
    return h;
  }
}
