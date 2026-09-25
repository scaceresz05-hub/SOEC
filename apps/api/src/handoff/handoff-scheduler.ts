/**
 * apps/api · HANDOFF EXTERNO · REANUDACIÓN AUTÓNOMA (Autonomy Fase I.4).
 *
 * Hasta ahora, para que SOEC se enterara de que una persona ya había hecho lo suyo en Google, esa persona
 * tenía que volver y pulsar «ya lo hice». Es un contrato raro: le pedimos a alguien que nos avise de algo que
 * nosotros podemos mirar. Este scheduler mira.
 *
 * Cada tick recorre las empresas ELEGIBLES y las pasa por `HandoffService.reanudar`, que es exactamente la
 * misma lógica que usa `POST /handoff/sync`. No hay una segunda derivación, ni un segundo cliente de Google,
 * ni un segundo OAuth: si algún día divergen, no será porque aquí se reimplementó nada.
 *
 * QUIÉN ES ELEGIBLE. Aquí hubo un error que llegó a producción: «tiene Google conectado» se tomó por «se
 * está incorporando», y el scheduler le abrió una tarea de incorporación a una empresa que lleva meses
 * operando con campañas reales. Conectado y en incorporación no son lo mismo: lo primero es un hecho técnico
 * permanente, lo segundo es una ETAPA, y las etapas se terminan.
 *
 * La regla correcta, expresada con lo que el sistema ya sabe: está incorporando el canal quien **empezó su
 * autorización y todavía no opera con él**. Que SOEC ya mida, dirija u optimice esa cuenta —`MEDICION_REAL`,
 * `DIRECTOR_REAL`, `CICLO_DIRECTOR`, `AUTONOMIA_ADS`, `ESCRITURA_ADS`— significa que esa etapa quedó atrás, y
 * una etapa terminada no se vuelve a abrir por la espalda. Sigue saliendo de los datos: ninguna empresa está
 * nombrada en el código.
 *
 * AISLAMIENTO. El fallo de una empresa no detiene a las demás (try/catch por empresa). Y una indisponibilidad
 * del proveedor —timeout, 429, 5xx— nunca se convierte en una decisión de negocio: el verificador responde
 * `RETRY_LATER`, la tarea se queda como está y el tick siguiente lo vuelve a intentar.
 */
import type { Pool } from 'pg';
import type { Reanudacion } from './handoff-service';

/** Lo único que el scheduler necesita saber hacer: reanudar una empresa. Lo cumple `HandoffService`. */
export interface ReanudadorDeHandoffs {
  reanudar(org: string, actor?: string, opciones?: { readonly maxPasos?: number }): Promise<Reanudacion>;
}

export interface DepsHandoffScheduler {
  readonly reanudador: ReanudadorDeHandoffs;
  /** Qué empresas examinar. Se calcula de los datos; nunca una lista fija. */
  readonly elegibles: () => Promise<readonly string[]>;
  /** Intervalo entre ticks. Default: 5 minutos. */
  readonly intervaloMs?: number;
  /**
   * Retraso de la primera corrida. El arranque ya dispara varias lecturas a Google (ingesta, sonda de fechas,
   * ciclo del director); sumarse a esa ráfaga sólo consigue 429 para todos.
   */
  readonly retrasoInicialMs?: number;
  /** Apagado explícito. Por defecto está encendido: sin él, la reanudación vuelve a depender de un clic. */
  readonly habilitado?: boolean;
  readonly maxPasos?: number;
  readonly ahora?: () => string;
  /** Logger sanitizado. Nunca recibe credenciales: aquí sólo viajan ids de empresa y contadores. */
  readonly log?: (evento: Record<string, unknown>) => void;
}

export interface ResumenTick {
  readonly corridaAt: string;
  readonly organizaciones: number;
  readonly comprobados: number;
  readonly completados: number;
  readonly creados: number;
  readonly retryLater: number;
  readonly bloqueados: number;
  readonly omitidas: number;
  readonly errores: number;
  readonly duracionMs: number;
}

export const INTERVALO_POR_DEFECTO_MS = 5 * 60 * 1000;
export const RETRASO_INICIAL_POR_DEFECTO_MS = 45 * 1000;

/**
 * Capacidades que significan «esta empresa YA OPERA el canal». No son permisos de gasto: son la prueba de que
 * el recorrido de incorporación terminó y SOEC trabaja con esa cuenta a diario.
 */
export const CAPACIDADES_DE_OPERACION: readonly string[] = [
  'MEDICION_REAL', 'DIRECTOR_REAL', 'CICLO_DIRECTOR', 'AUTONOMIA_ADS', 'ESCRITURA_ADS',
];

/**
 * Empresas que están INCORPORANDO el canal: empezaron su autorización —en cualquier estado, incluida una
 * caducada— o tienen una tarea abierta, y todavía no operan con él.
 *
 * El filtro de madurez se aplica a las DOS ramas a propósito. Si sólo se aplicara a la primera, una empresa
 * ya operativa con una tarea vieja abierta volvería a entrar por la puerta de atrás, que es exactamente el
 * caso que hay que evitar: lo que ya existe se deja quieto, no se sigue removiendo.
 */
export function organizacionesIncorporandoCanal(pool: Pool): () => Promise<readonly string[]> {
  return async () => {
    const { rows } = await pool.query(
      `with operativas as (
         select distinct organization_id from business_capability
          where habilitada = true and capacidad = any($1::text[])
       )
       select organization_id from google_ads_connection
        where organization_id not in (select organization_id from operativas)
       union
       select organization_id from external_handoff
        where estado in ('OPEN', 'WAITING_EXTERNAL', 'BLOCKED_EXTERNAL')
          and organization_id not in (select organization_id from operativas)`,
      [CAPACIDADES_DE_OPERACION],
    );
    return rows.map((r: { organization_id: string }) => String(r.organization_id));
  };
}

/**
 * Una corrida completa. Nunca lanza: devuelve el resumen aunque alguna empresa falle, porque un scheduler que
 * muere por un tenant roto deja a todos los demás sin reanudación.
 */
export async function correrTickDeHandoffs(deps: DepsHandoffScheduler): Promise<ResumenTick> {
  const ahora = deps.ahora ?? ((): string => new Date().toISOString());
  const corridaAt = ahora();
  const t0 = Date.now();
  let comprobados = 0; let completados = 0; let creados = 0;
  let retryLater = 0; let bloqueados = 0; let omitidas = 0; let errores = 0;

  let orgs: readonly string[] = [];
  try {
    orgs = await deps.elegibles();
  } catch (e) {
    deps.log?.({ scheduler: 'handoff', error: e instanceof Error ? e.message : 'no se pudo listar empresas' });
    return { corridaAt, organizaciones: 0, comprobados: 0, completados: 0, creados: 0, retryLater: 0, bloqueados: 0, omitidas: 0, errores: 1, duracionMs: Date.now() - t0 };
  }

  for (const org of orgs) {
    try {
      const opciones = deps.maxPasos === undefined ? {} : { maxPasos: deps.maxPasos };
      const r = await deps.reanudador.reanudar(org, 'scheduler', opciones);
      comprobados += r.revisadas;
      completados += r.completadas.length;
      creados += r.creadas;
      retryLater += r.retryLater;
      bloqueados += r.bloqueadas;
      if (r.omitidaPorConcurrencia) omitidas += 1;
    } catch (e) {
      errores += 1;
      deps.log?.({ scheduler: 'handoff', org, error: e instanceof Error ? e.message : 'error desconocido' });
    }
  }

  const resumen: ResumenTick = {
    corridaAt, organizaciones: orgs.length, comprobados, completados, creados,
    retryLater, bloqueados, omitidas, errores, duracionMs: Date.now() - t0,
  };
  // Un tick que no cambió nada no se registra: cinco minutos de «no pasó nada» repetidos tapan lo que importa.
  if (completados > 0 || creados > 0 || errores > 0) deps.log?.({ scheduler: 'handoff', ...resumen });
  return resumen;
}

export class ExternalHandoffScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private primera: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly deps: DepsHandoffScheduler) {}

  iniciar(): { agendado: boolean; intervaloMs: number } {
    const intervaloMs = this.deps.intervaloMs ?? INTERVALO_POR_DEFECTO_MS;
    if (this.deps.habilitado === false) return { agendado: false, intervaloMs };
    if (this.timer !== null) return { agendado: true, intervaloMs };

    const correr = (): void => {
      void correrTickDeHandoffs(this.deps).catch((e) => this.deps.log?.({ scheduler: 'handoff', error: e instanceof Error ? e.message : 'error' }));
    };
    const retraso = this.deps.retrasoInicialMs ?? RETRASO_INICIAL_POR_DEFECTO_MS;
    if (retraso > 0) {
      const t = setTimeout(correr, retraso);
      if (typeof t.unref === 'function') t.unref();
      this.primera = t;
    } else {
      correr();
    }
    this.timer = setInterval(correr, intervaloMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return { agendado: true, intervaloMs };
  }

  detener(): void {
    if (this.primera !== null) { clearTimeout(this.primera); this.primera = null; }
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }
}
