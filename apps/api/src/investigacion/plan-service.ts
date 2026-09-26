/**
 * apps/api · PLANIFICACIÓN DE CAMPAÑAS · casos de uso del plan.
 *
 * Genera, versiona y envejece planes. Tres cosas que este servicio garantiza:
 *
 *  · UN PLAN SE APOYA EN UNA INVESTIGACIÓN CONCRETA. Se guarda de qué corrida salió; si esa corrida envejece,
 *    el plan envejece con ella y se dice por qué.
 *  · LOS PLANES NO SE SOBRESCRIBEN. Cada generación es una versión nueva y la anterior queda marcada, no borrada:
 *    el historial de lo que se propuso es parte de la explicación.
 *  · ESTA FASE NO EJECUTA NADA. El plan termina en `REVIEW_REQUIRED` o `BLOCKED` y no existe ninguna ruta que
 *    lo publique en Google o Meta.
 *  · EL DINERO DEL PLAN SALE DEL MANDATO. Aquí se resuelve la precedencia —presupuesto autorizado por una
 *    persona antes que la intención declarada en el alta— y, antes de guardar nada, se comprueba que el plan
 *    no proponga más de lo autorizado. Si lo hiciera, no se guarda: se rechaza.
 */
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioPolitica } from '../politica/politica-pg';
import { RepositorioOnboarding } from '../onboarding/onboarding-pg';
import { RepositorioInvestigacion } from './investigacion-pg';
import { RepositorioPlan, type GrupoDelPlan, type PlanCampania } from './plan-pg';
import { ESTADOS_PLAN_VIGENTE } from './investigacion-tipos';
import { planificar, type TopeAutorizado } from './planificador';
import { semillasDeSitio, type PaginaVerificada } from './semillas-sitio';
import { normalizarMoneda, exigirMismaMoneda } from '../dinero';
import { crearReposAccion } from '../accion/accion-pg';
import { mandatoVigente } from '../accion/mandato-financiero';

export class NegocioSinPerfilError extends Error {}
export class SinInvestigacionError extends Error {}
/** Un plan que viola el presupuesto autorizado NO se guarda ni se ajusta: se rechaza con su motivo. */
export class PlanInvalidoError extends Error {}

export interface VistaPlan {
  readonly organizationId: string;
  /** Moneda ISO de los importes del plan. Los números van en unidades menores de ESTA moneda. */
  readonly moneda: string;
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

/** Días que cubre un mandato (al menos 1): sirve para repartir un total entre días cuando no hay tope diario. */
function diasDe(inicio: string, fin: string): number {
  return Math.max(1, Math.round((Date.parse(fin) - Date.parse(inicio)) / 86_400_000));
}

/**
 * EL PRESUPUESTO QUE MANDA. Se lee el mandato financiero vigente de la organización y se traduce a un tope
 * DIARIO, que es lo que una campaña necesita. Si la persona escribió un máximo por día, ése; si sólo declaró
 * un total, se reparte entre los días de su período — y nunca al revés.
 *
 * Fail-closed en todo lo demás: sin mandato, vencido, revocado, agotado o en otra moneda que la del negocio,
 * devuelve `null`, y entonces manda lo que el dueño declaró en el alta (o nada).
 */
async function topeAutorizadoDe(pool: Pool, org: string, monedaDelNegocio: string | null, ahora: string): Promise<TopeAutorizado | null> {
  const m = await crearReposAccion(pool).mandatoRepo.actual(org);
  if (m === null || !mandatoVigente(m, ahora)) return null;
  if (exigirMismaMoneda(m.currency, monedaDelNegocio) === null) return null;
  const diario = m.dailyCapMinor ?? Math.floor(m.authorizedBudgetMinor / diasDe(m.periodStart, m.periodEnd));
  if (!Number.isFinite(diario) || diario <= 0) return null;
  return { diarioMinor: diario, totalMinor: m.authorizedBudgetMinor, currency: m.currency };
}

/** Páginas que la auditoría del sitio vio de verdad, reconstruidas desde la evidencia de la corrida. */
function paginasDeLaEvidencia(evidencias: ReadonlyArray<{ fuente: string; datos: Record<string, unknown> }>): readonly PaginaVerificada[] {
  return evidencias
    .filter((ev) => ev.fuente === 'WEBSITE_AUDIT')
    .map((ev) => {
      const d = ev.datos;
      return {
        ruta: String(d.ruta ?? ''),
        httpStatus: Number(d.httpStatus ?? 0),
        titulo: d.titulo === null || d.titulo === undefined ? null : String(d.titulo),
        metaDescription: d.metaDescription === null || d.metaDescription === undefined ? null : String(d.metaDescription),
        h1: Array.isArray(d.h1) ? d.h1.map((x) => String(x)) : [],
        indexable: d.indexable === true,
      };
    })
    .filter((p) => p.ruta !== '');
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
    const perfil = await this.negocios.perfil(org);
    if (perfil === null) throw new NegocioSinPerfilError(`el negocio '${org}' no existe`);
    let plan = await this.repo.ultimoPlan(org);

    if (plan !== null && (ESTADOS_PLAN_VIGENTE as readonly string[]).includes(plan.estado)) {
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
      // Los importes del plan están en unidades menores de ESTA moneda; la pantalla necesita saber cuál es.
      moneda: normalizarMoneda(perfil?.currency) ?? 'CLP',
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

    const [oferta, politica, terminos, geos, canales, landings, techo, version, evidencias, territorios] = await Promise.all([
      this.negocios.oferta(org),
      this.politica.completa(org),
      this.investigacion.terminos(org, corrida.id),
      this.investigacion.geos(org, corrida.id),
      this.investigacion.canales(org, corrida.id),
      this.investigacion.landings(org, corrida.id),
      this.onboarding.intencionPresupuesto(org),
      this.repo.siguienteVersion(org),
      this.investigacion.evidencias(org, corrida.id),
      this.negocios.territorios(org),
    ]);

    const ahoraIso = this.ahora();
    const mandato = await topeAutorizadoDe(this.pool, org, perfil.currency, ahoraIso);

    /**
     * MATERIAL VERIFICADO DEL SITIO. Se prepara SIEMPRE, pero el planificador sólo lo usa si el proveedor de
     * demanda no trajo nada: no sustituye a una medición, la suple cuando no existe.
     */
    const landingVerificada = new Map<string, string | null>(
      landings.filter((l) => l.estado === 'READY' && l.url !== null).map((l) => [l.ofertaSlug, l.url]),
    );
    const semillas = semillasDeSitio({
      oferta,
      paginas: paginasDeLaEvidencia(evidencias),
      localidades: geos.filter((g) => g.disponible).map((g) => g.solicitado),
      marca: perfil.displayName,
      landingPorOferta: landingVerificada,
    });
    void territorios; // el territorio del plan sale de los geos resueltos, no de lo declarado sin comprobar

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
      techoDeclarado: techo === null ? null : { modalidad: techo.modalidad, montoMinor: techo.montoMinor },
      mandato,
      semillasSitio: semillas,
      // Esta fase NO crea conversiones externas: mientras sea así, nunca está verificada.
      conversionExternaVerificada: false,
      // Sin lectura de historial de conversiones en esta fase: se declara 0 y la puja lo justifica.
      historialDeConversiones: 0,
      version,
      ahora: this.ahora(),
    });

    /**
     * GUARDIA DEL MANDATO, antes de escribir nada. El planificador ya respeta la precedencia; esto comprueba
     * el resultado por si alguien cambia esa lógica mañana. Un plan que propusiera más de lo autorizado no se
     * ajusta en silencio: se rechaza, y quien lo pidió se entera.
     */
    if (mandato !== null && plan.presupuesto.propuestoDiarioClp !== null && plan.presupuesto.propuestoDiarioClp > mandato.diarioMinor) {
      throw new PlanInvalidoError(
        `el plan propone ${plan.presupuesto.propuestoDiarioClp} al día y el máximo autorizado es ${mandato.diarioMinor}`,
      );
    }

    const ahora = this.ahora();
    await enTransaccion(this.pool, async (c) => {
      // El plan anterior queda SUPERADO (no borrado): sigue explicando lo que se propuso entonces.
      await c.query(
        `update campaign_plan set estado = 'SUPERSEDED', stale_desde = $2, motivo_stale = $3
         where organization_id = $1 and estado = any($4::text[])`,
        [org, ahora, `reemplazado por la versión ${version}`, [...ESTADOS_PLAN_VIGENTE, 'STALE']],
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
