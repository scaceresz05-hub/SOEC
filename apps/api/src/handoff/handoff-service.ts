/**
 * apps/api · HANDOFF EXTERNO · servicio.
 *
 * Tres responsabilidades, y ninguna más:
 *
 *  · SINCRONIZAR — mirar el estado real de cada canal y dejar abierta la tarea que corresponda, sin duplicar.
 *  · MOSTRAR — devolver UNA tarea, la que toca por dependencia, en lenguaje de negocio.
 *  · VERIFICAR — pasar las tareas abiertas por sus verificadores y cerrar las que el mundo ya resolvió.
 *
 * Lo que este servicio NO hace, y conviene que siga sin hacer: conceder permisos. Completar una tarea
 * desbloquea el paso siguiente; no enciende la escritura, no crea mandato y no activa campañas. Si alguna vez
 * alguien quiere «simplificar» eso, que tenga que borrar este párrafo primero.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioHandoff } from './handoff-pg';
import { handoffDeGoogle, TIPOS_DE_GOOGLE, type EstadoGoogleParaHandoff, type IntencionHandoff } from './handoff-google';
import {
  aTareaVisible, metadataSegura, proveedorDeCanal, tareaPrincipal, urlDeProveedorValida,
  type CanalHandoff, type Handoff, type TareaVisible, type TipoHandoff, type VerificadorHandoff, type VeredictoHandoff,
} from './handoff-tipos';

export interface DepsHandoff {
  readonly ahora?: () => string;
  /** Verificadores de condición externa. Sin ellos nada se cierra solo, que es el sesgo seguro. */
  readonly verificadores?: readonly VerificadorHandoff[];
  /**
   * Estado real del canal de Google para una empresa. Es el MISMO lector que usan los verificadores: así lo
   * que abre una tarea y lo que la cierra miran al mismo sitio.
   */
  readonly leerEstadoGoogle?: (org: string) => Promise<EstadoGoogleParaHandoff | null>;
  /**
   * Recalcular la preparación del negocio tras cerrar una tarea. La preparación es un read model —se calcula
   * al mirarla, no hay caché que invalidar—, así que este puerto no «refresca» nada: sirve para que el paso
   * siguiente del recorrido se evalúe en el mismo acto en que se desbloquea, y para poder observarlo.
   */
  readonly recalcularPreparacion?: (org: string) => Promise<unknown>;
  readonly log?: (info: Record<string, unknown>) => void;
}

/** Lo que devuelve una reanudación: qué se cerró, qué se abrió detrás y qué toca ahora. */
export interface Reanudacion {
  readonly organizationId: string;
  /** Tareas que vencieron en esta pasada. */
  readonly vencidas: number;
  /** Tareas abiertas que se pasaron por un verificador. */
  readonly revisadas: number;
  /** Ids de las que el mundo confirmó como hechas. */
  readonly completadas: readonly string[];
  /** `true` cuando se volvió a calcular la preparación porque algo se cerró. */
  readonly preparacionRecalculada: boolean;
  /** La única cosa que se le pide a la persona DESPUÉS de reanudar. */
  readonly siguiente: TareaVisible | null;
  readonly pendientes: number;
}

export interface VistaHandoff {
  readonly organizationId: string;
  /** La única cosa que se le pide a la persona ahora. `null` ⇒ no hay nada pendiente fuera de SOEC. */
  readonly tarea: TareaVisible | null;
  /** Cuántas quedan detrás. Se cuenta, no se lista: una lista de bloqueos no ayuda a nadie a avanzar. */
  readonly pendientes: number;
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

export class HandoffService {
  private readonly repo: RepositorioHandoff;
  private readonly negocios: RepositorioNegocios;
  private readonly ahora: () => string;

  constructor(private readonly pool: Pool, private readonly deps: DepsHandoff = {}) {
    this.repo = new RepositorioHandoff(pool);
    this.negocios = new RepositorioNegocios(pool);
    this.ahora = deps.ahora ?? (() => new Date().toISOString());
  }

  /**
   * Abre (o reutiliza) la tarea de una intención. Idempotente por causa: pedir dos veces lo mismo no crea dos
   * tareas, y si la anterior se completó y la condición vuelve, nace una instancia nueva con su historia.
   */
  async abrir(org: string, intencion: IntencionHandoff, opciones: { readonly expiraEn?: string | null; readonly actor?: string } = {}): Promise<Handoff> {
    // fail-closed: un host que no sea del proveedor de este canal ⇒ lanza y no se escribe nada.
    const url = urlDeProveedorValida(intencion.urlProveedor, proveedorDeCanal(intencion.canal));
    const metadata = metadataSegura(intencion.metadata);
    const ahora = this.ahora();
    const propuesta: Handoff = {
      id: `hand-${randomUUID().slice(0, 12)}`,
      organizationId: org,
      proveedor: proveedorDeCanal(intencion.canal),
      canal: intencion.canal,
      tipo: intencion.tipo,
      // Una tarea que el proveedor no permite completar hoy se dice así desde el principio.
      estado: intencion.bloqueadaFuera === true ? 'BLOCKED_EXTERNAL' : 'OPEN',
      causa: intencion.causa,
      instruccion: intencion.instruccion,
      motivo: intencion.motivo,
      urlProveedor: url,
      etiquetaAccion: intencion.etiquetaAccion,
      referenciaProveedor: null,
      metadata,
      creadoEn: ahora,
      actualizadoEn: ahora,
      expiraEn: opciones.expiraEn ?? null,
      completadoEn: null,
      canceladoEn: null,
    };

    const guardada = await enTransaccion(this.pool, async (tx) => {
      const h = await this.repo.abrirSiFalta(tx, propuesta);
      if (h.id === propuesta.id) {
        // Sólo se audita el ALTA real, no cada vez que se vuelve a mirar el mismo estado.
        await this.negocios.registrarAuditoria(tx, {
          organizationId: org, actor: opciones.actor ?? 'soec', action: 'HANDOFF_CREATED',
          changedFields: { tipo: h.tipo, proveedor: h.proveedor, canal: h.canal, causa: h.causa, at: ahora },
        });
      }
      return h;
    });
    this.deps.log?.({ handoff: guardada.id === propuesta.id ? 'abierta' : 'reutilizada', org, tipo: guardada.tipo, causa: guardada.causa });
    return guardada;
  }

  /** La persona salió al proveedor: la tarea queda esperando al mundo, no a ella. */
  async marcarEsperandoFuera(org: string, id: string, actor = 'soec'): Promise<Handoff | null> {
    return enTransaccion(this.pool, async (tx) => {
      const h = await this.repo.cambiarEstado(tx, org, id, 'WAITING_EXTERNAL');
      if (h === null) return null; // de otra empresa, o inexistente: no se audita lo que no ocurrió
      await this.negocios.registrarAuditoria(tx, {
        organizationId: org, actor, action: 'HANDOFF_UPDATED',
        changedFields: { tipo: h.tipo, causa: h.causa, estado: 'WAITING_EXTERNAL', at: this.ahora() },
      });
      return h;
    });
  }

  /**
   * Sincroniza el canal GOOGLE_ADS: abre la tarea que corresponde al estado real y cancela las que ya no
   * aplican. Se llama al leer la vista, así que la pantalla nunca muestra una tarea que el mundo ya resolvió.
   */
  async sincronizarGoogle(org: string, estado: EstadoGoogleParaHandoff, actor = 'soec'): Promise<Handoff | null> {
    const intencion = handoffDeGoogle(estado);
    // Lo que ya no aplica se cancela. Si no hace falta nada, se cancelan TODOS los tipos del canal.
    const sobran: TipoHandoff[] = intencion === null
      ? [...TIPOS_DE_GOOGLE]
      : TIPOS_DE_GOOGLE.filter((t) => t !== intencion.tipo);
    await enTransaccion(this.pool, async (tx) => {
      await this.vencerYAuditar(tx, org, actor);
      const canceladas = await this.repo.cancelarAbiertas(tx, org, 'GOOGLE_ADS', sobran);
      for (const c of canceladas) {
        await this.negocios.registrarAuditoria(tx, {
          organizationId: org, actor, action: 'HANDOFF_CANCELLED',
          changedFields: { tipo: c.tipo, causa: c.causa, motivo: 'dejó de hacer falta', at: this.ahora() },
        });
      }
    });
    if (intencion === null) return null;
    return this.abrir(org, intencion, { actor });
  }

  /** Vence lo caducado dejando constancia de cada una. Un vencimiento silencioso no se puede explicar después. */
  private async vencerYAuditar(tx: PoolClient, org: string, actor: string): Promise<number> {
    const vencidas = await this.repo.vencerCaducadas(tx, org);
    for (const v of vencidas) {
      await this.negocios.registrarAuditoria(tx, {
        organizationId: org, actor, action: 'HANDOFF_EXPIRED',
        changedFields: { tipo: v.tipo, causa: v.causa, expiraEn: v.expiraEn, at: this.ahora() },
      });
    }
    return vencidas.length;
  }

  /**
   * Qué se le pide a esta empresa ahora mismo, y cuántas cosas quedan detrás.
   *
   * LECTURA PURA. No abre tareas, no las vence y no audita. Antes sí: mirar la pantalla creaba la tarea, de
   * modo que el propio acto de comprobar cambiaba lo comprobado — y una auditoría en la que aparecen filas
   * que nadie decidió crear deja de servir para responder «¿quién hizo esto?». Quien sincroniza es
   * `reanudar`, tras una llamada explícitamente mutadora.
   */
  async vista(org: string): Promise<VistaHandoff> {
    const abiertas = await this.repo.abiertas(org);
    const principal = tareaPrincipal(abiertas);
    return {
      organizationId: org,
      tarea: principal === null ? null : aTareaVisible(principal),
      pendientes: Math.max(0, abiertas.length - (principal === null ? 0 : 1)),
    };
  }

  /**
   * Pasa las tareas abiertas por sus verificadores y cierra las que el mundo ya resolvió. Nadie marca una
   * tarea como hecha diciéndolo: se comprueba. Sin verificador para un tipo, la tarea sigue abierta — que es
   * exactamente lo que debe pasar mientras ese verificador no exista.
   */
  async verificarPendientes(org: string, actor = 'soec'): Promise<{ readonly revisadas: number; readonly completadas: readonly string[] }> {
    const verificadores = this.deps.verificadores ?? [];
    const abiertas = await this.repo.abiertas(org);
    const completadas: string[] = [];

    for (const h of abiertas) {
      const v = verificadores.find((x) => x.soporta(h));
      if (v === undefined) continue;
      let veredicto: VeredictoHandoff;
      try {
        veredicto = await v.verificar(h);
      } catch {
        // Un verificador que falla no cierra nada ni cambia nada: el silencio no es una confirmación.
        continue;
      }

      // Ni `STILL_REQUIRED` ni `RETRY_LATER` tocan la fila. La primera porque la tarea sigue siendo cierta; la
      // segunda porque no sabemos nada nuevo, y escribir «no sé» como si fuera un hecho es el error a evitar.
      if (veredicto.resultado === 'STILL_REQUIRED' || veredicto.resultado === 'RETRY_LATER') continue;

      if (veredicto.resultado === 'BLOCKED_EXTERNAL') {
        if (h.estado === 'BLOCKED_EXTERNAL') continue; // ya estaba dicho: no se repite la auditoría
        await enTransaccion(this.pool, async (tx) => {
          await this.repo.cambiarEstado(tx, org, h.id, 'BLOCKED_EXTERNAL');
          await this.negocios.registrarAuditoria(tx, {
            organizationId: org, actor, action: 'HANDOFF_UPDATED',
            changedFields: { tipo: h.tipo, causa: h.causa, estado: 'BLOCKED_EXTERNAL', verificador: v.nombre, detalle: veredicto.detalle, at: this.ahora() },
          });
        });
        continue;
      }

      await enTransaccion(this.pool, async (tx) => {
        await this.repo.cambiarEstado(tx, org, h.id, 'COMPLETED', { referenciaProveedor: veredicto.referenciaProveedor ?? null });
        await this.negocios.registrarAuditoria(tx, {
          organizationId: org, actor, action: 'HANDOFF_COMPLETED',
          changedFields: { tipo: h.tipo, canal: h.canal, causa: h.causa, verificador: v.nombre, detalle: veredicto.detalle, at: this.ahora() },
        });
      });
      completadas.push(h.id);
    }
    return { revisadas: abiertas.length, completadas };
  }

  /**
   * REANUDACIÓN. El paso que convierte una lista de tareas en un recorrido que avanza solo:
   *
   *   vencer lo caducado → verificar contra el mundo → cerrar lo que ya está hecho → recalcular qué falta
   *   ahora → abrir la tarea siguiente si corresponde → devolver esa única cosa.
   *
   * Es idempotente: llamarla dos veces no cierra dos veces nada, no duplica filas y no vuelve a auditar lo
   * mismo. Lo que NO hace, y es deliberado: no crea mandato, no autoriza gasto, no enciende escritura y no
   * activa campañas. Desbloquea el paso; no se concede a sí misma el permiso del paso siguiente.
   */
  async reanudar(org: string, actor = 'soec'): Promise<Reanudacion> {
    const vencidas = await enTransaccion(this.pool, async (tx) => this.vencerYAuditar(tx, org, actor));
    const r = await this.verificarPendientes(org, actor);

    // Recalcular QUÉ FALTA AHORA contra el mundo: puede que al cerrar una tarea aparezca la siguiente (se creó
    // la cuenta ⇒ ahora falta elegirla) o que ya no falte nada por este canal.
    if (this.deps.leerEstadoGoogle !== undefined) {
      const estado = await this.deps.leerEstadoGoogle(org).catch(() => null);
      if (estado !== null) await this.sincronizarGoogle(org, estado, actor);
    }

    let preparacionRecalculada = false;
    if (r.completadas.length > 0 && this.deps.recalcularPreparacion !== undefined) {
      // Si el recálculo falla, la tarea sigue cerrada: lo que se comprobó del mundo no se deshace por esto.
      await this.deps.recalcularPreparacion(org).then(() => { preparacionRecalculada = true; }).catch(() => undefined);
    }

    const v = await this.vista(org);
    this.deps.log?.({ handoff: 'reanudado', org, vencidas, completadas: r.completadas.length, siguiente: v.tarea?.id ?? null });
    return {
      organizationId: org,
      vencidas,
      revisadas: r.revisadas,
      completadas: r.completadas,
      preparacionRecalculada,
      siguiente: v.tarea,
      pendientes: v.pendientes,
    };
  }

  /** Historial completo, para auditoría y para entender por qué una empresa tardó lo que tardó. */
  async historial(org: string): Promise<readonly Handoff[]> {
    return this.repo.historial(org);
  }
}

export type { CanalHandoff, Handoff, IntencionHandoff, TareaVisible, VerificadorHandoff };
