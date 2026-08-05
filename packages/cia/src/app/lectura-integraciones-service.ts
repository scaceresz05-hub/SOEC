/**
 * @soec/cia · app · LECTURA capability-framed para la experiencia del Director (HOME · Decisiones · Por qué).
 *
 * Traduce las autorizaciones y planes del CIA a vistas de USUARIO que hablan de RESULTADOS, jamás de
 * herramientas. Garantía dura: ninguna vista de usuario contiene una referencia de proveedor — sólo
 * `auditoria()` la expone, y sólo para rendición de cuentas. Conectar una integración no crea módulos ni
 * cambia estas vistas: siguen siendo Inicio, Decisiones y Por qué.
 */
import type { RequestContext } from '@soec/contracts';
import { buscarCapacidad } from '../dominio/catalogo';
import { disponibleSimulado, limiteEfectivo } from '../dominio/autorizacion';
import { AutorizacionesService } from './autorizaciones-service';
import { PlanificadorService } from './planificador-service';

export interface CapacidadActivaVista {
  readonly capacidadId: string;
  readonly titulo: string; // resultado, no herramienta
  readonly estado: 'Activa' | 'En pausa' | 'Pendiente';
  readonly limite: number;
  readonly consumidoSimulado: number;
  readonly disponible: number;
}
export interface DecisionIntegracionVista {
  readonly planId: string;
  readonly titulo: string; // resultado
  readonly objetivo: string;
  readonly costoEstimado: number;
}
export interface ExplicacionIntegracionVista {
  readonly planId: string;
  readonly queHace: string; // resultado, en llano
  readonly objetivo: string;
  readonly costoEstimado: number;
  readonly estado: string;
  readonly modo: 'simulado';
}
/** Vista de AUDITORÍA (rendición de cuentas): aquí —y sólo aquí— aparece el proveedor detrás de la frontera. */
export interface AuditoriaIntegracionVista {
  readonly planId: string;
  readonly capacidadId: string;
  readonly proveedorElegidoRef: string | null;
  readonly evidenciaSimulada: string | null;
  readonly estado: string;
}

export class LecturaIntegracionesService {
  constructor(
    private readonly autorizaciones: AutorizacionesService,
    private readonly planificador: PlanificadorService,
  ) {}

  /** HOME: capacidades autorizadas como resultados, con su límite y consumo simulado. Sin proveedor. */
  async home(ctx: RequestContext): Promise<readonly CapacidadActivaVista[]> {
    const ids = await this.autorizaciones.listar(ctx);
    const out: CapacidadActivaVista[] = [];
    for (const id of ids) {
      const cap = buscarCapacidad(id);
      const st = await this.autorizaciones.cargar(ctx, id);
      out.push({
        capacidadId: id,
        titulo: cap?.titulo ?? id,
        estado: st.estado === 'AUTORIZADA' ? 'Activa' : st.estado === 'PAUSADA' ? 'En pausa' : 'Pendiente',
        limite: limiteEfectivo(st),
        consumidoSimulado: st.consumidoSimulado,
        disponible: disponibleSimulado(st),
      });
    }
    return out;
  }

  /** Decisiones: planes que esperan una persona (bandeja única de autorizaciones). Sin proveedor. */
  async decisiones(ctx: RequestContext): Promise<readonly DecisionIntegracionVista[]> {
    const planIds = await this.planificador.listarPlanes(ctx);
    const out: DecisionIntegracionVista[] = [];
    for (const planId of planIds) {
      const p = await this.planificador.cargar(ctx, planId);
      if (p.estado === 'PENDIENTE_APROBACION') {
        const cap = buscarCapacidad(p.capacidadId);
        out.push({ planId, titulo: cap?.titulo ?? p.capacidadId, objetivo: p.objetivo, costoEstimado: p.costoEstimado });
      }
    }
    return out;
  }

  /** Por qué: explicación de una acción, en lenguaje de resultado. Sin proveedor. */
  async explicacion(ctx: RequestContext, planId: string): Promise<ExplicacionIntegracionVista | null> {
    const p = await this.planificador.cargar(ctx, planId);
    if (!p.existe) return null;
    const cap = buscarCapacidad(p.capacidadId);
    return {
      planId,
      queHace: cap?.descripcion ?? cap?.titulo ?? p.capacidadId,
      objetivo: p.objetivo,
      costoEstimado: p.costoEstimado,
      estado: p.estado,
      modo: 'simulado',
    };
  }

  /** Auditoría: rendición de cuentas. Expone el proveedor detrás de la frontera. NO es una vista de usuario. */
  async auditoria(ctx: RequestContext, planId: string): Promise<AuditoriaIntegracionVista | null> {
    const p = await this.planificador.cargar(ctx, planId);
    if (!p.existe) return null;
    return { planId, capacidadId: p.capacidadId, proveedorElegidoRef: p.proveedorElegidoRef, evidenciaSimulada: p.evidenciaSimulada, estado: p.estado };
  }
}
