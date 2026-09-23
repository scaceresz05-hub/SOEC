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
  aTareaVisible, metadataSegura, tareaPrincipal, urlDeProveedorValida,
  type CanalHandoff, type Handoff, type TareaVisible, type TipoHandoff, type VerificadorHandoff,
} from './handoff-tipos';

export interface DepsHandoff {
  readonly ahora?: () => string;
  /** Verificadores de condición externa. En esta fase pueden no existir: el contrato ya está. */
  readonly verificadores?: readonly VerificadorHandoff[];
  readonly log?: (info: Record<string, unknown>) => void;
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
    const url = urlDeProveedorValida(intencion.urlProveedor); // fail-closed: host no permitido ⇒ lanza
    const metadata = metadataSegura(intencion.metadata);
    const ahora = this.ahora();
    const propuesta: Handoff = {
      id: `hand-${randomUUID().slice(0, 12)}`,
      organizationId: org,
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
    };

    const guardada = await enTransaccion(this.pool, async (tx) => {
      const h = await this.repo.abrirSiFalta(tx, propuesta);
      if (h.id === propuesta.id) {
        // Sólo se audita el ALTA real, no cada vez que se vuelve a mirar el mismo estado.
        await this.negocios.registrarAuditoria(tx, {
          organizationId: org, actor: opciones.actor ?? 'soec', action: 'EXTERNAL_HANDOFF_OPENED',
          changedFields: { tipo: h.tipo, canal: h.canal, causa: h.causa, at: ahora },
        });
      }
      return h;
    });
    this.deps.log?.({ handoff: guardada.id === propuesta.id ? 'abierta' : 'reutilizada', org, tipo: guardada.tipo, causa: guardada.causa });
    return guardada;
  }

  /** La persona salió al proveedor: la tarea queda esperando al mundo, no a ella. */
  async marcarEsperandoFuera(org: string, id: string): Promise<Handoff | null> {
    return this.repo.cambiarEstado(this.pool, org, id, 'WAITING_EXTERNAL');
  }

  /**
   * Sincroniza el canal GOOGLE_ADS: abre la tarea que corresponde al estado real y cancela las que ya no
   * aplican. Se llama al leer la vista, así que la pantalla nunca muestra una tarea que el mundo ya resolvió.
   */
  async sincronizarGoogle(org: string, estado: EstadoGoogleParaHandoff, actor = 'soec'): Promise<Handoff | null> {
    const intencion = handoffDeGoogle(estado);
    const vigentes: TipoHandoff[] = intencion === null
      ? [...TIPOS_DE_GOOGLE]
      : TIPOS_DE_GOOGLE.filter((t) => t !== intencion.tipo);
    await enTransaccion(this.pool, async (tx) => {
      await this.repo.vencerCaducadas(tx, org);
      await this.repo.cancelarAbiertas(tx, org, 'GOOGLE_ADS', vigentes);
    });
    if (intencion === null) {
      // También se cierra la del tipo vigente si ya no hace falta: el canal quedó resuelto.
      await enTransaccion(this.pool, async (tx) => { await this.repo.cancelarAbiertas(tx, org, 'GOOGLE_ADS', [...TIPOS_DE_GOOGLE]); });
      return null;
    }
    return this.abrir(org, intencion, { actor });
  }

  /** Qué se le pide a esta empresa ahora mismo, y cuántas cosas quedan detrás. */
  async vista(org: string): Promise<VistaHandoff> {
    await enTransaccion(this.pool, async (tx) => { await this.repo.vencerCaducadas(tx, org); });
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
      let resultado: Awaited<ReturnType<VerificadorHandoff['verificar']>>;
      try {
        resultado = await v.verificar(h);
      } catch {
        continue; // un verificador que falla no cierra nada: el silencio no es una confirmación
      }
      if (!resultado.cumplida) continue;
      await enTransaccion(this.pool, async (tx) => {
        await this.repo.cambiarEstado(tx, org, h.id, 'COMPLETED', { referenciaProveedor: resultado.referenciaProveedor ?? null });
        await this.negocios.registrarAuditoria(tx, {
          organizationId: org, actor, action: 'EXTERNAL_HANDOFF_COMPLETED',
          changedFields: { tipo: h.tipo, canal: h.canal, causa: h.causa, verificador: v.nombre, detalle: resultado.detalle, at: this.ahora() },
        });
      });
      completadas.push(h.id);
    }
    return { revisadas: abiertas.length, completadas };
  }

  /** Historial completo, para auditoría y para entender por qué una empresa tardó lo que tardó. */
  async historial(org: string): Promise<readonly Handoff[]> {
    return this.repo.historial(org);
  }
}

export type { CanalHandoff, Handoff, IntencionHandoff, TareaVisible, VerificadorHandoff };
