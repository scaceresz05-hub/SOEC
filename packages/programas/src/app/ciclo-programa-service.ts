/**
 * Servicio del ciclo autónomo POR PROGRAMA. Deja de depender de la fixture fija: opera sobre la
 * configuración real del programa (sus campañas y contenidos), gobernado por `@soec/autonomia`
 * (autorización + PAUSA a nivel de organización en esta V1). Reutiliza los servicios A–J; no los
 * duplica. Ejecución SIMULADA; idempotente; se detiene si la organización está en modo seguro.
 */
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import { AutonomiaService, AutonomiaInvalidaError } from '@soec/autonomia';
import { ContenidoGobernadoService } from '@soec/contenido-gobernado';
import { AdaptadorSimuladoDeterminista, EjecucionService } from '@soec/ejecucion-simulada';
import { evaluarExperimento, type Experimento } from '@soec/medicion';
import { AprendizajeService, observadoDesdeExperimento } from '@soec/aprendizaje';
import { EVENTOS_PROGRAMA, programaEjecutable, programaStreamId, reconstruirPrograma } from '../domain/programa';
import { ProgramaNoEjecutableError, ProgramaInvalidoError } from '../domain/errors';
import { reconstruirVistaPrograma, type VistaPrograma } from './vista-programa';

const EXPIRA_LEJANA = '2099-12-31T00:00:00.000Z';

export class CicloProgramaService {
  private readonly autonomia: AutonomiaService;
  private readonly contenidos: ContenidoGobernadoService;
  private readonly ejecuciones: EjecucionService;
  private readonly aprendizajes: AprendizajeService;

  constructor(private readonly store: EventStore) {
    this.autonomia = new AutonomiaService(store);
    this.contenidos = new ContenidoGobernadoService(store);
    this.ejecuciones = new EjecucionService(store, new AdaptadorSimuladoDeterminista('adaptador-programa', 'SUCCESS'));
    this.aprendizajes = new AprendizajeService(store);
  }

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  private cargarPrograma(ctx: RequestContext, programaId: string) {
    const org = this.org(ctx);
    return this.store.readStream(ctx, programaStreamId(org, programaId)).then((e) => reconstruirPrograma(org, programaId, e));
  }

  /** Ejecuta el ciclo gobernado sobre la configuración del programa. Idempotente; SIMULADO. */
  async ejecutarCiclo(ctx: RequestContext, programaId: string, a: Attribution, o: string): Promise<VistaPrograma> {
    const org = this.org(ctx);
    const programa = await this.cargarPrograma(ctx, programaId);
    if (!programa.existe) throw new ProgramaInvalidoError(`el programa ${programaId} no existe`);

    // Idempotencia: un programa YA EVALUADO (ciclo completo y consistente) se reconstruye sin re-escribir.
    if (programa.estado === 'EVALUADO') {
      return (await reconstruirVistaPrograma(this.store, ctx, programaId))!;
    }

    // MODO SEGURO: la organización en PAUSA no ejecuta NI reconcilia (respuesta gobernada, sin escribir).
    const autonomiaEstado = await this.autonomia.cargar(ctx);
    if (autonomiaEstado.pausado) {
      throw new AutonomiaInvalidaError('en modo seguro (PAUSA): el ciclo del programa no puede ejecutarse; reanude primero');
    }

    // Primera corrida (no EN_EJECUCION): validar ejecutabilidad, fijar política y marcar EN_EJECUCION ANTES
    // de escribir efectos — así, si una etapa falla, el programa NO queda EVALUADO y un reintento reconcilia.
    if (programa.estado !== 'EN_EJECUCION') {
      const ej = programaEjecutable(programa);
      if (!ej.ok) throw new ProgramaNoEjecutableError(ej.motivo);
      if (autonomiaEstado.nivel === 0) await this.autonomia.establecerPolitica(ctx, 2, a, o);
      const p0 = await this.cargarPrograma(ctx, programaId);
      await this.store.append(ctx, programaStreamId(org, programaId), p0.version, [{ type: EVENTOS_PROGRAMA.transicionado, payload: { estado: 'EN_EJECUCION' }, attribution: a, occurredAt: o }]);
    }

    // Ejecuta/RECONCILIA cada campaña. Cada etapa es idempotente y la decisión de avanzar se basa en el
    // estado PERSISTIDO (no en el resultado de esta llamada): un reintento continúa desde la 1.ª etapa
    // incompleta sin duplicar (A-4). Se acumulan las piezas que aún no queden consistentes.
    const pendientes: string[] = [];
    for (const ref of programa.campanias) {
      for (const contenidoId of ref.contenidoIds) {
        await this.autonomia.otorgarAutorizacion(ctx, { accion: 'PROGRAMAR', entidadRef: contenidoId, actorHumano: 'director-humano', otorgadaEn: o, expiraEn: EXPIRA_LEJANA }, a, o);
        await this.autonomia.otorgarAutorizacion(ctx, { accion: 'PUBLICAR_SIMULADO', entidadRef: contenidoId, actorHumano: 'director-humano', otorgadaEn: o, expiraEn: EXPIRA_LEJANA }, a, o);

        const cont = await this.contenidos.cargar(ctx, contenidoId);
        if (cont.estado === 'BORRADOR') {
          await this.contenidos.transicionar(ctx, contenidoId, 'EN_REVISION', a, o);
          await this.contenidos.transicionar(ctx, contenidoId, 'APROBADO', a, o);
          await this.contenidos.transicionar(ctx, contenidoId, 'PROGRAMADO', a, o);
        } else if (cont.estado === 'EN_REVISION') {
          await this.contenidos.transicionar(ctx, contenidoId, 'APROBADO', a, o);
          await this.contenidos.transicionar(ctx, contenidoId, 'PROGRAMADO', a, o);
        } else if (cont.estado === 'APROBADO') {
          await this.contenidos.transicionar(ctx, contenidoId, 'PROGRAMADO', a, o);
        }

        const accionId = `acc-${contenidoId}`;
        // Idempotencia a nivel de ciclo (A-4): sólo publicar si aún no hay publicación simulada. Un reintento
        // NO re-ejecuta (evita registros DUPLICADA que ensucian la auditoría) ni re-emite accionIniciada.
        const yaEjec = await this.ejecuciones.cargar(ctx, contenidoId);
        if (yaEjec.publicacionesSimuladas === 0) {
          const preAuto = await this.autonomia.cargar(ctx);
          if (!preAuto.accionesIniciadas.some((x) => x.accionId === accionId)) {
            await this.autonomia.iniciarAccion(ctx, accionId, 'PUBLICAR_SIMULADO', contenidoId, o, a, o);
          }
          await this.ejecuciones.ejecutar(ctx, { organizacionId: org, contenidoId, campaniaId: ref.campaignId, canal: cont.canal, idempotencyKey: `pub:${contenidoId}`, escenario: 'SUCCESS' }, a, o);
        }

        // RECONCILIACIÓN por estado PERSISTIDO: si hay publicación simulada exitosa y el contenido sigue
        // PROGRAMADO, completar su transición (aunque una corrida anterior fallara tras publicar).
        const ejecEstado = await this.ejecuciones.cargar(ctx, contenidoId);
        if (ejecEstado.publicacionesSimuladas > 0) {
          const auto = await this.autonomia.cargar(ctx);
          const acc = auto.accionesIniciadas.find((x) => x.accionId === accionId);
          if (acc && !acc.finalizada) await this.autonomia.finalizarAccion(ctx, accionId, a, o);
          const actual = await this.contenidos.cargar(ctx, contenidoId);
          if (actual.estado === 'PROGRAMADO') await this.contenidos.transicionar(ctx, contenidoId, 'PUBLICADO_SIMULADO', a, o);
        }
        // Consistencia final de la pieza: debe quedar PUBLICADO_SIMULADO.
        const fin = await this.contenidos.cargar(ctx, contenidoId);
        if (fin.estado !== 'PUBLICADO_SIMULADO') pendientes.push(contenidoId);
      }
    }

    // Aprendizaje del programa (idempotente por learningId). Sólo si el ciclo quedó consistente.
    const learningId = `apr-${programaId}`;
    const aprendizajePrevio = await this.aprendizajes.cargar(ctx, learningId);
    if (pendientes.length === 0 && !aprendizajePrevio.existe) {
      const exp: Experimento = { experimentoId: `exp-${programaId}`, hipotesis: 'segmentos con dolor administrativo responden mejor', metricaPrincipal: 'leads_simulados', control: { actividadId: 'c1', publicationId: 'p1' }, variante: { actividadId: 'c2', publicationId: 'p2' }, minimoObservaciones: 100, margenMinimo: 0.1 };
      const resultadoExp = evaluarExperimento(exp, 40, 500, 60, 500);
      await this.aprendizajes.registrar(ctx, learningId, {
        observado: observadoDesdeExperimento(`exp-${programaId}`, resultadoExp, 1000),
        interpretacion: { texto: 'la señal simulada favorece al segmento con mayor dolor administrativo', supuestos: ['tráfico comparable'], confianza: 'media' },
        conclusion: { enunciado: 'priorizar el segmento con mejor señal simulada', soporte: 'evidencia_suficiente', accionRecomendada: 'reasignar presupuesto simulado a la campaña líder' },
        reutilizable: { enunciado: 'el dolor administrativo es una señal de captación para clínicas', condiciones: ['clínicas pyme'], ambitoSugerido: [org] },
      }, a, o);
    }

    // Cierre A-4: EVALUADO SÓLO si TODAS las piezas quedaron consistentes; si no, permanece EN_EJECUCION
    // (reintentable): un nuevo ejecutarCiclo reconcilia. Nunca se marca EVALUADO con una etapa pendiente.
    const tras = await this.cargarPrograma(ctx, programaId);
    if (pendientes.length === 0 && tras.estado !== 'EVALUADO') {
      await this.store.append(ctx, programaStreamId(org, programaId), tras.version, [{ type: EVENTOS_PROGRAMA.transicionado, payload: { estado: 'EVALUADO' }, attribution: a, occurredAt: o }]);
    }

    return (await reconstruirVistaPrograma(this.store, ctx, programaId))!;
  }
}
