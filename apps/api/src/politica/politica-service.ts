/**
 * apps/api · POLÍTICA DE EVALUACIÓN COMO DATO · casos de uso.
 *
 * Una persona define desde SOEC qué quiere conseguir, qué acción de un cliente cuenta, con qué indicador se
 * mide y cuándo el resultado es bueno. Eso —y no un módulo TypeScript— es lo que vuelve evaluable a una
 * empresa. Todo se guarda en UNA transacción y se audita.
 *
 * LÍMITES DEL PODER DE ESTA SUPERFICIE (deliberados):
 *  · completar la política NO autoriza mutaciones externas, gasto autónomo ni ejecución de campañas: eso vive
 *    en `business_governance` y en el mandato financiero, y esta ruta no los toca;
 *  · el territorio, los productos y las restricciones se EDITAN EN SU TABLA CANÓNICA (Fase A), no se copian;
 *  · una métrica observada nunca se guarda como política.
 */
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios, type OfertaNegocio, type RestriccionNegocio, type TerritorioNegocio } from '../negocio/negocio-pg';
import { RepositorioPolitica, type CambiosPolitica, type PoliticaCompleta } from './politica-pg';
import { construirPerfilDeEvaluacion, evaluarCompletitud, type DatosDePolitica } from './politica-perfil';
import {
  PoliticaInvalidaError,
  exigirClave,
  exigirComparador,
  exigirDireccion,
  exigirEstado,
  exigirMetrica,
  exigirModoCanal,
  exigirProcedencia,
  exigirRol,
  exigirTipoKpi,
  exigirTipoRegla,
  exigirUnidad,
  enteroPositivoOpcional,
  fraccionOpcional,
  numeroOpcional,
  type CompletitudPerfil,
} from './politica-tipos';
import { objetivoDerivado } from './migracion-politica';

export class NegocioSinPerfilError extends Error {}

/** Vista completa: la política, su completitud y los datos CANÓNICOS a los que se refiere. */
export interface VistaPolitica {
  readonly organizationId: string;
  /** Objetivo en lenguaje de negocio: el de la política o, si no lo tiene, el del perfil comercial. */
  readonly objetivoDeclarado: string | null;
  readonly politica: PoliticaCompleta;
  readonly completitud: CompletitudPerfil;
  /** Referencias (no copias) a datos de Fase A que la política usa para decidir. */
  readonly referencias: {
    readonly oferta: readonly OfertaNegocio[];
    readonly territorios: readonly TerritorioNegocio[];
    readonly restricciones: readonly RestriccionNegocio[];
  };
  /** `true` sólo cuando la política reconstruye un perfil de evaluación válido. */
  readonly perfilEvaluableDisponible: boolean;
}

export interface EntradaKpi {
  readonly id?: string;
  readonly rol?: string;
  readonly clave: string;
  readonly displayName?: string;
  readonly tipo?: string;
  readonly unidad?: string;
  readonly direccion?: string;
  readonly eventKey?: string | null;
  readonly targetValue?: number | null;
  readonly baselineValue?: number | null;
  readonly tolerance?: number | null;
  readonly estado?: string;
  readonly procedencia?: string;
  readonly nota?: string | null;
  readonly orden?: number;
}

export interface EntradaEvento {
  readonly eventKey: string;
  readonly rol?: string;
  readonly orden?: number;
  readonly displayName?: string | null;
  readonly nota?: string | null;
}

export interface EntradaRegla {
  readonly id?: string;
  readonly tipo: string;
  readonly metrica: string;
  readonly comparador?: string;
  readonly valor?: number | null;
  readonly estado?: string;
  readonly procedencia?: string;
  readonly nota?: string | null;
}

export interface EntradaLimites {
  readonly maxDailyBudgetClp?: number | null;
  readonly maxCpcClp?: number | null;
  readonly maxVariationPct?: number | null;
  readonly maxChangesPerDay?: number | null;
  readonly cooldownHours?: number | null;
  readonly minTermImpressionsForNegative?: number | null;
  readonly irrelevancePatterns?: readonly string[];
}

export interface EntradaCanal {
  readonly canal: string;
  readonly modo: string;
  readonly nota?: string | null;
}

/** Documento de edición. Todo es opcional: se aplica sólo lo que el usuario cambió. */
export interface DocumentoPolitica {
  readonly objetivoText?: string | null;
  readonly businessContext?: string | null;
  readonly vocabulary?: readonly string[];
  readonly evaluationHorizonDays?: number | null;
  readonly authorizedSpendClp?: number | null;
  readonly maxBudgetVariationPct?: number | null;
  readonly cooldownDays?: number | null;
  readonly scalingRequiresApproval?: boolean;
  readonly protectedCampaigns?: readonly string[];
  readonly nonModifiableActivities?: readonly string[];
  readonly notes?: string | null;
  readonly kpis?: readonly EntradaKpi[];
  readonly eventos?: readonly EntradaEvento[];
  readonly reglas?: readonly EntradaRegla[];
  readonly limites?: EntradaLimites;
  readonly canales?: readonly EntradaCanal[];
  /** Prioridad de los productos/servicios. Se escribe en `business_offering`: su tabla canónica. */
  readonly prioridadesDeOferta?: ReadonlyArray<{ readonly slug: string; readonly priority: number }>;
  /** Límites comerciales que no deben violarse. Se escriben en `business_restriction`. */
  readonly restriccionesNuevas?: ReadonlyArray<{ readonly texto: string; readonly tipo?: string; readonly alcance?: string | null }>;
  /** Ids de restricciones a retirar (sólo de esta organización). */
  readonly restriccionesRetiradas?: readonly string[];
  /** Claves a eliminar: KPIs, eventos, reglas o canales que el usuario quita. */
  readonly kpisEliminados?: readonly string[];
  readonly eventosEliminados?: readonly string[];
  readonly reglasEliminadas?: readonly string[];
  readonly canalesEliminados?: readonly string[];
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

const slugId = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

export interface DepsPoliticaService {
  /** Se llama tras cada cambio para que el runtime vea la política sin esperar el refresco periódico. */
  readonly refrescar?: () => Promise<void>;
  readonly ahora?: () => string;
}

export class PoliticaService {
  private readonly repo: RepositorioPolitica;
  private readonly negocios: RepositorioNegocios;
  private readonly ahora: () => string;

  constructor(private readonly pool: Pool, private readonly deps: DepsPoliticaService = {}) {
    this.repo = new RepositorioPolitica(pool);
    this.negocios = new RepositorioNegocios(pool);
    this.ahora = deps.ahora ?? (() => new Date().toISOString());
  }

  /** Datos necesarios para evaluar completitud y reconstruir el perfil. Una sola lectura, reutilizada. */
  private async datos(org: string): Promise<DatosDePolitica & { referencias: VistaPolitica['referencias'] }> {
    const perfil = await this.negocios.perfil(org);
    if (perfil === null) throw new NegocioSinPerfilError(`el negocio '${org}' no existe`);
    const [politica, oferta, territorios, restricciones] = await Promise.all([
      this.repo.completa(org), this.negocios.oferta(org), this.negocios.territorios(org), this.negocios.restricciones(org),
    ]);
    return {
      perfil,
      politica,
      tieneTerritorio: territorios.length > 0,
      tienePrioridadesDeOferta: oferta.some((o) => o.priority !== 100),
      referencias: { oferta, territorios, restricciones },
    };
  }

  async leer(org: string): Promise<VistaPolitica> {
    const d = await this.datos(org);
    const completitud = evaluarCompletitud(d);
    return {
      organizationId: org,
      objetivoDeclarado: d.politica.politica?.objectiveText ?? d.perfil.primaryObjective ?? null,
      politica: d.politica,
      completitud,
      referencias: d.referencias,
      perfilEvaluableDisponible: construirPerfilDeEvaluacion(d) !== null,
    };
  }

  /** Completitud sola: la usan el read model de salud y el ciclo del Director. */
  async completitud(org: string): Promise<CompletitudPerfil> {
    return evaluarCompletitud(await this.datos(org));
  }

  /**
   * Aplica el documento de edición en UNA transacción y audita el cambio, incluida la TRANSICIÓN de
   * completitud (pasar a evaluable, o dejar de serlo, es el hecho que importa).
   */
  async guardar(org: string, actor: string, doc: DocumentoPolitica): Promise<VistaPolitica> {
    const antes = await this.datos(org);
    const completitudAntes = evaluarCompletitud(antes);
    const existia = antes.politica.politica !== null;

    await enTransaccion(this.pool, async (c) => {
      if (!existia) {
        await this.repo.crearSiFalta(c, {
          organizationId: org,
          objectiveId: objetivoDerivado(org), // identidad técnica determinista; el texto lo pone el usuario
          objectiveText: null,
          businessContext: null,
          vocabulary: [],
          evaluationHorizonDays: null,
          authorizedSpendClp: null,
          maxBudgetVariationPct: null,
          cooldownDays: null,
          scalingRequiresApproval: true, // escalar SIEMPRE nace exigiendo aprobación humana
          protectedCampaigns: [],
          nonModifiableActivities: [],
          notes: null,
          origen: 'UI',
        });
      }

      const cambios: CambiosPolitica = {
        ...(doc.objetivoText !== undefined ? { objectiveText: this.textoOpcional(doc.objetivoText, 'objetivo', 300) } : {}),
        ...(doc.businessContext !== undefined ? { businessContext: this.textoOpcional(doc.businessContext, 'contexto', 2000) } : {}),
        ...(doc.vocabulary !== undefined ? { vocabulary: doc.vocabulary.map((v) => String(v).trim()).filter((v) => v.length > 0).slice(0, 40) } : {}),
        ...(doc.evaluationHorizonDays !== undefined ? { evaluationHorizonDays: enteroPositivoOpcional(doc.evaluationHorizonDays, 'horizonte de evaluación') } : {}),
        ...(doc.authorizedSpendClp !== undefined ? { authorizedSpendClp: numeroOpcional(doc.authorizedSpendClp, 'gasto reconocido') } : {}),
        ...(doc.maxBudgetVariationPct !== undefined ? { maxBudgetVariationPct: fraccionOpcional(doc.maxBudgetVariationPct, 'variación máxima de presupuesto') } : {}),
        ...(doc.cooldownDays !== undefined ? { cooldownDays: enteroPositivoOpcional(doc.cooldownDays, 'días de espera entre cambios') } : {}),
        ...(doc.scalingRequiresApproval !== undefined ? { scalingRequiresApproval: doc.scalingRequiresApproval === true } : {}),
        ...(doc.protectedCampaigns !== undefined ? { protectedCampaigns: doc.protectedCampaigns.map(String) } : {}),
        ...(doc.nonModifiableActivities !== undefined ? { nonModifiableActivities: doc.nonModifiableActivities.map(String) } : {}),
        ...(doc.notes !== undefined ? { notes: this.textoOpcional(doc.notes, 'notas', 2000) } : {}),
      };
      await this.repo.actualizarPolitica(c, org, cambios);

      for (const k of doc.kpis ?? []) {
        const clave = exigirClave(k.clave, 'clave del indicador');
        await this.repo.guardarKpi(c, {
          organizationId: org,
          id: k.id !== undefined && k.id !== null && String(k.id).trim() !== '' ? slugId(String(k.id)) : slugId(clave),
          rol: exigirRol(k.rol ?? 'PRIMARY'),
          clave,
          displayName: this.textoOpcional(k.displayName ?? clave, 'nombre del indicador', 120) ?? clave,
          tipo: exigirTipoKpi(k.tipo ?? 'EVENT_COUNT'),
          unidad: exigirUnidad(k.unidad ?? 'COUNT'),
          direccion: exigirDireccion(k.direccion ?? 'HIGHER_IS_BETTER'),
          eventKey: k.eventKey === null || k.eventKey === undefined || k.eventKey === '' ? null : exigirClave(k.eventKey, 'evento del indicador'),
          targetValue: numeroOpcional(k.targetValue, 'meta'),
          baselineValue: numeroOpcional(k.baselineValue, 'línea base'),
          tolerance: fraccionOpcional(k.tolerance, 'tolerancia'),
          // Un indicador sin meta no puede declararse CONFIGURADO: sería una meta invisible.
          estado: k.estado !== undefined ? exigirEstado(k.estado) : (numeroOpcional(k.targetValue, 'meta') !== null ? 'CONFIGURED' : 'UNKNOWN'),
          // Sin meta no hay decisión de nadie: se declara qué es (por aprender) en lugar de firmar un número.
          procedencia: k.procedencia !== undefined
            ? exigirProcedencia(k.procedencia)
            : (numeroOpcional(k.targetValue, 'meta') !== null ? 'USER_DEFINED' : 'TO_BE_LEARNED'),
          nota: this.textoOpcional(k.nota ?? null, 'nota', 500),
          orden: enteroPositivoOpcional(k.orden, 'orden') ?? 100,
        });
      }
      for (const id of doc.kpisEliminados ?? []) await this.repo.borrarKpi(c, org, String(id));

      for (const [i, e] of (doc.eventos ?? []).entries()) {
        await this.repo.guardarEvento(c, {
          organizationId: org,
          eventKey: exigirClave(e.eventKey, 'evento'),
          rol: exigirRol(e.rol ?? (i === 0 ? 'PRIMARY' : 'SECONDARY')),
          orden: enteroPositivoOpcional(e.orden, 'orden') ?? i,
          displayName: this.textoOpcional(e.displayName ?? null, 'nombre del evento', 120),
          nota: this.textoOpcional(e.nota ?? null, 'nota', 500),
        });
      }
      for (const k of doc.eventosEliminados ?? []) await this.repo.borrarEvento(c, org, String(k));

      for (const r of doc.reglas ?? []) {
        const tipo = exigirTipoRegla(r.tipo);
        const metrica = exigirMetrica(r.metrica);
        const valor = numeroOpcional(r.valor, 'valor de la regla');
        await this.repo.guardarRegla(c, {
          organizationId: org,
          id: r.id !== undefined && r.id !== null && String(r.id).trim() !== '' ? slugId(String(r.id)) : slugId(`${tipo}-${metrica}`),
          tipo,
          metrica,
          comparador: exigirComparador(r.comparador ?? (tipo === 'PAUSE' ? 'LTE' : 'GTE')),
          valor,
          estado: r.estado !== undefined ? exigirEstado(r.estado) : (valor !== null ? 'CONFIGURED' : 'UNKNOWN'),
          procedencia: r.procedencia !== undefined
            ? exigirProcedencia(r.procedencia)
            : (valor !== null ? 'USER_DEFINED' : 'UNCONFIGURED'),
          nota: this.textoOpcional(r.nota ?? null, 'nota', 500),
        });
      }
      for (const id of doc.reglasEliminadas ?? []) await this.repo.borrarRegla(c, org, String(id));

      if (doc.limites !== undefined) {
        const previos = antes.politica.limites;
        await this.repo.guardarLimites(c, {
          organizationId: org,
          maxDailyBudgetClp: doc.limites.maxDailyBudgetClp !== undefined ? numeroOpcional(doc.limites.maxDailyBudgetClp, 'tope de presupuesto diario') : previos?.maxDailyBudgetClp ?? null,
          maxCpcClp: doc.limites.maxCpcClp !== undefined ? numeroOpcional(doc.limites.maxCpcClp, 'tope de CPC') : previos?.maxCpcClp ?? null,
          maxVariationPct: doc.limites.maxVariationPct !== undefined ? fraccionOpcional(doc.limites.maxVariationPct, 'variación máxima') : previos?.maxVariationPct ?? null,
          maxChangesPerDay: doc.limites.maxChangesPerDay !== undefined ? enteroPositivoOpcional(doc.limites.maxChangesPerDay, 'cambios por día') : previos?.maxChangesPerDay ?? null,
          cooldownHours: doc.limites.cooldownHours !== undefined ? enteroPositivoOpcional(doc.limites.cooldownHours, 'horas de espera') : previos?.cooldownHours ?? null,
          minTermImpressionsForNegative: doc.limites.minTermImpressionsForNegative !== undefined ? enteroPositivoOpcional(doc.limites.minTermImpressionsForNegative, 'impresiones mínimas por término') : previos?.minTermImpressionsForNegative ?? null,
          irrelevancePatterns: doc.limites.irrelevancePatterns !== undefined
            ? doc.limites.irrelevancePatterns.map((p) => String(p).trim().toLowerCase()).filter((p) => p.length > 0).slice(0, 200)
            : previos?.irrelevancePatterns ?? [],
        });
      }

      for (const ch of doc.canales ?? []) {
        await this.repo.guardarCanal(c, {
          organizationId: org,
          canal: exigirClave(ch.canal, 'canal'),
          modo: exigirModoCanal(ch.modo),
          nota: this.textoOpcional(ch.nota ?? null, 'nota', 500),
        });
      }
      for (const ch of doc.canalesEliminados ?? []) await this.repo.borrarCanal(c, org, String(ch));

      // ── DATOS CANÓNICOS DE FASE A: se editan en SU tabla, no se copian aquí ──
      for (const p of doc.prioridadesDeOferta ?? []) {
        const oferta = antes.referencias.oferta.find((o) => o.slug === p.slug);
        if (oferta === undefined) throw new PoliticaInvalidaError(`el negocio no tiene el servicio '${p.slug}'`);
        const priority = enteroPositivoOpcional(p.priority, 'prioridad');
        await this.negocios.guardarOferta(c, { ...oferta, priority: priority ?? oferta.priority });
      }
      for (const r of doc.restriccionesNuevas ?? []) {
        const texto = this.textoOpcional(r.texto, 'restricción', 500);
        if (texto === null) throw new PoliticaInvalidaError('la restricción no puede estar vacía');
        const tipo = r.tipo === 'PROHIBITED_CLAIM' ? 'PROHIBITED_CLAIM' : 'RESTRICTION';
        await this.negocios.guardarRestriccion(c, {
          organizationId: org, id: `politica-${slugId(texto).slice(0, 40)}`, tipo, texto,
          alcance: this.textoOpcional(r.alcance ?? null, 'alcance', 200),
        });
      }
      for (const id of doc.restriccionesRetiradas ?? []) {
        await this.negocios.borrarRestriccion(c, org, String(id));
      }
    });

    const despues = await this.datos(org);
    const completitudDespues = evaluarCompletitud(despues);
    const camposTocados = Object.keys(doc).filter((k) => (doc as Record<string, unknown>)[k] !== undefined);

    await this.negocios.registrarAuditoria(this.pool, {
      organizationId: org, actor,
      action: existia ? 'EVALUATION_POLICY_UPDATED' : 'EVALUATION_POLICY_CREATED',
      changedFields: { campos: camposTocados, at: this.ahora() },
    });
    if (completitudAntes.estado !== completitudDespues.estado) {
      await this.negocios.registrarAuditoria(this.pool, {
        organizationId: org, actor,
        action: completitudDespues.estado === 'EVALUATION_PROFILE_COMPLETE' ? 'EVALUATION_PROFILE_COMPLETED' : 'EVALUATION_PROFILE_BECAME_INCOMPLETE',
        changedFields: { faltantes: completitudDespues.faltantes.map((f) => f.campo), at: this.ahora() },
      });
    }
    await this.deps.refrescar?.();
    return this.leer(org);
  }

  private textoOpcional(v: unknown, campo: string, max: number): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s === '') return null;
    if (s.length > max) throw new PoliticaInvalidaError(`${campo} excede ${max} caracteres`);
    return s;
  }
}
