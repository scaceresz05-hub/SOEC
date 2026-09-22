/**
 * apps/api · OPTIMIZACIÓN AUTÓNOMA · esquema y repositorios.
 *
 * Seis tablas. Cada una responde a una pregunta que, sin ella, no se puede contestar seis meses después:
 *
 *  · `optimization_cycle`      ¿qué hizo SOEC y con qué versión de la política y del mandato?
 *  · `observation_snapshot`    ¿qué datos EXACTOS vio cuando decidió? (inmutable)
 *  · `optimization_decision`   ¿qué decidió, por qué, con qué evidencia y qué esperaba conseguir?
 *  · `pending_marketing_action` ¿qué está esperando el permiso de una persona?
 *  · `optimization_action_log` ¿qué se aplicó de verdad, con qué identidad idempotente y si se verificó?
 *  · `learning_outcome`        ¿salió como esperaba? (la materia prima para aprender de sí mismo)
 *
 * Más `autonomy_policy`: los LÍMITES de qué puede hacer una empresa sola. El CUÁNTO sigue viviendo en el
 * mandato financiero — aquí no se duplica ni un peso.
 */
import type { Pool, PoolClient } from 'pg';
import type { Migration } from '@soec/event-store/pg';
import type {
  AccionOptimizacion,
  EstadoCiclo,
  EstadoPendiente,
  ModoCiclo,
  NivelRiesgo,
  ResultadoAccion,
  ResultadoAprendizaje,
  SaludMedicion,
  VentanaObservacion,
  VerificacionRemota,
  MetricasObservadas,
} from './optimizacion-tipos';

export type Queryable = Pool | PoolClient;

export interface CicloOptimizacion {
  readonly organizationId: string;
  readonly id: string;
  readonly proveedor: string;
  readonly campaignId: string | null;
  readonly modo: ModoCiclo;
  readonly estado: EstadoCiclo;
  readonly ventana: VentanaObservacion;
  readonly snapshotId: string | null;
  /** Versiones de lo que gobernaba la decisión: sin esto no se puede reconstruir por qué se decidió así. */
  readonly politicaEvaluacionVersion: string | null;
  readonly politicaAutonomiaVersion: number | null;
  readonly mandatoId: string | null;
  readonly mandatoVersion: number | null;
  readonly modoOperativo: string | null;
  readonly resumen: Record<string, unknown>;
  readonly motivo: string | null;
  readonly iniciadoEn: string;
  readonly completadoEn: string | null;
}

/** Snapshot INMUTABLE de lo observado. Es la evidencia que sostiene cada decisión del ciclo. */
export interface SnapshotObservacion {
  readonly organizationId: string;
  readonly id: string;
  readonly cicloId: string;
  readonly proveedor: string;
  readonly campaignId: string | null;
  readonly ventana: VentanaObservacion;
  readonly campania: MetricasObservadas & { readonly estado: string | null; readonly presupuestoDiarioMicros: number | null };
  readonly gruposAnuncio: readonly RendimientoEntidad[];
  readonly palabras: readonly RendimientoPalabra[];
  readonly terminos: readonly RendimientoTermino[];
  readonly anuncios: readonly RendimientoEntidad[];
  readonly saludMedicion: SaludMedicion;
  readonly fuente: string;
  /** Marca de tiempo del proveedor (hasta cuándo llegan sus datos), distinta de cuándo miramos. */
  readonly datosHasta: string | null;
  readonly observadoEn: string;
}

export interface RendimientoEntidad extends MetricasObservadas {
  readonly id: string;
  readonly nombre: string;
  readonly estado: string | null;
}

export interface RendimientoPalabra extends MetricasObservadas {
  readonly adGroupId: string | null;
  readonly criterionId: string | null;
  readonly texto: string;
  readonly concordancia: string | null;
  readonly estado: string | null;
  readonly cpcMaximoMicros: number | null;
}

export interface RendimientoTermino extends MetricasObservadas {
  readonly termino: string;
  readonly palabraQueLoDisparo: string | null;
}

/** Una decisión explicable: qué, sobre qué, desde qué estado, hacia cuál, con qué evidencia y por qué. */
export interface DecisionOptimizacion {
  readonly organizationId: string;
  readonly id: string;
  readonly cicloId: string;
  readonly accion: AccionOptimizacion;
  readonly objetivo: { readonly tipo: string; readonly id: string | null; readonly nombre: string };
  readonly estadoActual: string;
  readonly estadoPropuesto: string;
  readonly evidenciaRefs: readonly string[];
  readonly politicaRefs: readonly string[];
  readonly efectoEsperado: string;
  readonly riesgo: NivelRiesgo;
  readonly confianza: 'ALTA' | 'MEDIA' | 'BAJA';
  readonly reversible: boolean;
  readonly motivo: string;
  /** Máximo impacto económico si la decisión sale mal. La persona merece saberlo antes de aprobar. */
  readonly impactoMaximoClp: number | null;
  readonly creadoEn: string;
}

export interface AccionPendiente {
  readonly organizationId: string;
  readonly id: string;
  readonly cicloId: string;
  readonly decisionId: string;
  readonly estado: EstadoPendiente;
  readonly resueltoPor: string | null;
  readonly resueltoEn: string | null;
  readonly ajuste: Record<string, unknown> | null;
  readonly nota: string | null;
  readonly expiraEn: string | null;
  readonly creadoEn: string;
}

export interface AccionAplicada {
  readonly organizationId: string;
  readonly id: string;
  readonly cicloId: string;
  readonly decisionId: string;
  readonly accion: AccionOptimizacion;
  /** Identidad estable: organización + campaña + acción + objetivo + estado pretendido. */
  readonly claveIdempotencia: string;
  readonly resultado: ResultadoAccion;
  readonly verificacion: VerificacionRemota;
  readonly recursoExterno: string | null;
  readonly providerRequestId: string | null;
  readonly detalle: Record<string, unknown>;
  readonly aplicadoEn: string;
}

export interface RegistroAprendizaje {
  readonly organizationId: string;
  readonly id: string;
  readonly decisionId: string;
  readonly accion: AccionOptimizacion;
  readonly efectoEsperado: string;
  readonly metricasAntes: MetricasObservadas;
  readonly metricasDespues: MetricasObservadas | null;
  readonly resultado: ResultadoAprendizaje;
  readonly nota: string | null;
  readonly evaluableDesde: string;
  readonly evaluadoEn: string | null;
}

/** Límites de QUÉ puede hacer la empresa sola. El CUÁNTO es del mandato financiero. */
export interface PoliticaAutonomia {
  readonly organizationId: string;
  readonly version: number;
  readonly accionesPermitidas: readonly AccionOptimizacion[];
  readonly maxCambioPresupuestoPct: number;
  readonly maxCambioCpcPct: number;
  readonly maxCambiosPorDia: number;
  readonly cooldownHoras: number;
  readonly horasPermitidas: readonly number[] | null;
  /** Encender una campaña sola exige decirlo aquí. NUNCA se infiere del presupuesto ni del modo. */
  readonly activacionAutonomaPermitida: boolean;
  readonly actualizadoPor: string | null;
  readonly actualizadoEn: string;
}

export const POLITICA_AUTONOMIA_POR_DEFECTO = (org: string, ahora: string): PoliticaAutonomia => ({
  organizationId: org,
  version: 0,
  // Por defecto SÓLO lo que reduce exposición o es trivialmente reversible.
  accionesPermitidas: ['PAUSE_CAMPAIGN'],
  maxCambioPresupuestoPct: 0,
  maxCambioCpcPct: 0,
  maxCambiosPorDia: 0,
  cooldownHoras: 24,
  horasPermitidas: null,
  activacionAutonomaPermitida: false,
  actualizadoPor: null,
  actualizadoEn: ahora,
});

export const optimizacionMigrations: ReadonlyArray<Migration> = [
  {
    id: '0001_autonomous_optimization',
    sql: `
      create table if not exists optimization_cycle (
        organization_id   text not null references business_profile(organization_id) on delete cascade,
        id                text not null,
        proveedor         text not null default 'GOOGLE_ADS',
        campaign_id       text,
        modo              text not null,
        estado            text not null default 'QUEUED',
        ventana           jsonb not null default '{}'::jsonb,
        snapshot_id       text,
        politica_evaluacion_version text,
        politica_autonomia_version  int,
        mandato_id        text,
        mandato_version   int,
        modo_operativo    text,
        resumen           jsonb not null default '{}'::jsonb,
        motivo            text,
        iniciado_en       timestamptz not null default now(),
        completado_en     timestamptz,
        primary key (organization_id, id)
      );
      create index if not exists ix_oc_org on optimization_cycle (organization_id, iniciado_en desc);

      create table if not exists observation_snapshot (
        organization_id text not null,
        id              text not null,
        ciclo_id        text not null,
        proveedor       text not null,
        campaign_id     text,
        ventana         jsonb not null default '{}'::jsonb,
        campania        jsonb not null default '{}'::jsonb,
        grupos          jsonb not null default '[]'::jsonb,
        palabras        jsonb not null default '[]'::jsonb,
        terminos        jsonb not null default '[]'::jsonb,
        anuncios        jsonb not null default '[]'::jsonb,
        salud_medicion  text not null default 'UNKNOWN',
        fuente          text not null,
        datos_hasta     timestamptz,
        observado_en    timestamptz not null default now(),
        primary key (organization_id, id)
      );

      create table if not exists optimization_decision (
        organization_id  text not null,
        id               text not null,
        ciclo_id         text not null,
        accion           text not null,
        objetivo         jsonb not null default '{}'::jsonb,
        estado_actual    text not null,
        estado_propuesto text not null,
        evidencia_refs   jsonb not null default '[]'::jsonb,
        politica_refs    jsonb not null default '[]'::jsonb,
        efecto_esperado  text not null,
        riesgo           text not null,
        confianza        text not null,
        reversible       boolean not null default true,
        motivo           text not null,
        impacto_maximo_clp numeric,
        creado_en        timestamptz not null default now(),
        primary key (organization_id, id)
      );
      create index if not exists ix_od_ciclo on optimization_decision (organization_id, ciclo_id);

      create table if not exists pending_marketing_action (
        organization_id text not null,
        id              text not null,
        ciclo_id        text not null,
        decision_id     text not null,
        estado          text not null default 'PENDING',
        resuelto_por    text,
        resuelto_en     timestamptz,
        ajuste          jsonb,
        nota            text,
        expira_en       timestamptz,
        creado_en       timestamptz not null default now(),
        primary key (organization_id, id)
      );
      create index if not exists ix_pma_pendientes on pending_marketing_action (organization_id, estado, creado_en desc);

      create table if not exists optimization_action_log (
        organization_id     text not null,
        id                  text not null,
        ciclo_id            text not null,
        decision_id         text not null,
        accion              text not null,
        clave_idempotencia  text not null,
        resultado           text not null,
        verificacion        text not null default 'UNKNOWN',
        recurso_externo     text,
        provider_request_id text,
        detalle             jsonb not null default '{}'::jsonb,
        aplicado_en         timestamptz not null default now(),
        primary key (organization_id, id)
      );
      -- IDEMPOTENCIA: la misma intención sobre el mismo objetivo no se aplica dos veces.
      create unique index if not exists ux_oal_idem on optimization_action_log (organization_id, clave_idempotencia)
        where resultado in ('APPLIED','NOOP_ALREADY_APPLIED');

      create table if not exists learning_outcome (
        organization_id  text not null,
        id               text not null,
        decision_id      text not null,
        accion           text not null,
        efecto_esperado  text not null,
        metricas_antes   jsonb not null default '{}'::jsonb,
        metricas_despues jsonb,
        resultado        text not null default 'NOT_ENOUGH_TIME',
        nota             text,
        evaluable_desde  timestamptz not null,
        evaluado_en      timestamptz,
        primary key (organization_id, id)
      );

      create table if not exists autonomy_policy (
        organization_id text primary key references business_profile(organization_id) on delete cascade,
        version         int not null default 1,
        acciones_permitidas jsonb not null default '[]'::jsonb,
        max_cambio_presupuesto_pct numeric not null default 0,
        max_cambio_cpc_pct numeric not null default 0,
        max_cambios_por_dia int not null default 0,
        cooldown_horas  int not null default 24,
        horas_permitidas jsonb,
        activacion_autonoma_permitida boolean not null default false,
        actualizado_por text,
        actualizado_en  timestamptz not null default now()
      );
    `,
  },
];

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numero = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const lista = (v: unknown): readonly string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

function aCiclo(r: Record<string, unknown>): CicloOptimizacion {
  return {
    organizationId: String(r.organization_id), id: String(r.id), proveedor: String(r.proveedor),
    campaignId: texto(r.campaign_id), modo: String(r.modo) as ModoCiclo, estado: String(r.estado) as EstadoCiclo,
    ventana: (r.ventana ?? {}) as VentanaObservacion, snapshotId: texto(r.snapshot_id),
    politicaEvaluacionVersion: texto(r.politica_evaluacion_version),
    politicaAutonomiaVersion: numero(r.politica_autonomia_version),
    mandatoId: texto(r.mandato_id), mandatoVersion: numero(r.mandato_version), modoOperativo: texto(r.modo_operativo),
    resumen: (r.resumen ?? {}) as Record<string, unknown>, motivo: texto(r.motivo),
    iniciadoEn: iso(r.iniciado_en) ?? '', completadoEn: iso(r.completado_en),
  };
}

function aDecision(r: Record<string, unknown>): DecisionOptimizacion {
  return {
    organizationId: String(r.organization_id), id: String(r.id), cicloId: String(r.ciclo_id),
    accion: String(r.accion) as AccionOptimizacion, objetivo: (r.objetivo ?? {}) as DecisionOptimizacion['objetivo'],
    estadoActual: String(r.estado_actual), estadoPropuesto: String(r.estado_propuesto),
    evidenciaRefs: lista(r.evidencia_refs), politicaRefs: lista(r.politica_refs),
    efectoEsperado: String(r.efecto_esperado), riesgo: String(r.riesgo) as NivelRiesgo,
    confianza: String(r.confianza) as DecisionOptimizacion['confianza'], reversible: r.reversible === true,
    motivo: String(r.motivo), impactoMaximoClp: numero(r.impacto_maximo_clp), creadoEn: iso(r.creado_en) ?? '',
  };
}

function aPendiente(r: Record<string, unknown>): AccionPendiente {
  return {
    organizationId: String(r.organization_id), id: String(r.id), cicloId: String(r.ciclo_id),
    decisionId: String(r.decision_id), estado: String(r.estado) as EstadoPendiente,
    resueltoPor: texto(r.resuelto_por), resueltoEn: iso(r.resuelto_en),
    ajuste: (r.ajuste ?? null) as Record<string, unknown> | null, nota: texto(r.nota),
    expiraEn: iso(r.expira_en), creadoEn: iso(r.creado_en) ?? '',
  };
}

function aPolitica(r: Record<string, unknown>): PoliticaAutonomia {
  return {
    organizationId: String(r.organization_id), version: Number(r.version ?? 1),
    accionesPermitidas: lista(r.acciones_permitidas) as readonly AccionOptimizacion[],
    maxCambioPresupuestoPct: Number(r.max_cambio_presupuesto_pct ?? 0),
    maxCambioCpcPct: Number(r.max_cambio_cpc_pct ?? 0),
    maxCambiosPorDia: Number(r.max_cambios_por_dia ?? 0),
    cooldownHoras: Number(r.cooldown_horas ?? 24),
    horasPermitidas: Array.isArray(r.horas_permitidas) ? (r.horas_permitidas as unknown[]).map((x) => Number(x)) : null,
    activacionAutonomaPermitida: r.activacion_autonoma_permitida === true,
    actualizadoPor: texto(r.actualizado_por), actualizadoEn: iso(r.actualizado_en) ?? '',
  };
}

export class RepositorioOptimizacion {
  constructor(private readonly pool: Pool) {}

  // ── CICLOS ────────────────────────────────────────────────────────────────────────────────────

  async crearCiclo(q: Queryable, c: CicloOptimizacion): Promise<void> {
    await q.query(
      `insert into optimization_cycle (organization_id, id, proveedor, campaign_id, modo, estado, ventana,
         snapshot_id, politica_evaluacion_version, politica_autonomia_version, mandato_id, mandato_version,
         modo_operativo, resumen, motivo, iniciado_en, completado_en)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)`,
      [c.organizationId, c.id, c.proveedor, c.campaignId, c.modo, c.estado, JSON.stringify(c.ventana),
        c.snapshotId, c.politicaEvaluacionVersion, c.politicaAutonomiaVersion, c.mandatoId, c.mandatoVersion,
        c.modoOperativo, JSON.stringify(c.resumen), c.motivo, c.iniciadoEn, c.completadoEn],
    );
  }

  async actualizarCiclo(q: Queryable, org: string, id: string, cambios: {
    readonly estado?: EstadoCiclo; readonly snapshotId?: string | null; readonly resumen?: Record<string, unknown>;
    readonly motivo?: string | null; readonly completadoEn?: string | null;
  }): Promise<void> {
    await q.query(
      `update optimization_cycle set estado = coalesce($3, estado), snapshot_id = coalesce($4, snapshot_id),
         resumen = coalesce($5::jsonb, resumen), motivo = case when $6::text = 'set' then $7 else motivo end,
         completado_en = coalesce($8, completado_en)
       where organization_id = $1 and id = $2`,
      [org, id, cambios.estado ?? null, cambios.snapshotId ?? null,
        cambios.resumen === undefined ? null : JSON.stringify(cambios.resumen),
        cambios.motivo === undefined ? 'keep' : 'set', cambios.motivo ?? null, cambios.completadoEn ?? null],
    );
  }

  async ciclo(org: string, id: string): Promise<CicloOptimizacion | null> {
    const { rows } = await this.pool.query('select * from optimization_cycle where organization_id = $1 and id = $2', [org, id]);
    return rows[0] ? aCiclo(rows[0] as Record<string, unknown>) : null;
  }

  async ciclos(org: string, limite = 20): Promise<readonly CicloOptimizacion[]> {
    const { rows } = await this.pool.query('select * from optimization_cycle where organization_id = $1 order by iniciado_en desc limit $2', [org, limite]);
    return rows.map((r: Record<string, unknown>) => aCiclo(r));
  }

  async ultimoCiclo(org: string): Promise<CicloOptimizacion | null> {
    const { rows } = await this.pool.query('select * from optimization_cycle where organization_id = $1 order by iniciado_en desc limit 1', [org]);
    return rows[0] ? aCiclo(rows[0] as Record<string, unknown>) : null;
  }

  // ── SNAPSHOTS (inmutables) ────────────────────────────────────────────────────────────────────

  async guardarSnapshot(q: Queryable, s: SnapshotObservacion): Promise<void> {
    await q.query(
      `insert into observation_snapshot (organization_id, id, ciclo_id, proveedor, campaign_id, ventana, campania,
         grupos, palabras, terminos, anuncios, salud_medicion, fuente, datos_hasta, observado_en)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15)
       on conflict (organization_id, id) do nothing`,
      [s.organizationId, s.id, s.cicloId, s.proveedor, s.campaignId, JSON.stringify(s.ventana),
        JSON.stringify(s.campania), JSON.stringify(s.gruposAnuncio), JSON.stringify(s.palabras),
        JSON.stringify(s.terminos), JSON.stringify(s.anuncios), s.saludMedicion, s.fuente, s.datosHasta, s.observadoEn],
    );
  }

  async snapshot(org: string, id: string): Promise<SnapshotObservacion | null> {
    const { rows } = await this.pool.query('select * from observation_snapshot where organization_id = $1 and id = $2', [org, id]);
    const r = rows[0] as Record<string, unknown> | undefined;
    if (r === undefined) return null;
    return {
      organizationId: String(r.organization_id), id: String(r.id), cicloId: String(r.ciclo_id),
      proveedor: String(r.proveedor), campaignId: texto(r.campaign_id), ventana: (r.ventana ?? {}) as VentanaObservacion,
      campania: (r.campania ?? {}) as SnapshotObservacion['campania'],
      gruposAnuncio: (Array.isArray(r.grupos) ? r.grupos : []) as readonly RendimientoEntidad[],
      palabras: (Array.isArray(r.palabras) ? r.palabras : []) as readonly RendimientoPalabra[],
      terminos: (Array.isArray(r.terminos) ? r.terminos : []) as readonly RendimientoTermino[],
      anuncios: (Array.isArray(r.anuncios) ? r.anuncios : []) as readonly RendimientoEntidad[],
      saludMedicion: String(r.salud_medicion) as SaludMedicion, fuente: String(r.fuente),
      datosHasta: iso(r.datos_hasta), observadoEn: iso(r.observado_en) ?? '',
    };
  }

  // ── DECISIONES ────────────────────────────────────────────────────────────────────────────────

  async guardarDecision(q: Queryable, d: DecisionOptimizacion): Promise<void> {
    await q.query(
      `insert into optimization_decision (organization_id, id, ciclo_id, accion, objetivo, estado_actual,
         estado_propuesto, evidencia_refs, politica_refs, efecto_esperado, riesgo, confianza, reversible, motivo,
         impacto_maximo_clp, creado_en)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
       on conflict (organization_id, id) do nothing`,
      [d.organizationId, d.id, d.cicloId, d.accion, JSON.stringify(d.objetivo), d.estadoActual, d.estadoPropuesto,
        JSON.stringify(d.evidenciaRefs), JSON.stringify(d.politicaRefs), d.efectoEsperado, d.riesgo, d.confianza,
        d.reversible, d.motivo, d.impactoMaximoClp, d.creadoEn],
    );
  }

  async decisiones(org: string, cicloId: string): Promise<readonly DecisionOptimizacion[]> {
    const { rows } = await this.pool.query('select * from optimization_decision where organization_id = $1 and ciclo_id = $2 order by creado_en, id', [org, cicloId]);
    return rows.map((r: Record<string, unknown>) => aDecision(r));
  }

  async decision(org: string, id: string): Promise<DecisionOptimizacion | null> {
    const { rows } = await this.pool.query('select * from optimization_decision where organization_id = $1 and id = $2', [org, id]);
    return rows[0] ? aDecision(rows[0] as Record<string, unknown>) : null;
  }

  // ── COLA DE APROBACIÓN ────────────────────────────────────────────────────────────────────────

  async guardarPendiente(q: Queryable, p: AccionPendiente): Promise<void> {
    await q.query(
      `insert into pending_marketing_action (organization_id, id, ciclo_id, decision_id, estado, resuelto_por,
         resuelto_en, ajuste, nota, expira_en, creado_en)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
       on conflict (organization_id, id) do update set estado = excluded.estado,
         resuelto_por = excluded.resuelto_por, resuelto_en = excluded.resuelto_en, ajuste = excluded.ajuste,
         nota = excluded.nota`,
      [p.organizationId, p.id, p.cicloId, p.decisionId, p.estado, p.resueltoPor, p.resueltoEn,
        p.ajuste === null ? null : JSON.stringify(p.ajuste), p.nota, p.expiraEn, p.creadoEn],
    );
  }

  async pendiente(org: string, id: string): Promise<AccionPendiente | null> {
    const { rows } = await this.pool.query('select * from pending_marketing_action where organization_id = $1 and id = $2', [org, id]);
    return rows[0] ? aPendiente(rows[0] as Record<string, unknown>) : null;
  }

  async pendientes(org: string, estados: readonly EstadoPendiente[] = ['PENDING']): Promise<readonly AccionPendiente[]> {
    const { rows } = await this.pool.query(
      'select * from pending_marketing_action where organization_id = $1 and estado = any($2) order by creado_en desc',
      [org, estados]);
    return rows.map((r: Record<string, unknown>) => aPendiente(r));
  }

  // ── ACCIONES APLICADAS ────────────────────────────────────────────────────────────────────────

  /** Devuelve `false` si la clave ya existía (idempotencia): la acción NO se vuelve a aplicar. */
  async registrarAccionSiNueva(q: Queryable, a: AccionAplicada): Promise<boolean> {
    const { rowCount } = await q.query(
      `insert into optimization_action_log (organization_id, id, ciclo_id, decision_id, accion, clave_idempotencia,
         resultado, verificacion, recurso_externo, provider_request_id, detalle, aplicado_en)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
       on conflict do nothing`,
      [a.organizationId, a.id, a.cicloId, a.decisionId, a.accion, a.claveIdempotencia, a.resultado, a.verificacion,
        a.recursoExterno, a.providerRequestId, JSON.stringify(a.detalle), a.aplicadoEn],
    );
    return (rowCount ?? 0) > 0;
  }

  async accionPorClave(org: string, clave: string): Promise<AccionAplicada | null> {
    const { rows } = await this.pool.query(
      `select * from optimization_action_log where organization_id = $1 and clave_idempotencia = $2
       and resultado in ('APPLIED','NOOP_ALREADY_APPLIED') limit 1`, [org, clave]);
    const r = rows[0] as Record<string, unknown> | undefined;
    return r === undefined ? null : {
      organizationId: String(r.organization_id), id: String(r.id), cicloId: String(r.ciclo_id),
      decisionId: String(r.decision_id), accion: String(r.accion) as AccionOptimizacion,
      claveIdempotencia: String(r.clave_idempotencia), resultado: String(r.resultado) as ResultadoAccion,
      verificacion: String(r.verificacion) as VerificacionRemota, recursoExterno: texto(r.recurso_externo),
      providerRequestId: texto(r.provider_request_id), detalle: (r.detalle ?? {}) as Record<string, unknown>,
      aplicadoEn: iso(r.aplicado_en) ?? '',
    };
  }

  async accionesDelCiclo(org: string, cicloId: string): Promise<readonly AccionAplicada[]> {
    const { rows } = await this.pool.query('select * from optimization_action_log where organization_id = $1 and ciclo_id = $2 order by aplicado_en', [org, cicloId]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), cicloId: String(r.ciclo_id),
      decisionId: String(r.decision_id), accion: String(r.accion) as AccionOptimizacion,
      claveIdempotencia: String(r.clave_idempotencia), resultado: String(r.resultado) as ResultadoAccion,
      verificacion: String(r.verificacion) as VerificacionRemota, recursoExterno: texto(r.recurso_externo),
      providerRequestId: texto(r.provider_request_id), detalle: (r.detalle ?? {}) as Record<string, unknown>,
      aplicadoEn: iso(r.aplicado_en) ?? '',
    }));
  }

  /** Cuántos cambios efectivos se aplicaron desde una fecha: alimenta el tope diario y el cooldown. */
  async cambiosDesde(org: string, desde: string, accion?: AccionOptimizacion): Promise<number> {
    const { rows } = await this.pool.query(
      `select count(*)::int as n from optimization_action_log
       where organization_id = $1 and aplicado_en >= $2 and resultado = 'APPLIED'
       and ($3::text is null or accion = $3)`, [org, desde, accion ?? null]);
    return Number((rows[0] as { n: number }).n);
  }

  /** Última vez que se aplicó esta acción sobre este objetivo: base del cooldown y de la histéresis. */
  async ultimaAccionSobre(org: string, accion: AccionOptimizacion, objetivoId: string): Promise<AccionAplicada | null> {
    const { rows } = await this.pool.query(
      `select * from optimization_action_log where organization_id = $1 and accion = $2
       and clave_idempotencia like $3 and resultado = 'APPLIED' order by aplicado_en desc limit 1`,
      [org, accion, `%:${objetivoId}:%`]);
    const r = rows[0] as Record<string, unknown> | undefined;
    return r === undefined ? null : {
      organizationId: String(r.organization_id), id: String(r.id), cicloId: String(r.ciclo_id),
      decisionId: String(r.decision_id), accion: String(r.accion) as AccionOptimizacion,
      claveIdempotencia: String(r.clave_idempotencia), resultado: String(r.resultado) as ResultadoAccion,
      verificacion: String(r.verificacion) as VerificacionRemota, recursoExterno: texto(r.recurso_externo),
      providerRequestId: texto(r.provider_request_id), detalle: (r.detalle ?? {}) as Record<string, unknown>,
      aplicadoEn: iso(r.aplicado_en) ?? '',
    };
  }

  // ── APRENDIZAJE ───────────────────────────────────────────────────────────────────────────────

  async guardarAprendizaje(q: Queryable, l: RegistroAprendizaje): Promise<void> {
    await q.query(
      `insert into learning_outcome (organization_id, id, decision_id, accion, efecto_esperado, metricas_antes,
         metricas_despues, resultado, nota, evaluable_desde, evaluado_en)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)
       on conflict (organization_id, id) do update set metricas_despues = excluded.metricas_despues,
         resultado = excluded.resultado, nota = excluded.nota, evaluado_en = excluded.evaluado_en`,
      [l.organizationId, l.id, l.decisionId, l.accion, l.efectoEsperado, JSON.stringify(l.metricasAntes),
        l.metricasDespues === null ? null : JSON.stringify(l.metricasDespues), l.resultado, l.nota,
        l.evaluableDesde, l.evaluadoEn],
    );
  }

  async aprendizajes(org: string, limite = 20): Promise<readonly RegistroAprendizaje[]> {
    const { rows } = await this.pool.query('select * from learning_outcome where organization_id = $1 order by evaluable_desde desc limit $2', [org, limite]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), decisionId: String(r.decision_id),
      accion: String(r.accion) as AccionOptimizacion, efectoEsperado: String(r.efecto_esperado),
      metricasAntes: (r.metricas_antes ?? {}) as MetricasObservadas,
      metricasDespues: (r.metricas_despues ?? null) as MetricasObservadas | null,
      resultado: String(r.resultado) as ResultadoAprendizaje, nota: texto(r.nota),
      evaluableDesde: iso(r.evaluable_desde) ?? '', evaluadoEn: iso(r.evaluado_en),
    }));
  }

  async aprendizajesPendientes(org: string, hasta: string): Promise<readonly RegistroAprendizaje[]> {
    const { rows } = await this.pool.query(
      `select * from learning_outcome where organization_id = $1 and evaluado_en is null and evaluable_desde <= $2
       order by evaluable_desde limit 20`, [org, hasta]);
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: String(r.organization_id), id: String(r.id), decisionId: String(r.decision_id),
      accion: String(r.accion) as AccionOptimizacion, efectoEsperado: String(r.efecto_esperado),
      metricasAntes: (r.metricas_antes ?? {}) as MetricasObservadas,
      metricasDespues: (r.metricas_despues ?? null) as MetricasObservadas | null,
      resultado: String(r.resultado) as ResultadoAprendizaje, nota: texto(r.nota),
      evaluableDesde: iso(r.evaluable_desde) ?? '', evaluadoEn: iso(r.evaluado_en),
    }));
  }

  // ── POLÍTICA DE AUTONOMÍA ─────────────────────────────────────────────────────────────────────

  async guardarPolitica(q: Queryable, p: PoliticaAutonomia): Promise<void> {
    await q.query(
      `insert into autonomy_policy (organization_id, version, acciones_permitidas, max_cambio_presupuesto_pct,
         max_cambio_cpc_pct, max_cambios_por_dia, cooldown_horas, horas_permitidas,
         activacion_autonoma_permitida, actualizado_por, actualizado_en)
       values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
       on conflict (organization_id) do update set version = autonomy_policy.version + 1,
         acciones_permitidas = excluded.acciones_permitidas,
         max_cambio_presupuesto_pct = excluded.max_cambio_presupuesto_pct,
         max_cambio_cpc_pct = excluded.max_cambio_cpc_pct, max_cambios_por_dia = excluded.max_cambios_por_dia,
         cooldown_horas = excluded.cooldown_horas, horas_permitidas = excluded.horas_permitidas,
         activacion_autonoma_permitida = excluded.activacion_autonoma_permitida,
         actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en`,
      [p.organizationId, p.version, JSON.stringify(p.accionesPermitidas), p.maxCambioPresupuestoPct,
        p.maxCambioCpcPct, p.maxCambiosPorDia, p.cooldownHoras,
        p.horasPermitidas === null ? null : JSON.stringify(p.horasPermitidas),
        p.activacionAutonomaPermitida, p.actualizadoPor, p.actualizadoEn],
    );
  }

  async politica(org: string): Promise<PoliticaAutonomia | null> {
    const { rows } = await this.pool.query('select * from autonomy_policy where organization_id = $1', [org]);
    return rows[0] ? aPolitica(rows[0] as Record<string, unknown>) : null;
  }
}
