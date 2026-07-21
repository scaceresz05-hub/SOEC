/**
 * Orquestador de capacidades (§15).
 *
 * Compone operaciones intelectuales para un propósito humano. La ÚNICA ruta
 * cognitiva es: Capacidad → OperacionesPort → (internamente) EceReadPort. NO accede
 * al ECE, MED ni MDM. No ejecuta acciones, no decide, no modifica nada: entrega un
 * producto compuesto y NO vinculante al juicio de la persona.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { OperacionesPort, ProductoIntelectual, SolicitudOperacion } from '@soec/operaciones';
import {
  type CapExecState,
  EVENTOS_CAPEXEC,
  capexecStreamId,
  reconstruirCapExec,
} from '../domain/aggregate-execution';
import type { DefinicionVersion, PasoComposicion } from '../domain/definition';
import { DefinicionInvalidaError, GuardarrailCapacidadError } from '../domain/errors';
import {
  type PasoEjecutado,
  type ProductoCapacidad,
  esOpacaCapacidad,
  violaSoberaniaCapacidad,
} from '../domain/product';
import type { CapabilityRegistry } from './registry';

export interface SolicitudCapacidad {
  readonly capabilityId: string;
  readonly eceId: string;
  readonly version?: number;
  readonly proposito?: string;
  /** Corte histórico del ECE (indirecto, vía operaciones). */
  readonly asOfRecordedAt?: string;
  /** Objetivos por paso (p. ej. qué elemento del ECE esclarecer). */
  readonly objetivos?: Readonly<Record<string, string>>;
  readonly attribution: Attribution;
  readonly occurredAt: string;
  readonly idempotencyKey?: string;
  readonly maxMs?: number;
  readonly dataPolicy?: 'may-leave-org' | 'must-stay-internal';
  readonly mecanismo?: string;
}

export interface CapResultado {
  readonly state: CapExecState;
  readonly producto: ProductoCapacidad;
}

function resumenProducto(p: ProductoIntelectual): string {
  if (p.abstenido) return `abstención: ${p.causaAbstencion}`;
  switch (p.operacion) {
    case 'esclarecer':
      return p.esclarecimiento.contradiccionSinResolver ? 'esclarece una contradicción sin resolver' : 'esclarece la estructura';
    case 'detectar':
      return `${p.deteccion.senales.length} señal(es)`;
    case 'proyectar':
      return `${p.proyeccion.escenarios.length} escenario(s)`;
    case 'orientar':
      return `${p.orientacion.consideraciones.length} consideración(es)`;
  }
}

/** Orden topológico determinístico de los pasos (respeta dependeDe; independientes por stepId). */
function ordenar(pasos: readonly PasoComposicion[]): PasoComposicion[] {
  const porId = new Map(pasos.map((p) => [p.stepId, p]));
  const salida: PasoComposicion[] = [];
  const estado = new Map<string, boolean>();
  const visit = (p: PasoComposicion): void => {
    if (estado.get(p.stepId)) return;
    estado.set(p.stepId, true);
    for (const dep of [...p.dependeDe].sort()) {
      const d = porId.get(dep);
      if (d) visit(d);
    }
    salida.push(p);
  };
  for (const p of [...pasos].sort((a, b) => a.stepId.localeCompare(b.stepId))) visit(p);
  return salida;
}

export class CapabilitiesOrchestrator {
  constructor(
    private readonly store: EventStore,
    private readonly registry: CapabilityRegistry,
    private readonly operaciones: OperacionesPort,
  ) {}

  private async cargar(ctx: RequestContext, executionId: string): Promise<CapExecState> {
    const events = await this.store.readStream(ctx, capexecStreamId(executionId));
    return reconstruirCapExec(executionId, ctx.organizationId, events);
  }

  private input(type: string, payload: unknown, att: Attribution, occurredAt: string, idem?: string): EventInput {
    const base: EventInput = { type, payload, attribution: att, occurredAt };
    return idem ? { ...base, idempotencyKey: idem } : base;
  }

  async ejecutar(ctx: RequestContext, executionId: string, req: SolicitudCapacidad, signal?: AbortSignal): Promise<CapResultado> {
    const previo = await this.cargar(ctx, executionId);
    if (previo.existe && previo.producto) return { state: previo, producto: previo.producto };

    const def = await this.registry.resolver(ctx, req.capabilityId, req.version);
    const proposito = (req.proposito?.trim() || def.proposito).trim();
    if (!proposito) throw new DefinicionInvalidaError('La ejecución de capacidad exige un propósito humano');

    let version = previo.version;
    if (!previo.existe) {
      const r = await this.store.append(ctx, capexecStreamId(executionId), version, [
        this.input(
          EVENTOS_CAPEXEC.solicitada,
          { capabilityId: req.capabilityId, version: def.version, proposito, eceId: req.eceId },
          req.attribution,
          req.occurredAt,
          req.idempotencyKey ? `${req.idempotencyKey}:sol` : undefined,
        ),
      ]);
      version = r.version;
    }

    const productos = new Map<string, ProductoIntelectual>();
    const pasosEjecutados: PasoEjecutado[] = [];
    let abstencionTotal: { paso: string; causa: string } | null = null;

    for (const paso of ordenar(def.pasos)) {
      const opExecId = `${executionId}:${paso.stepId}`;
      let propositoPaso = `${proposito} — ${paso.porque}`;
      if (paso.usaProductoDe) {
        const previoProd = productos.get(paso.usaProductoDe);
        if (previoProd) propositoPaso += ` (considerando: ${resumenProducto(previoProd)})`;
      }
      const sol: SolicitudOperacion = {
        operacion: paso.operacion,
        eceId: req.eceId,
        proposito: propositoPaso,
        ...(req.objetivos?.[paso.stepId] ?? paso.objetivoElementoId ? { objetivoElementoId: req.objetivos?.[paso.stepId] ?? paso.objetivoElementoId ?? undefined } : {}),
        ...(paso.horizonte ? { horizonte: paso.horizonte } : {}),
        ...(req.asOfRecordedAt ? { asOfRecordedAt: req.asOfRecordedAt } : {}),
        attribution: req.attribution,
        occurredAt: req.occurredAt,
        ...(req.idempotencyKey ? { idempotencyKey: `${req.idempotencyKey}:${paso.stepId}` } : {}),
        ...(req.maxMs !== undefined ? { maxMs: req.maxMs } : {}),
        ...(req.dataPolicy ? { dataPolicy: req.dataPolicy } : {}),
        ...(req.mecanismo ? { mecanismo: req.mecanismo } : {}),
      };
      const r = await this.operaciones.ejecutar(ctx, opExecId, sol, signal);
      productos.set(paso.stepId, r.producto);
      const pe: PasoEjecutado = {
        stepId: paso.stepId,
        operacion: paso.operacion,
        operacionExecutionId: opExecId,
        abstenido: r.producto.abstenido,
        causaAbstencion: r.producto.causaAbstencion,
        resumen: resumenProducto(r.producto),
      };
      pasosEjecutados.push(pe);
      await this.store.append(ctx, capexecStreamId(executionId), version, [
        this.input(EVENTOS_CAPEXEC.paso, pe, req.attribution, req.occurredAt),
      ]);
      version += 1;

      if (r.producto.abstenido && paso.obligatorio) {
        abstencionTotal = { paso: paso.stepId, causa: `operación intermedia abstenida (${r.producto.causaAbstencion})` };
        break;
      }
    }

    const producto = this.componer(req.capabilityId, def, proposito, req.eceId, pasosEjecutados, productos, abstencionTotal, req.attribution);
    if (violaSoberaniaCapacidad(producto)) {
      throw new GuardarrailCapacidadError('Una capacidad jamás es una decisión vinculante');
    }
    if (esOpacaCapacidad(producto)) {
      throw new GuardarrailCapacidadError('El producto de capacidad no puede ser opaco (anti-atrofia)');
    }

    await this.store.append(ctx, capexecStreamId(executionId), version, [
      this.input(producto.abstenido ? EVENTOS_CAPEXEC.abstenida : EVENTOS_CAPEXEC.compuesta, { producto }, req.attribution, req.occurredAt),
    ]);

    const state = await this.cargar(ctx, executionId);
    return { state, producto };
  }

  private componer(
    capabilityId: string,
    def: DefinicionVersion,
    proposito: string,
    eceId: string,
    pasos: readonly PasoEjecutado[],
    productos: Map<string, ProductoIntelectual>,
    abstencionTotal: { paso: string; causa: string } | null,
    attribution: Attribution,
  ): ProductoCapacidad {
    const intermedios = [...productos.values()];
    const uni = (f: (p: ProductoIntelectual) => readonly string[]): string[] => [
      ...new Set(intermedios.flatMap((p) => f(p))),
    ];
    const contradicciones: string[] = [];
    for (const p of intermedios) {
      if (p.operacion === 'esclarecer' && p.esclarecimiento.contradiccionSinResolver) {
        contradicciones.push(`esclarecimiento conserva una contradicción sin resolver`);
      }
      if (p.operacion === 'detectar') {
        for (const s of p.deteccion.senales) if (s.objeto.includes('contradicción')) contradicciones.push(`detección: ${s.objeto}`);
      }
    }
    const cuestiones = [...new Set([...uni((p) => p.cuestionesJuicioHumano), 'la decisión corresponde a la persona'])];

    return {
      capabilityId,
      version: def.version,
      nombre: def.nombre,
      proposito,
      operacionesEjecutadas: pasos,
      productosIntermedios: pasos.map((p) => p.operacionExecutionId),
      productoCompuesto: pasos.map((p) => `${p.operacion} [${p.stepId}]: ${p.resumen}`),
      evidencia: uni((p) => p.evidencia),
      procedencia: `capacidad '${def.nombre}' v${def.version} sobre ECE ${eceId}; entrega: ${def.contrato.entrega}; límite: ${def.contrato.limite}`,
      incertidumbre: 'heredada de las operaciones compuestas (no elevada)',
      limitaciones: [...uni((p) => p.limitaciones), ...(abstencionTotal ? [`abstención en el paso ${abstencionTotal.paso}`] : [])],
      faltante: uni((p) => p.faltante),
      contradiccionesAbiertas: [...new Set(contradicciones)],
      cuestionesJuicioHumano: cuestiones,
      abstenido: abstencionTotal !== null,
      causaAbstencion: abstencionTotal?.causa ?? null,
      pasoAfectado: abstencionTotal?.paso ?? null,
      bindingDecision: false,
      atribucion: attribution,
    };
  }
}
