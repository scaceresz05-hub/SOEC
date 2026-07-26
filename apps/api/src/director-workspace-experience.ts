/**
 * Experiencia «Director Workspace» (consumidor de GOBIERNO; F2-DISC-02/03 · F2-PILOT-00).
 *
 * Consume la última GENERACIÓN de comprensión congelada por una evaluación REAL
 * identificada (`org + departamento + evaluacionId`) y ejecuta Diagnóstico→Estrategia sobre
 * ese conjunto de respuestas de forma determinista (el `occurredAt` del diagnóstico proviene
 * de la generación, no del reloj, para estabilidad del snapshot). Registra/revoca decisiones
 * vía DecisionService con un alcance AISLADO por evaluación (`departamento::evaluacionId`), de
 * modo que dos evaluaciones nunca contaminan sus decisiones. Los eventos de decisión llevan
 * tiempo real (reloj inyectado). No interpreta: compone lo que producen los motores. Decidir
 * ≠ ejecutar.
 */
import {
  ActorId,
  type Attribution,
  type EventStore,
  OrganizationId,
  type RequestContext,
} from '@soec/contracts';
import { type Clock, FixedClock, InMemoryEventStore } from '@soec/event-store';
import { crearBibliotecaClinicaDental } from '@soec/rubros';
import {
  componerMotorDiagnostico,
  type ComprensionEvaluable,
  type RespuestasDiagnostico,
} from '@soec/diagnostico';
import { proponerEstrategia, type ResultadoEstrategia } from '@soec/estrategia';
import {
  DecisionService,
  type CategoriaJustificacion,
  type ResultadoDecision,
  type PropuestaSnapshot,
} from '@soec/decision';
import { EvaluacionService, generacionVigente } from '@soec/evaluacion';

const ATRIBUCION: Attribution = {
  source: 'director-workspace',
  purpose: 'gobierno del departamento por el Director',
  assumptions: ['comprensión derivada de la evaluación real del Director'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};
const CONF_ES: Record<string, string> = { HIGH: 'alta', MEDIUM: 'media', LOW: 'baja' };

export class DirectorWorkspaceExperience {
  private readonly rubro = crearBibliotecaClinicaDental();
  constructor(
    private readonly store: EventStore,
    private readonly clock: Clock,
  ) {}

  private ctx(organizationId: string): RequestContext {
    const org = OrganizationId(organizationId);
    return {
      organizationId: org,
      actor: ActorId('director'),
      scope: {
        organizationId: org,
        permissions: ['events:append', 'events:read', 'decisiones:decidir'],
      },
      correlationId: `dw-${organizationId}`,
    };
  }

  /** Alcance de decisión AISLADO por evaluación: dos evaluaciones no comparten decisiones. */
  private alcance(departamentoId: string, evaluacionId: string): string {
    return `${departamentoId}::${evaluacionId}`;
  }

  /** Ejecuta Diagnóstico→Estrategia sobre un conjunto congelado; `occurredAt` de la generación. */
  private async proponerDesde(
    respuestas: RespuestasDiagnostico,
    occurredAt: string,
  ): Promise<{ comprension: ComprensionEvaluable; resultado: ResultadoEstrategia }> {
    const memoria = new InMemoryEventStore(new FixedClock(new Date(occurredAt)));
    const motor = componerMotorDiagnostico(memoria, this.rubro);
    const comprension = await motor.comprender(respuestas, {
      diagnosticoId: 'dx-eval',
      occurredAt,
    });
    const resultado = proponerEstrategia(comprension, this.rubro);
    return { comprension, resultado };
  }

  private snapshot(
    comprension: ComprensionEvaluable,
    resultado: ResultadoEstrategia,
  ): PropuestaSnapshot {
    return {
      comprension,
      resultado,
      rubroId: this.rubro.rubroId(),
      rubroHuella: this.rubro.version().huellaCompleta,
    };
  }

  private trazabilidad(
    objetivoId: string,
    senalesActivas: readonly string[],
    comprension: ComprensionEvaluable,
    respuestas: RespuestasDiagnostico,
  ) {
    return this.rubro
      .mapeos()
      .filter((m) => m.objetivoId === objetivoId && senalesActivas.includes(m.senalId))
      .map((m) => {
        const senal = this.rubro.senales().find((s) => s.id === m.senalId)!;
        const hecho = comprension.hechos.find((h) => h.preguntaId === senal.preguntaId) ?? null;
        const respuesta = respuestas.find((r) => r.preguntaId === senal.preguntaId) ?? null;
        return {
          mapeoId: m.id,
          porque: m.porque,
          senal: { id: senal.id, nombre: senal.nombre, preguntaId: senal.preguntaId },
          hecho: hecho
            ? {
                preguntaId: hecho.preguntaId,
                enunciado: hecho.enunciado,
                valor: hecho.valor ?? null,
              }
            : null,
          respuestaOriginal: respuesta
            ? {
                tipo: respuesta.tipo,
                detalle:
                  respuesta.tipo === 'afirmada'
                    ? respuesta.enunciado
                    : respuesta.tipo === 'contradictoria'
                      ? `${respuesta.aFavor} / ${respuesta.enContra}`
                      : 'sin información',
              }
            : null,
        };
      });
  }

  private candidatosDTO(
    comprension: ComprensionEvaluable,
    resultado: ResultadoEstrategia,
    respuestas: RespuestasDiagnostico,
  ) {
    if (resultado.tipo !== 'PROPUESTA') return [];
    return resultado.candidatos.map((c) => ({
      objetivoId: c.objetivoId,
      objetivo: c.objetivo,
      metrica: c.metrica,
      costoMedicion: c.costoMedicion,
      confianza: c.confianza,
      confianzaTexto: CONF_ES[c.confianza] ?? c.confianza,
      explicacion: c.explicacion,
      estrategiasSugeridas: c.estrategiasSugeridas,
      advertenciasRegulatorias: c.advertenciasRegulatorias,
      factoresConfianza: c.factoresConfianza,
      trazabilidad: {
        objetivoId: c.objetivoId,
        cadena: this.trazabilidad(
          c.objetivoId,
          c.procedencia.senalesActivas,
          comprension,
          respuestas,
        ),
        entradasRubro: c.procedencia.entradasRubro,
      },
      impacto: {
        siAcepto: `Si aceptas, «${c.objetivo}» queda como objetivo VIGENTE de esta evaluación. NO se ejecuta ninguna acción: Preparación (aún no construida) lo transformará después en un plan.`,
        siRechazo:
          'Si rechazas, queda registrado como decisión; el objetivo vigente actual no cambia.',
      },
    }));
  }

  async estado(
    organizationId: string,
    departamentoId: string,
    evaluacionId: string,
  ): Promise<unknown> {
    const ctx = this.ctx(organizationId);
    const evalState = await new EvaluacionService(this.store).cargar(
      ctx,
      departamentoId,
      evaluacionId,
    );
    const gen = generacionVigente(evalState);
    const gob = await new DecisionService(this.store).cargar(
      ctx,
      this.alcance(departamentoId, evaluacionId),
    );

    const gobierno = {
      vigente: gob.vigente
        ? {
            decisionId: gob.vigente.decisionId,
            objetivoId: gob.vigente.candidato.objetivoId,
            objetivo: gob.vigente.candidato.objetivo,
            en: gob.vigente.en,
          }
        : null,
      historial: gob.decisiones.map((d) => ({
        decisionId: d.decisionId,
        resultado: d.resultado,
        estadoRegistro: d.estadoRegistro,
        objetivoId: d.candidatoElegido?.objetivoId ?? null,
        objetivo: d.candidatoElegido?.objetivo ?? null,
        categoria: d.justificacion.categoria,
        justificacion: d.justificacion.texto,
        en: d.en,
      })),
    };
    const base = {
      organizationId,
      departamento: departamentoId,
      evaluacionId,
      evaluacionExiste: evalState.existe,
    };

    if (!gen) {
      return {
        ...base,
        sinEvaluacion: true,
        tieneRespuestas: Object.keys(evalState.respuestas).length > 0,
        propuestaDisponible: false,
        abstencion: null,
        cobertura: null,
        generacion: null,
        comprension: { hechos: [], faltantes: [], contradicciones: [] },
        candidatos: [],
        transparencia: {
          confianzaGlobal: 'sin evaluación',
          incertidumbre: 'no evaluada',
          supuestos: [],
          proximosDatosMasValiosos: [],
        },
        gobierno,
      };
    }

    const { comprension, resultado } = await this.proponerDesde(gen.respuestas, gen.en);
    const candidatos = this.candidatosDTO(comprension, resultado, gen.respuestas);
    return {
      ...base,
      sinEvaluacion: false,
      tieneRespuestas: true,
      propuestaDisponible: resultado.tipo === 'PROPUESTA',
      abstencion: resultado.tipo === 'ABSTENCION' ? resultado.abstencion : null,
      cobertura: resultado.tipo === 'PROPUESTA' ? resultado.cobertura : null,
      generacion: { generacionId: gen.generacionId, huella: gen.huella, en: gen.en },
      comprension: {
        hechos: comprension.hechos,
        faltantes: comprension.faltantes,
        contradicciones: comprension.contradicciones,
      },
      candidatos,
      transparencia: {
        confianzaGlobal: candidatos[0]?.confianzaTexto ?? 'sin propuesta',
        incertidumbre: comprension.comprension.incertidumbre,
        supuestos: this.rubro.supuestos().map((s) => ({ id: s.id, texto: s.supuesto })),
        proximosDatosMasValiosos: comprension.faltantes.map(
          (f) => `Responder «${f.preguntaId}» reduciría la incertidumbre.`,
        ),
      },
      gobierno,
    };
  }

  async decidir(input: {
    organizationId: string;
    departamentoId: string;
    evaluacionId: string;
    decisionId: string;
    resultado: ResultadoDecision;
    objetivoId?: string | null;
    justificacion: { texto: string; categoria: CategoriaJustificacion };
  }): Promise<unknown> {
    const ctx = this.ctx(input.organizationId);
    const alcance = this.alcance(input.departamentoId, input.evaluacionId);
    const evalState = await new EvaluacionService(this.store).cargar(
      ctx,
      input.departamentoId,
      input.evaluacionId,
    );
    const gen = generacionVigente(evalState);
    if (!gen)
      throw new Error(
        'No hay una comprensión generada para decidir; genera la evaluación primero.',
      );
    const { comprension, resultado } = await this.proponerDesde(gen.respuestas, gen.en);
    const svc = new DecisionService(this.store);
    const gob = await svc.cargar(ctx, alcance);
    const candidato =
      input.resultado === 'ACEPTADO' && resultado.tipo === 'PROPUESTA'
        ? (resultado.candidatos.find((c) => c.objetivoId === input.objetivoId) ?? null)
        : null;
    await svc.registrar(
      ctx,
      alcance,
      {
        decisionId: input.decisionId,
        resultado: input.resultado,
        candidatoElegido: candidato,
        propuesta: this.snapshot(comprension, resultado),
        justificacion: input.justificacion,
        ...(input.resultado === 'ACEPTADO' && gob.vigente
          ? { reemplazaDecisionId: gob.vigente.decisionId }
          : {}),
      },
      ATRIBUCION,
      this.clock.now(),
    );
    return this.estado(input.organizationId, input.departamentoId, input.evaluacionId);
  }

  async revocar(
    organizationId: string,
    departamentoId: string,
    evaluacionId: string,
    decisionId: string,
    motivo: string,
  ): Promise<unknown> {
    await new DecisionService(this.store).revocar(
      this.ctx(organizationId),
      this.alcance(departamentoId, evaluacionId),
      decisionId,
      motivo,
      ATRIBUCION,
      this.clock.now(),
    );
    return this.estado(organizationId, departamentoId, evaluacionId);
  }
}
