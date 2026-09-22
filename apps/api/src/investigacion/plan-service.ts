/**
 * apps/api · PLANIFICACIÓN DE CAMPAÑAS · casos de uso del plan.
 *
 * Genera, versiona y envejece planes. Tres cosas que este servicio garantiza:
 *
 *  · UN PLAN SE APOYA EN UNA INVESTIGACIÓN CONCRETA. Se guarda de qué corrida salió; si esa corrida envejece,
 *    el plan envejece con ella y se dice por qué.
 *  · LOS PLANES NO SE SOBRESCRIBEN. Cada generación es una versión nueva y la anterior queda marcada, no borrada:
 *    el historial de lo que se propuso es parte de la explicación.
 *  · ESTA FASE NO EJECUTA NADA. El plan termina en `DRAFT` o `NON_EXECUTABLE` y no existe ninguna ruta que lo
 *    publique en Google o Meta.
 */
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioPolitica } from '../politica/politica-pg';
import { RepositorioOnboarding } from '../onboarding/onboarding-pg';
import { RepositorioInvestigacion } from './investigacion-pg';
import { RepositorioPlan, type GrupoDelPlan, type PlanCampania } from './plan-pg';
import { planificar } from './planificador';

export class NegocioSinPerfilError extends Error {}
export class SinInvestigacionError extends Error {}

export interface VistaPlan {
  readonly organizationId: string;
  readonly plan: PlanCampania | null;
  readonly grupos: readonly GrupoDelPlan[];
  readonly historial: readonly { readonly id: string; readonly version: number; readonly estado: string; readonly creadoEn: string }[];
  /** Por qué no se puede generar todavía, si es el caso. */
  readonly puedeGenerar: { readonly puede: boolean; readonly motivo: string | null };
}

export interface DepsPlan {
  readonly ahora?: () => string;
  readonly refrescar?: () => Promise<void>;
}

async function enTransaccion<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export class PlanService {
  private readonly repo: RepositorioPlan;
  private readonly investigacion: RepositorioInvestigacion;
  private readonly negocios: RepositorioNegocios;
  private readonly politica: RepositorioPolitica;
  private readonly onboarding: RepositorioOnboarding;
  private readonly ahora: () => string;

  constructor(private readonly pool: Pool, deps: DepsPlan = {}) {
    this.repo = new RepositorioPlan(pool);
    this.investigacion = new RepositorioInvestigacion(pool);
    this.negocios = new RepositorioNegocios(pool);
    this.politica = new RepositorioPolitica(pool);
    this.onboarding = new RepositorioOnboarding(pool);
    this.ahora = deps.ahora ?? (() => new Date().toISOString());
  }

  /** Último plan, sus grupos y el historial. Comprueba en la lectura si el plan quedó viejo. */
  async estado(org: string): Promise<VistaPlan> {
    if ((await this.negocios.perfil(org)) === null) throw new NegocioSinPerfilError(`el negocio '${org}' no existe`);
    let plan = await this.repo.ultimoPlan(org);

    if (plan !== null && (plan.estado === 'DRAFT' || plan.estado === 'NON_EXECUTABLE')) {
      const corrida = await this.investigacion.corrida(org, plan.researchRunId);
      const ultima = await this.investigacion.ultimaAprovechable(org);
      const motivo = corrida === null
        ? 'la investigación en la que se basaba ya no está disponible'
        : corrida.estado === 'STALE'
          ? `la investigación en la que se basaba quedó vieja: ${corrida.motivoStale ?? 'cambiaron los datos del negocio'}`
          : ultima !== null && ultima.id !== corrida.id
            ? 'hay una investigación más reciente que este plan no tuvo en cuenta'
            : null;
      if (motivo !== null) {
        const ahora = this.ahora();
        await enTransaccion(this.pool, async (c) => {
          await this.repo.marcarStale(c, org, motivo, ahora);
        });
        plan = { ...plan, estado: 'STALE', motivoStale: motivo, staleDesde: ahora };
      }
    }

    const grupos = plan === null ? [] : await this.repo.grupos(org, plan.id);
    const historial = (await this.repo.planes(org, 10)).map((p) => ({ id: p.id, version: p.version, estado: p.estado, creadoEn: p.creadoEn }));
    const corridaUtil = await this.investigacion.ultimaAprovechable(org);
    return {
      organizationId: org,
      plan,
      grupos,
      historial,
      puedeGenerar: corridaUtil === null
        ? { puede: false, motivo: 'primero hay que investigar el mercado' }
        : { puede: true, motivo: null },
    };
  }

  /**
   * Genera un plan nuevo a partir de la última investigación aprovechable. Versiona: el anterior queda marcado
   * como superado, con su fecha, y sigue consultable.
   */
  async generar(org: string, actor: string): Promise<VistaPlan> {
    const perfil = await this.negocios.perfil(org);
    if (perfil === null) throw new NegocioSinPerfilError(`el negocio '${org}' no existe`);
    const corrida = await this.investigacion.ultimaAprovechable(org);
    if (corrida === null) throw new SinInvestigacionError('primero hay que investigar el mercado');

    const [oferta, politica, terminos, geos, canales, landings, techo, version] = await Promise.all([
      this.negocios.oferta(org),
      this.politica.completa(org),
      this.investigacion.terminos(org, corrida.id),
      this.investigacion.geos(org, corrida.id),
      this.investigacion.canales(org, corrida.id),
      this.investigacion.landings(org, corrida.id),
      this.onboarding.intencionPresupuesto(org),
      this.repo.siguienteVersion(org),
    ]);

    const { plan, grupos } = planificar({
      organizationId: org,
      perfil,
      oferta,
      politica,
      runId: corrida.id,
      terminos,
      geos,
      canales,
      landings,
      techoDeclarado: techo === null ? null : { modalidad: techo.modalidad, montoClp: techo.montoClp },
      // Esta fase NO crea conversiones externas: mientras sea así, nunca está verificada.
      conversionExternaVerificada: false,
      // Sin lectura de historial de conversiones en esta fase: se declara 0 y la puja lo justifica.
      historialDeConversiones: 0,
      version,
      ahora: this.ahora(),
    });

    const ahora = this.ahora();
    await enTransaccion(this.pool, async (c) => {
      // El plan anterior queda SUPERADO (no borrado): sigue explicando lo que se propuso entonces.
      await c.query(
        `update campaign_plan set estado = 'SUPERSEDED', stale_desde = $2, motivo_stale = $3
         where organization_id = $1 and estado in ('DRAFT','NON_EXECUTABLE','STALE')`,
        [org, ahora, `reemplazado por la versión ${version}`],
      );
      await this.repo.guardarPlan(c, plan);
      for (const g of grupos) await this.repo.guardarGrupo(c, g);
      await this.negocios.registrarAuditoria(c, {
        organizationId: org, actor, action: 'CAMPAIGN_PLAN_GENERATED',
        changedFields: {
          planId: plan.id, version, canal: plan.canal, runId: corrida.id,
          grupos: grupos.length, estado: plan.estado, prerequisitos: plan.prerequisitos.length,
        },
      });
    });
    return this.estado(org);
  }
}
