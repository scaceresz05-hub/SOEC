/**
 * Servicio del ciclo autónomo POR PROGRAMA. Deja de depender de la fixture fija: opera sobre la
 * configuración real del programa (sus campañas y contenidos), gobernado por `@soec/autonomia`
 * (autorización + PAUSA a nivel de organización en esta V1). Reutiliza los servicios A–J; no los
 * duplica. Ejecución SIMULADA; idempotente; se detiene si la organización está en modo seguro.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
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

    // Idempotencia: si el ciclo ya corrió (programa EN_EJECUCION/EVALUADO), se reconstruye.
    if (programa.estado === 'EN_EJECUCION' || programa.estado === 'EVALUADO') {
      return (await reconstruirVistaPrograma(this.store, ctx, programaId))!;
    }

    const ej = programaEjecutable(programa);
    if (!ej.ok) throw new ProgramaNoEjecutableError(ej.motivo);

    // MODO SEGURO: la organización en PAUSA no ejecuta (respuesta gobernada, antes de escribir nada).
    const autonomiaEstado = await this.autonomia.cargar(ctx);
    if (autonomiaEstado.pausado) {
      throw new AutonomiaInvalidaError('en modo seguro (PAUSA): el ciclo del programa no puede ejecutarse; reanude primero');
    }
    if (autonomiaEstado.nivel === 0) await this.autonomia.establecerPolitica(ctx, 2, a, o);

    // Ejecuta cada campaña: autoriza, publica (simulado) cada contenido, gobernado por autonomía.
    for (const ref of programa.campanias) {
      for (const contenidoId of ref.contenidoIds) {
        await this.autonomia.otorgarAutorizacion(ctx, { accion: 'PROGRAMAR', entidadRef: contenidoId, actorHumano: 'director-humano', otorgadaEn: o, expiraEn: EXPIRA_LEJANA }, a, o);
        await this.autonomia.otorgarAutorizacion(ctx, { accion: 'PUBLICAR_SIMULADO', entidadRef: contenidoId, actorHumano: 'director-humano', otorgadaEn: o, expiraEn: EXPIRA_LEJANA }, a, o);

        const cont = await this.contenidos.cargar(ctx, contenidoId);
        if (cont.estado === 'BORRADOR') {
          await this.contenidos.transicionar(ctx, contenidoId, 'EN_REVISION', a, o);
          await this.contenidos.transicionar(ctx, contenidoId, 'APROBADO', a, o);
          await this.contenidos.transicionar(ctx, contenidoId, 'PROGRAMADO', a, o);
        }

        const accionId = `acc-${contenidoId}`;
        await this.autonomia.iniciarAccion(ctx, accionId, 'PUBLICAR_SIMULADO', contenidoId, o, a, o);
        const ejec = await this.ejecuciones.ejecutar(ctx, { organizacionId: org, contenidoId, campaniaId: ref.campaignId, canal: cont.canal, idempotencyKey: `pub:${contenidoId}`, escenario: 'SUCCESS' }, a, o);
        const seguir = await this.autonomia.puedeContinuar(ctx, accionId);
        if (seguir.permitida && ejec.registro.resultado === 'PUBLICADA_SIMULADA') {
          await this.autonomia.finalizarAccion(ctx, accionId, a, o);
          const actual = await this.contenidos.cargar(ctx, contenidoId);
          if (actual.estado === 'PROGRAMADO') await this.contenidos.transicionar(ctx, contenidoId, 'PUBLICADO_SIMULADO', a, o);
        }
      }
    }

    // Aprendizaje del programa (estructurado sobre un experimento simulado).
    const learningId = `apr-${programaId}`;
    const aprendizajePrevio = await this.aprendizajes.cargar(ctx, learningId);
    if (!aprendizajePrevio.existe) {
      const exp: Experimento = { experimentoId: `exp-${programaId}`, hipotesis: 'segmentos con dolor administrativo responden mejor', metricaPrincipal: 'leads_simulados', control: { actividadId: 'c1', publicationId: 'p1' }, variante: { actividadId: 'c2', publicationId: 'p2' }, minimoObservaciones: 100, margenMinimo: 0.1 };
      const resultadoExp = evaluarExperimento(exp, 40, 500, 60, 500);
      await this.aprendizajes.registrar(ctx, learningId, {
        observado: observadoDesdeExperimento(`exp-${programaId}`, resultadoExp, 1000),
        interpretacion: { texto: 'la señal simulada favorece al segmento con mayor dolor administrativo', supuestos: ['tráfico comparable'], confianza: 'media' },
        conclusion: { enunciado: 'priorizar el segmento con mejor señal simulada', soporte: 'evidencia_suficiente', accionRecomendada: 'reasignar presupuesto simulado a la campaña líder' },
        reutilizable: { enunciado: 'el dolor administrativo es una señal de captación para clínicas', condiciones: ['clínicas pyme'], ambitoSugerido: [org] },
      }, a, o);
    }

    // Cierra el ciclo: programa EVALUADO.
    const tras = await this.cargarPrograma(ctx, programaId);
    const input: EventInput = { type: EVENTOS_PROGRAMA.transicionado, payload: { estado: 'EVALUADO' }, attribution: a, occurredAt: o };
    await this.store.append(ctx, programaStreamId(org, programaId), tras.version, [input]);

    return (await reconstruirVistaPrograma(this.store, ctx, programaId))!;
  }
}
