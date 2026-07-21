/**
 * Servicio coordinador de operaciones intelectuales (§20).
 *
 * Recibe una solicitud tipada, valida contexto y propósito, lee el ECE SOLO por su
 * puerto de lectura, selecciona un mecanismo autorizado, ejecuta, aplica los
 * guardarraíles de soberanía y anti-atrofia, y persiste el producto o la abstención
 * como eventos append-only. No modifica MED/MDM/ECE, no ejecuta efectos externos,
 * no crea capacidades, no toma decisiones humanas.
 */
import type { EventInput, EventStore, RequestContext } from '@soec/contracts';
import type { EceReadPort } from '@soec/ece';
import {
  EVENTOS_OI,
  type OiState,
  oiStreamId,
  reconstruirOi,
} from '../domain/aggregate';
import type { MecanismoOperacion, SolicitudOperacion } from '../domain/mechanism';
import {
  MecanismoNoDisponibleError,
  ProductoOpacoError,
  SoberaniaVioladaError,
  SolicitudInvalidaError,
} from '../domain/errors';
import { type CorteEce, type ProductoIntelectual, esOpaco, violaSoberania } from '../domain/product';
import type { OperacionesPort } from './operations-port';
import { abstener, baseProducto, construir } from './product-builder';

export interface OiResultado {
  readonly state: OiState;
  readonly producto: ProductoIntelectual;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class OperacionesService implements OperacionesPort {
  private readonly mecanismos: readonly MecanismoOperacion[];

  constructor(
    private readonly store: EventStore,
    private readonly ece: EceReadPort,
    mecanismos: readonly MecanismoOperacion[],
  ) {
    if (mecanismos.length === 0) throw new SolicitudInvalidaError('Se requiere al menos un mecanismo');
    this.mecanismos = mecanismos;
  }

  private async cargar(ctx: RequestContext, executionId: string): Promise<OiState> {
    const events = await this.store.readStream(ctx, oiStreamId(executionId));
    return reconstruirOi(executionId, ctx.organizationId, events);
  }

  /** Frontera pública: producto de una ejecución previa (o null si no existe). */
  async producto(ctx: RequestContext, executionId: string): Promise<ProductoIntelectual | null> {
    return (await this.cargar(ctx, executionId)).producto;
  }

  private seleccionar(sol: SolicitudOperacion): MecanismoOperacion {
    const candidatos = this.mecanismos.filter((m) => m.soporta(sol.operacion));
    const elegido = sol.mecanismo ? candidatos.find((m) => m.nombre === sol.mecanismo) : candidatos[0];
    if (!elegido) {
      throw new MecanismoNoDisponibleError(
        `No hay mecanismo autorizado para '${sol.operacion}'${sol.mecanismo ? ` con nombre '${sol.mecanismo}'` : ''}`,
      );
    }
    return elegido;
  }

  private input(type: string, payload: unknown, sol: SolicitudOperacion): EventInput {
    const base: EventInput = { type, payload, attribution: sol.attribution, occurredAt: sol.occurredAt };
    return sol.idempotencyKey ? { ...base, idempotencyKey: `${sol.idempotencyKey}:${type}` } : base;
  }

  /** Ejecuta una operación intelectual y devuelve un producto NO vinculante. */
  async ejecutar(
    ctx: RequestContext,
    executionId: string,
    sol: SolicitudOperacion,
    signal?: AbortSignal,
  ): Promise<OiResultado> {
    if (!sol.proposito || !sol.proposito.trim()) {
      throw new SolicitudInvalidaError('Toda ejecución debe declarar su propósito');
    }

    // Idempotencia por identidad de ejecución: si ya se produjo, se devuelve tal cual.
    const previo = await this.cargar(ctx, executionId);
    if (previo.existe && previo.producto) return { state: previo, producto: previo.producto };

    const mecanismo = this.seleccionar(sol);

    // Lee el ECE SOLO por su puerto (nunca tablas de MED/MDM/ECE).
    const eceState = sol.asOfRecordedAt
      ? await this.ece.estadoEnFecha(ctx, sol.eceId, sol.asOfRecordedAt)
      : await this.ece.estadoActual(ctx, sol.eceId);
    const eceCorte: CorteEce = { version: eceState.version, recordedAt: sol.asOfRecordedAt ?? null };

    let version = previo.version;
    if (!previo.existe) {
      const r = await this.store.append(ctx, oiStreamId(executionId), version, [
        this.input(
          EVENTOS_OI.solicitada,
          {
            operacion: sol.operacion,
            proposito: sol.proposito,
            eceId: sol.eceId,
            eceCorte,
            mecanismo: mecanismo.nombre,
            mecanismoVersion: mecanismo.version,
          },
          sol,
        ),
      ]);
      version = r.version;
    }

    const contexto = {
      operacion: sol.operacion,
      proposito: sol.proposito,
      eceId: sol.eceId,
      eceState,
      eceCorte,
      objetivoElementoId: sol.objetivoElementoId ?? null,
      horizonte: sol.horizonte ?? null,
      attribution: sol.attribution,
    };

    // Abstenciones técnicas antes de ejecutar.
    let producto: ProductoIntelectual;
    if (signal?.aborted) {
      producto = abstener(contexto, mecanismo, 'cancelacion', { razones: ['la ejecución fue cancelada antes de iniciar'] });
    } else if (sol.maxMs !== undefined && sol.maxMs <= 0) {
      producto = abstener(contexto, mecanismo, 'limite_presupuestario', { razones: ['presupuesto técnico agotado'] });
    } else if (sol.dataPolicy === 'must-stay-internal' && mecanismo.requiereSalidaDeOrg === true) {
      producto = abstener(contexto, mecanismo, 'politica_datos', {
        razones: [`el mecanismo '${mecanismo.nombre}' requeriría salida de la organización`],
      });
    } else {
      producto = await this.ejecutarConLimite(ctx, mecanismo, contexto, sol.maxMs, signal);
    }

    // Guardarraíles verificables.
    if (violaSoberania(producto)) {
      throw new SoberaniaVioladaError('Un producto intelectual jamás es una decisión vinculante');
    }
    if (esOpaco(producto)) {
      throw new ProductoOpacoError('Un producto no puede ser una conclusión opaca (anti-atrofia)');
    }

    if (!previo.producto) {
      await this.store.append(ctx, oiStreamId(executionId), version, [
        this.input(producto.abstenido ? EVENTOS_OI.abstenida : EVENTOS_OI.ejecutada, { producto }, sol),
      ]);
    }

    const state = await this.cargar(ctx, executionId);
    return { state, producto };
  }

  private async ejecutarConLimite(
    ctx: RequestContext,
    mecanismo: MecanismoOperacion,
    contexto: Parameters<MecanismoOperacion['ejecutar']>[1],
    maxMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<ProductoIntelectual> {
    if (maxMs === undefined) return mecanismo.ejecutar(ctx, contexto, signal);
    const controlador = new AbortController();
    if (signal) signal.addEventListener('abort', () => controlador.abort(), { once: true });
    let vencio = false;
    const temporizador = sleep(maxMs).then(() => {
      vencio = true;
      controlador.abort();
    });
    const producto = await Promise.race([
      mecanismo.ejecutar(ctx, contexto, controlador.signal),
      temporizador.then(() => null),
    ]);
    if (producto && !vencio) return producto;
    return abstener(contexto, mecanismo, 'timeout', { razones: [`la ejecución excedió ${maxMs} ms`] });
  }
}

/** Consulta de ejecuciones (lectura por reconstrucción). */
export class OperacionesQueryService {
  constructor(private readonly store: EventStore) {}

  private cargar(ctx: RequestContext, executionId: string): Promise<OiState> {
    return this.store
      .readStream(ctx, oiStreamId(executionId))
      .then((events) => reconstruirOi(executionId, ctx.organizationId, events));
  }

  ejecucion(ctx: RequestContext, executionId: string): Promise<OiState> {
    return this.cargar(ctx, executionId);
  }

  async ejecucionEnFecha(ctx: RequestContext, executionId: string, asOfRecordedAt: string): Promise<OiState> {
    const events = await this.store.reconstructAt(ctx, oiStreamId(executionId), asOfRecordedAt);
    return reconstruirOi(executionId, ctx.organizationId, events);
  }

  async producto(ctx: RequestContext, executionId: string): Promise<ProductoIntelectual | null> {
    return (await this.cargar(ctx, executionId)).producto;
  }
}

// Reexport interno para el helper de construcción usado por mecanismos externos.
export { abstener, baseProducto, construir };
