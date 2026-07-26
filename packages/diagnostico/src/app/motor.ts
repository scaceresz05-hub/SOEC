/**
 * @soec/diagnostico · app · Motor de Diagnóstico.
 *
 * Traduce respuestas estructuradas de una instancia en EVIDENCIA sintética (MED/MDM),
 * construye su ECE y ejecuta la capacidad NEUTRAL y ÚNICA «Comprender el estado»
 * (reutilizada de @soec/capacidades, no un motor paralelo), devolviendo una comprensión
 * EVALUABLE con hechos, faltantes y contradicciones — cada uno con procedencia estable.
 *
 * Límites: reutiliza la capacidad existente; el conocimiento del rubro entra SOLO por
 * `RubroKnowledgePort`; no genera estrategia, no registra objetivos, no toca
 * Preparación/Operación; sin efectos reales; sin IA generativa (mecanismo determinista);
 * el `EventStore` se INYECTA (el motor no crea persistencia ni conexiones).
 */
import {
  ActorId,
  type Attribution,
  type EventStore,
  OrganizationId,
  type RequestContext,
} from '@soec/contracts';
import { MedService, MdmService } from '@soec/models';
import { EceBuildService, EceQueryService } from '@soec/ece';
import { MecanismoDeterministico, OperacionesService } from '@soec/operaciones';
import {
  CAPACIDAD_COMPRENDER_ESTADO_ID,
  CapabilitiesOrchestrator,
  CapabilityQueryService,
  CapabilityRegistry,
  definicionComprenderEstado,
} from '@soec/capacidades';
import type { RubroKnowledgePort } from '@soec/rubros';
import type {
  ComprensionEvaluable,
  ContradiccionDiagnostico,
  FaltanteDiagnostico,
  HechoComprendido,
  OperacionEjecutada,
  RespuestasDiagnostico,
} from '../domain/tipos';

const ORG = 'diagnostico-org';
const ACTOR = 'diagnostico';
const ATRIBUCION: Attribution = {
  source: 'motor-diagnostico',
  purpose: 'comprender el estado de la instancia a partir de un diagnóstico estructurado',
  assumptions: ['instancia sintética a partir de respuestas; ningún dato real'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};
const VIGENCIA = { desde: '2026-01-01T00:00:00.000Z', hasta: null };

export interface MotorDiagnosticoDeps {
  readonly med: MedService;
  readonly mdm: MdmService;
  readonly eceBuild: EceBuildService;
  readonly registry: CapabilityRegistry;
  readonly orchestrator: CapabilitiesOrchestrator;
  readonly operaciones: OperacionesService;
  readonly capQuery: CapabilityQueryService;
  readonly rubro: RubroKnowledgePort;
}

export interface OpcionesComprender {
  readonly diagnosticoId: string;
  readonly occurredAt: string;
  readonly ejecucionId?: string;
}

export interface MotorDiagnostico {
  comprender(
    respuestas: RespuestasDiagnostico,
    opts: OpcionesComprender,
  ): Promise<ComprensionEvaluable>;
}

function ctxDe(): RequestContext {
  const organizationId = OrganizationId(ORG);
  return {
    organizationId,
    actor: ActorId(ACTOR),
    scope: { organizationId, permissions: ['events:append', 'events:read'] },
    correlationId: `dx-${ORG}`,
  };
}

function ordenar(xs: readonly string[]): string[] {
  return [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function crearMotorDiagnostico(deps: MotorDiagnosticoDeps): MotorDiagnostico {
  return {
    async comprender(respuestas, opts) {
      const ctx = ctxDe();
      const c = { attribution: ATRIBUCION, occurredAt: opts.occurredAt };
      const medId = `dx-med:${opts.diagnosticoId}`;
      const mdmId = `dx-mdm:${opts.diagnosticoId}`;
      const eceId = `dx-ece:${opts.diagnosticoId}`;
      const ejecId = opts.ejecucionId ?? `dx-exec:${opts.diagnosticoId}`;

      const porPregunta = new Map(respuestas.map((r) => [r.preguntaId, r]));
      const preguntas = ordenar([
        ...deps.rubro.preguntasDiagnosticas(),
        ...respuestas.map((r) => r.preguntaId),
      ]);

      await deps.med.crear(ctx, {
        instanceId: medId,
        ambito: {
          proposito: 'representar el estado declarado de la instancia a partir del diagnóstico',
          representa: 'lo que la instancia afirma, ignora o sobre lo que se contradice',
          excluye: 'el entorno de mercado y las normas (eso es el MDM)',
          supuestos: ['instancia sintética; ningún dato real'],
        },
        vigencia: VIGENCIA,
        ...c,
      });
      await deps.mdm.crear(ctx, {
        instanceId: mdmId,
        ambito: {
          proposito: 'representar el entorno de la instancia (mínimo en el diagnóstico)',
          representa: 'contexto externo declarado',
          excluye: 'la configuración interna (eso es el MED)',
          supuestos: ['entorno sintético; ningún dato real'],
        },
        vigencia: VIGENCIA,
        ...c,
      });

      const hechos: HechoComprendido[] = [];
      const faltantes: FaltanteDiagnostico[] = [];
      const contradicciones: ContradiccionDiagnostico[] = [];
      let primeraContradiccion: string | null = null;

      for (let i = 0; i < preguntas.length; i += 1) {
        const preguntaId = preguntas[i]!;
        const afId = `af-${i}`;
        const r = porPregunta.get(preguntaId);

        if (r && r.tipo === 'afirmada') {
          const evId = `${afId}-ev`;
          await deps.med.emitirAfirmacion(ctx, {
            instanceId: medId,
            afirmacionId: afId,
            enunciado: r.enunciado,
            dimension: 'es',
            incertidumbre: 'baja',
            ...c,
          });
          await deps.med.incorporarEvidencia(ctx, {
            instanceId: medId,
            evidenciaId: evId,
            afirmacionId: afId,
            relacion: 'sostiene',
            procedencia: 'respuesta del diagnóstico',
            contenido: r.sustento,
            ...c,
          });
          await deps.med.revisarAfirmacion(ctx, {
            instanceId: medId,
            afirmacionId: afId,
            nuevoEstado: 'respaldada',
            motivo: 'evidencia declarada en el diagnóstico',
            ...c,
          });
          hechos.push({
            preguntaId,
            afirmacionId: afId,
            evidenciaIds: [evId],
            enunciado: r.enunciado,
            ...(r.valor !== undefined ? { valor: r.valor } : {}),
          });
        } else if (r && r.tipo === 'contradictoria') {
          await deps.med.emitirAfirmacion(ctx, {
            instanceId: medId,
            afirmacionId: afId,
            enunciado: r.enunciado,
            dimension: 'es',
            incertidumbre: 'alta',
            ...c,
          });
          await deps.med.incorporarEvidencia(ctx, {
            instanceId: medId,
            evidenciaId: `${afId}-si`,
            afirmacionId: afId,
            relacion: 'sostiene',
            procedencia: 'respuesta a favor',
            contenido: r.aFavor,
            ...c,
          });
          await deps.med.incorporarEvidencia(ctx, {
            instanceId: medId,
            evidenciaId: `${afId}-no`,
            afirmacionId: afId,
            relacion: 'debilita',
            procedencia: 'respuesta en contra',
            contenido: r.enContra,
            ...c,
          });
          contradicciones.push({
            preguntaId,
            afirmacionId: afId,
            evidenciaAFavor: [`${afId}-si`],
            evidenciaEnContra: [`${afId}-no`],
          });
          if (primeraContradiccion === null) primeraContradiccion = afId;
        } else {
          // Ausente (respondida como tal) o no respondida: entidad técnica PENDIENTE,
          // neutral — nunca una afirmación negativa sobre la instancia.
          await deps.med.emitirAfirmacion(ctx, {
            instanceId: medId,
            afirmacionId: afId,
            enunciado: `estado respecto de: ${preguntaId}`,
            dimension: 'es',
            incertidumbre: 'alta',
            limitacion: 'sin respuesta suficiente en el diagnóstico',
            ...c,
          });
          faltantes.push({
            preguntaId,
            motivo: r ? 'RESPUESTA_AUSENTE' : 'SIN_RESPUESTA',
            mensaje: `No existe información suficiente sobre: ${preguntaId}`,
          });
        }
      }

      await deps.eceBuild.construir(ctx, {
        eceId,
        medInstanceId: medId,
        mdmInstanceId: mdmId,
        ...c,
      });

      const { version } = await deps.registry.registrarVersion(
        ctx,
        CAPACIDAD_COMPRENDER_ESTADO_ID,
        definicionComprenderEstado(ATRIBUCION),
      );
      await deps.registry.publicar(ctx, CAPACIDAD_COMPRENDER_ESTADO_ID, version);

      const objetivos = primeraContradiccion
        ? { e1: `der:contradiccion:MED:${medId}:${primeraContradiccion}` }
        : undefined;
      const { producto } = await deps.orchestrator.ejecutar(ctx, ejecId, {
        capabilityId: CAPACIDAD_COMPRENDER_ESTADO_ID,
        eceId,
        attribution: ATRIBUCION,
        occurredAt: opts.occurredAt,
        idempotencyKey: ejecId,
        mecanismo: 'determinístico',
        ...(objetivos ? { objetivos } : {}),
      });

      const operaciones: OperacionEjecutada[] = [];
      for (const paso of producto.operacionesEjecutadas) {
        const p = await deps.operaciones.producto(ctx, paso.operacionExecutionId);
        operaciones.push({ operacion: paso.operacion, mecanismo: p?.mecanismo ?? null });
      }

      return {
        diagnosticoId: opts.diagnosticoId,
        rubroId: deps.rubro.rubroId(),
        hechos,
        faltantes,
        contradicciones,
        abstenido: producto.abstenido,
        comprension: {
          nombre: producto.nombre,
          incertidumbre: producto.incertidumbre,
          contradiccionesAbiertas: producto.contradiccionesAbiertas,
          faltante: producto.faltante,
          productoCompuesto: producto.productoCompuesto,
        },
        operaciones,
      };
    },
  };
}

/**
 * Composición explícita en memoria: dado un `EventStore` INYECTADO, arma el pipeline
 * determinista (solo `MecanismoDeterministico`) y devuelve el motor. No abre conexiones
 * ni decide dónde persistir; el llamador provee el store.
 */
export function componerMotorDiagnostico(
  store: EventStore,
  rubro: RubroKnowledgePort,
): MotorDiagnostico {
  const med = new MedService(store);
  const mdm = new MdmService(store);
  const eceBuild = new EceBuildService(store, med, mdm);
  const eceQuery = new EceQueryService(store, med, mdm);
  const operaciones = new OperacionesService(store, eceQuery, [new MecanismoDeterministico()]);
  const registry = new CapabilityRegistry(store);
  const orchestrator = new CapabilitiesOrchestrator(store, registry, operaciones);
  const capQuery = new CapabilityQueryService(store);
  return crearMotorDiagnostico({
    med,
    mdm,
    eceBuild,
    registry,
    orchestrator,
    operaciones,
    capQuery,
    rubro,
  });
}
