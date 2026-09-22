/**
 * apps/api · POLÍTICA DE EVALUACIÓN COMO DATO · migración de las empresas históricas.
 *
 * REGLA CENTRAL DE ESTA MIGRACIÓN: se migra sólo lo que REALMENTE existe. Ninguna empresa recibe un objetivo,
 * una meta ni un umbral que nadie haya fijado, aunque eso signifique que quede `INCOMPLETE`. Una política
 * inventada convertiría al Director en un generador de recomendaciones sobre metas ficticias.
 *
 * Lo que hay hoy, y por tanto lo que se migra:
 *   · SmileFlow      política COMPLETA (objetivo, criterio, umbrales, límites de autonomía, contexto).
 *   · CP Odontología objetivo + embudo declarado. Sin indicador ni meta ⇒ queda INCOMPLETE con sus motivos.
 *   · C Y P          nada: no tiene política. No se crea ninguna fila.
 *
 * IDEMPOTENTE y NO DESTRUCTIVA: no sobrescribe ninguna fila existente. Lo que el usuario edite manda.
 */
import type { Pool } from 'pg';
import { configuracionHistorica, organizacionesHistoricas } from '../plataforma/registro';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioPolitica } from './politica-pg';

export interface ResultadoMigracionPolitica {
  readonly migradas: readonly string[];
  readonly yaEstaban: readonly string[];
  /** Organizaciones que no tienen nada que migrar, con el motivo. No es un fallo: es la verdad. */
  readonly sinPolitica: readonly string[];
  readonly omitidas: readonly string[];
}

/** Identidad TÉCNICA del objetivo cuando el módulo histórico no declara una. Determinista, no adivinable. */
export function objetivoDerivado(org: string): string {
  return `obj-${org}`;
}

/** Nombre legible de un indicador a partir de su clave. Traducción, no invención de un KPI nuevo. */
function nombreDeIndicador(clave: string): string {
  const conocidos: Record<string, string> = {
    tasa_conversion: 'tasa de conversión',
    contactos: 'contactos conseguidos',
    cpa: 'costo por contacto',
    roas: 'retorno de la inversión publicitaria',
  };
  return conocidos[clave] ?? clave.replace(/_/g, ' ');
}

export async function migrarPoliticasDelRegistro(
  pool: Pool,
  ahora: () => string = () => new Date().toISOString(),
): Promise<ResultadoMigracionPolitica> {
  const repo = new RepositorioPolitica(pool);
  const negocios = new RepositorioNegocios(pool);
  const migradas: string[] = [];
  const yaEstaban: string[] = [];
  const sinPolitica: string[] = [];
  const omitidas: string[] = [];

  for (const org of organizacionesHistoricas()) {
    const cfg = configuracionHistorica(org);
    if (cfg === null) continue;
    if ((await negocios.perfil(org)) === null) {
      omitidas.push(`${org}: sin perfil persistido (business_profile)`);
      continue;
    }
    if ((await repo.politica(org)) !== null) {
      yaEstaban.push(org);
      continue;
    }

    const p = cfg.perfil;
    const embudo = cfg.embudo ?? (p ? { conversionPrimaria: p.directorContext.conversionPrimaria, conversionesSecundarias: p.directorContext.conversionesSecundarias } : null);

    // Sin política Y sin embudo declarado no hay NADA que migrar: no se crea una fila vacía para aparentar.
    if (p === null && embudo === null) {
      sinPolitica.push(`${org}: el registro no declara objetivo, embudo ni criterio`);
      continue;
    }

    const c = await pool.connect();
    try {
      await c.query('begin');

      await repo.crearSiFalta(c, {
        organizationId: org,
        objectiveId: p?.objetivoId ?? objetivoDerivado(org),
        // El objetivo en lenguaje de negocio YA vive en `business_profile.primary_objective`: no se duplica.
        objectiveText: null,
        businessContext: p?.directorContext.descripcion ?? null,
        vocabulary: p?.directorContext.vocabulario ?? [],
        evaluationHorizonDays: null, // no declarado por ninguna empresa histórica
        authorizedSpendClp: p?.gastoAutorizado ?? null,
        maxBudgetVariationPct: p?.policy.variacionMaxPresupuesto ?? null,
        cooldownDays: p?.policy.cooldownDias ?? null,
        scalingRequiresApproval: p?.policy.escalamientoRequiereAprobacion ?? true,
        protectedCampaigns: p?.policy.campaniasProtegidas ?? [],
        nonModifiableActivities: p?.policy.actividadesNoModificables ?? [],
        notes: `migrado del registro TypeScript (${ahora()})`,
        origen: 'MIGRACION',
      });

      // ── EVENTOS DE CONVERSIÓN: el embudo declarado, en su orden ──
      if (embudo !== null && embudo.conversionPrimaria.trim() !== '') {
        await repo.guardarEvento(c, {
          organizationId: org, eventKey: embudo.conversionPrimaria, rol: 'PRIMARY', orden: 0,
          displayName: null, nota: 'embudo declarado por el negocio',
        });
        for (const [i, ev] of embudo.conversionesSecundarias.entries()) {
          await repo.guardarEvento(c, {
            organizationId: org, eventKey: ev, rol: 'SECONDARY', orden: i + 1,
            displayName: null, nota: 'embudo declarado por el negocio',
          });
        }
      }

      if (p !== null) {
        // ── KPI PRINCIPAL: el indicador del criterio, con su meta, línea base y tolerancia reales ──
        await repo.guardarKpi(c, {
          organizationId: org,
          id: 'principal',
          rol: 'PRIMARY',
          clave: p.criterio.indicador,
          displayName: nombreDeIndicador(p.criterio.indicador),
          tipo: p.criterio.indicador === 'tasa_conversion' ? 'RATE' : 'EVENT_COUNT',
          unidad: p.criterio.indicador === 'tasa_conversion' ? 'RATE' : 'COUNT',
          direccion: 'HIGHER_IS_BETTER',
          eventKey: embudo?.conversionPrimaria ?? null,
          targetValue: p.criterio.meta,
          baselineValue: p.criterio.lineaBase,
          tolerance: p.criterio.tolerancia,
          estado: 'CONFIGURED',
          procedencia: 'MIGRATED',
          nota: null,
          orden: 0,
        });

        // ── REGLAS: mínimo de evidencia, pausa y escalamiento, con los valores vigentes ──
        await repo.guardarRegla(c, {
          organizationId: org, id: 'evidencia-impresiones', tipo: 'EVIDENCE_MINIMUM', metrica: 'IMPRESSIONS',
          comparador: 'GTE', valor: p.criterio.muestraMinima, estado: 'CONFIGURED', procedencia: 'MIGRATED',
          nota: 'piso de impresiones antes de concluir; lo leen la evaluación y la optimización',
        });
        await repo.guardarRegla(c, {
          organizationId: org, id: 'pausa-tasa-conversion', tipo: 'PAUSE', metrica: 'CONVERSION_RATE',
          comparador: 'LTE', valor: p.policy.umbralPausaTasaConversion, estado: 'CONFIGURED', procedencia: 'MIGRATED', nota: null,
        });
        await repo.guardarRegla(c, {
          organizationId: org, id: 'escalamiento-tasa-conversion', tipo: 'ESCALATION', metrica: 'CONVERSION_RATE',
          comparador: 'GTE', valor: p.policy.umbralEscalamiento, estado: 'CONFIGURED', procedencia: 'MIGRATED',
          nota: 'escalar siempre requiere aprobación humana',
        });

        // ── LÍMITES DE AUTONOMÍA: topes de EJECUCIÓN, no presupuesto del negocio ──
        await repo.crearLimitesSiFaltan(c, {
          organizationId: org,
          maxDailyBudgetClp: p.limitesAutonomia.presupuestoMaxDiarioCLP,
          maxCpcClp: p.limitesAutonomia.cpcTechoMaxCLP,
          maxVariationPct: p.limitesAutonomia.variacionMaxPct,
          maxChangesPerDay: p.limitesAutonomia.maxCambiosPorDia,
          cooldownHours: p.limitesAutonomia.cooldownHoras,
          minTermImpressionsForNegative: p.limitesAutonomia.muestraMinimaNegativaImpresiones,
          irrelevancePatterns: p.limitesAutonomia.politicaIrrelevancia ?? [],
        });

        // ── CANAL: el de la campaña que el negocio ya gobierna. No se añade ningún canal nuevo ──
        const canal = p.externalResourceRefs.googleAds?.canal ?? null;
        if (canal !== null) {
          await repo.guardarCanal(c, {
            organizationId: org, canal, modo: 'ALLOWED', nota: 'canal de la campaña declarada en el registro',
          });
        }
      }

      await negocios.registrarAuditoria(c, {
        organizationId: org, actor: 'migracion-evaluation-policy', action: 'EVALUATION_POLICY_CREATED',
        changedFields: { origen: 'REGISTRO_TS', conPolitica: p !== null, conEmbudo: embudo !== null, at: ahora() },
      });
      await c.query('commit');
      migradas.push(org);
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  return { migradas, yaEstaban, sinPolitica, omitidas };
}
