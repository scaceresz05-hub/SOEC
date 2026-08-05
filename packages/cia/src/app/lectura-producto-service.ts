/**
 * @soec/cia · app · LECTURA DE PRODUCTO (`LecturaCIAProducto`) — puerto único, inmutable, multi-tenant.
 *
 * Un solo lugar de lectura para la experiencia (Inicio/Decisiones/Por qué/Autonomía/Salud). La vista de
 * PRODUCTO NUNCA contiene proveedor, secreto, SDK, endpoint, nombre comercial, stack ni errores crudos: sólo
 * resultados en lenguaje humano. El detalle técnico (proveedor detrás de la frontera) vive en una lectura de
 * AUDITORÍA SEPARADA. La instantánea se entrega CONGELADA EN PROFUNDIDAD (inmutable en runtime).
 */
import type { RequestContext } from '@soec/contracts';
import { AutorizacionesService } from './autorizaciones-service';
import { PlanificadorService } from './planificador-service';
import { PresupuestoService } from './presupuesto-service';
import { KillSwitchService } from './kill-switch-service';
import { LecturaIntegracionesService, type CapacidadActivaVista, type DecisionIntegracionVista } from './lectura-integraciones-service';
import { CatalogoService, type CapacidadCatalogoVista } from './catalogo-service';

export type EstadoSaludProducto = 'normal' | 'atencion' | 'pausado';
export interface SaludProducto { readonly estado: EstadoSaludProducto; readonly titulo: string; readonly detalle: string }

export interface VistaProducto {
  readonly modo: 'simulado';
  readonly catalogo: readonly CapacidadCatalogoVista[];
  readonly capacidades: readonly CapacidadActivaVista[];
  readonly decisiones: readonly DecisionIntegracionVista[];
  readonly salud: SaludProducto;
}

/** Vista TÉCNICA separada (auditoría): aquí —y sólo aquí— aparece el proveedor detrás de la frontera. */
export interface VistaAuditoria {
  readonly planId: string;
  readonly capacidadId: string;
  readonly proveedorElegidoRef: string | null;
  readonly evidenciaSimulada: string | null;
  readonly estado: string;
}

/** Congela en profundidad: la instantánea de producto no puede mutarse en runtime. */
export function congelarProfundo<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as Record<string, unknown>)) congelarProfundo((v as Record<string, unknown>)[k]);
  }
  return v;
}

export class LecturaCIAProductoService {
  constructor(
    private readonly catalogo: CatalogoService,
    private readonly lectura: LecturaIntegracionesService,
    private readonly autorizaciones: AutorizacionesService,
    private readonly planificador: PlanificadorService,
    private readonly presupuesto: PresupuestoService,
    private readonly kill: KillSwitchService,
  ) {}

  /** Instantánea de PRODUCTO, congelada, sin proveedor ni tecnicismos. */
  async producto(ctx: RequestContext): Promise<VistaProducto> {
    const [catalogo, capacidades, decisiones] = await Promise.all([
      Promise.resolve(this.catalogo.listar()), this.lectura.home(ctx), this.lectura.decisiones(ctx),
    ]);
    const killSt = await this.kill.cargar(ctx);
    const salud: SaludProducto = killSt.activos.length > 0
      ? { estado: 'pausado', titulo: 'En pausa', detalle: 'Detuve acciones a tu pedido. Puedes reactivarlas cuando quieras.' }
      : decisiones.length > 0
        ? { estado: 'atencion', titulo: 'Necesito una decisión tuya', detalle: `Tienes ${decisiones.length} decisión(es) esperándote.` }
        : { estado: 'normal', titulo: 'Todo en orden', detalle: 'No necesito nada de ti ahora mismo.' };
    return congelarProfundo({ modo: 'simulado', catalogo, capacidades, decisiones, salud });
  }

  /** Lectura TÉCNICA separada (auditoría), con el proveedor detrás de la frontera. No es vista de usuario. */
  async auditoriaTecnica(ctx: RequestContext): Promise<readonly VistaAuditoria[]> {
    const out: VistaAuditoria[] = [];
    for (const planId of await this.planificador.listarPlanes(ctx)) {
      const a = await this.lectura.auditoria(ctx, planId);
      if (a) out.push(a);
    }
    return congelarProfundo(out);
  }
}
