/**
 * apps/api · PROVISIONAMIENTO · el servicio que decide, registra y (si alguna vez se autoriza) ejecuta.
 *
 * Tres cosas, en este orden, que es el orden de la prudencia:
 *
 *  1. EVALUAR. Preguntar al proveedor qué permite hoy y dejarlo escrito. Nunca crea nada.
 *  2. INTENTAR. Sólo si la capacidad dice `AUTOMATABLE` y la bandera de escritura está encendida.
 *  3. RECONCILIAR. Si la respuesta se perdió, preguntar si la cuenta ya existe ANTES de volver a crearla.
 *
 * El punto 3 es el que justifica que todo esto sea una entidad y no una función: crear una cuenta de anuncios
 * es irreversible en la vida de alguien. Ante una respuesta incierta, el sesgo no es reintentar —eso deja dos
 * cuentas—, ni rendirse: es ir a mirar. Y si ni mirando se puede saber, se dice que no se sabe y se para.
 *
 * Nada de esto concede permisos. Tener una cuenta de anuncios no es tener autorización para gastar en ella.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioProvisionamiento } from './provisionamiento-pg';
import type {
  CapacidadProvisionamiento, EstadoSolicitud, PuertoProvisionamientoCuenta, SolicitudProvisionamiento,
} from './provisionamiento-tipos';

export interface DepsProvisionamiento {
  readonly puerto: PuertoProvisionamientoCuenta;
  readonly ahora?: () => string;
  readonly log?: (info: Record<string, unknown>) => void;
}

/** Espacio del cerrojo: distinto del de handoff para que dos cosas distintas no se bloqueen entre sí. */
const ESPACIO_CERROJO = 'soec:provisionamiento';

/** De la capacidad al estado en que queda la solicitud mientras nadie la ejecute. */
function estadoSegunCapacidad(c: CapacidadProvisionamiento): EstadoSolicitud {
  switch (c.estado) {
    case 'AUTOMATABLE': return 'READY';
    case 'HUMAN_PROVIDER_STEP_REQUIRED': return 'WAITING_HUMAN';
    case 'BLOCKED_EXTERNAL': return 'BLOCKED_EXTERNAL';
    default: return 'RETRY_LATER';
  }
}

export interface ResultadoEvaluacion {
  readonly capacidad: CapacidadProvisionamiento;
  /** `null` cuando faltan datos del negocio: no se registra una solicitud que no se podría cumplir. */
  readonly solicitud: SolicitudProvisionamiento | null;
}

export class ProvisionamientoService {
  private readonly repo: RepositorioProvisionamiento;
  private readonly negocios: RepositorioNegocios;

  constructor(private readonly pool: Pool, private readonly deps: DepsProvisionamiento) {
    this.repo = new RepositorioProvisionamiento(pool);
    this.negocios = new RepositorioNegocios(pool);
  }

  /**
   * ¿Qué permite el proveedor hoy? Deja constancia de la respuesta —incluido un «no se pudo preguntar»— para
   * que la decisión se pueda auditar después y para que la pantalla no tenga que volver a preguntarlo.
   */
  async evaluar(org: string, datos: { readonly nombre: string; readonly moneda: string; readonly zonaHoraria: string } | null): Promise<ResultadoEvaluacion> {
    const capacidad = await this.deps.puerto.inspeccionar(org);
    // Sin datos del negocio no se abre solicitud: una cuenta nace con moneda y zona horaria, y no se inventan.
    if (datos === null) return { capacidad, solicitud: null };

    const ahora = (this.deps.ahora ?? ((): string => new Date().toISOString()))();
    const existente = await this.repo.activa(org);
    if (existente !== null) {
      // Idempotente: la solicitud viva se actualiza, nunca se duplica.
      const s = await this.repo.cambiar(this.pool, org, existente.id, {
        capacidad: capacidad.estado, motivo: capacidad.motivo, detalle: capacidad.explicacion,
        // Una solicitud que ya está creando algo NO se retrocede por una evaluación posterior.
        ...(existente.estado === 'EXECUTING' ? {} : { estado: estadoSegunCapacidad(capacidad) }),
      });
      return { capacidad, solicitud: s };
    }

    const propuesta: SolicitudProvisionamiento = {
      id: `prov-${randomUUID().slice(0, 12)}`,
      organizationId: org,
      proveedor: 'GOOGLE_ADS',
      nombreDeseado: datos.nombre,
      moneda: datos.moneda,
      zonaHoraria: datos.zonaHoraria,
      capacidad: capacidad.estado,
      motivo: capacidad.motivo,
      referenciaProveedor: null,
      estado: estadoSegunCapacidad(capacidad),
      detalle: capacidad.explicacion,
      creadoEn: ahora,
      actualizadoEn: ahora,
      completadoEn: null,
    };
    const guardada = await this.enTransaccion(async (tx) => this.repo.abrirSiFalta(tx, propuesta));
    return { capacidad, solicitud: guardada };
  }

  /**
   * Intenta crear la cuenta. Con la bandera apagada —el default— el puerto responde `NO_INTENTADA` sin tocar
   * la red, así que esto es seguro de llamar desde un scheduler desde el primer día.
   */
  async intentar(org: string): Promise<SolicitudProvisionamiento | null> {
    const cerrojo = await this.tomarCerrojo(org);
    if (cerrojo === null) return this.repo.activa(org); // otro ya está en ello: no se crea nada dos veces
    try {
      const s = await this.repo.activa(org);
      if (s === null || s.estado !== 'READY') return s;

      // A partir de aquí la operación es externa: se marca ANTES para que un corte deje rastro de que se
      // intentó. Una fila en EXECUTING es exactamente la señal de «hay que reconciliar antes de repetir».
      await this.repo.cambiar(this.pool, org, s.id, { estado: 'EXECUTING', detalle: 'creando la cuenta en el proveedor' });
      const r = await this.deps.puerto.provisionar({ ...s, estado: 'EXECUTING' });

      switch (r.resultado) {
        case 'CREADA':
          return this.repo.cambiar(this.pool, org, s.id, { estado: 'COMPLETED', referenciaProveedor: r.customerId, detalle: 'cuenta creada' });
        case 'RECHAZADA_POR_PROVEEDOR':
          return this.repo.cambiar(this.pool, org, s.id, { estado: 'BLOCKED_EXTERNAL', detalle: r.detalle });
        case 'REINTENTAR':
          return this.repo.cambiar(this.pool, org, s.id, { estado: 'RETRY_LATER', detalle: r.detalle });
        case 'NO_INTENTADA':
          return this.repo.cambiar(this.pool, org, s.id, { estado: estadoSegunCapacidad({ ...await this.deps.puerto.inspeccionar(org) }), detalle: r.detalle });
        default:
          return this.reconciliar(org, { ...s, estado: 'EXECUTING' }, r.detalle);
      }
    } finally {
      await this.soltarCerrojo(cerrojo, org);
    }
  }

  /**
   * RECONCILIAR una respuesta incierta. Nunca reintenta la creación: va a mirar. Si la cuenta está, la adopta;
   * si no está y pudimos comprobarlo, vuelve a quedar lista; y si ni eso se puede saber, se dice y se para —
   * que es infinitamente mejor que dejarle a alguien dos cuentas de anuncios por no querer admitir una duda.
   */
  async reconciliar(org: string, solicitud: SolicitudProvisionamiento, detalle: string): Promise<SolicitudProvisionamiento | null> {
    const v = await this.deps.puerto.verificar(solicitud);
    if (v.verificacion === 'EXISTE') {
      this.deps.log?.({ provisionamiento: 'reconciliado', org, resultado: 'existia' });
      return this.repo.cambiar(this.pool, org, solicitud.id, {
        estado: 'COMPLETED', referenciaProveedor: v.customerId, detalle: 'la cuenta ya existía: se adoptó en vez de crear otra',
      });
    }
    if (v.verificacion === 'NO_EXISTE') {
      return this.repo.cambiar(this.pool, org, solicitud.id, { estado: 'READY', detalle: `${detalle}; se comprobó que la cuenta no existe` });
    }
    return this.repo.cambiar(this.pool, org, solicitud.id, {
      estado: 'BLOCKED_EXTERNAL', detalle: `resultado incierto y no verificable: ${detalle}`,
    });
  }

  /** Reconciliación de arranque: toda solicitud que quedó EXECUTING tras un corte se resuelve mirando. */
  async reconciliarPendientes(org: string): Promise<SolicitudProvisionamiento | null> {
    const s = await this.repo.activa(org);
    if (s === null || s.estado !== 'EXECUTING') return s;
    return this.reconciliar(org, s, 'quedó a medias tras un corte');
  }

  async activa(org: string): Promise<SolicitudProvisionamiento | null> {
    return this.repo.activa(org);
  }

  private async enTransaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
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

  private async tomarCerrojo(org: string): Promise<PoolClient | null> {
    const c = await this.pool.connect();
    try {
      const { rows } = await c.query('select pg_try_advisory_lock(hashtext($1), hashtext($2)) as tomado', [ESPACIO_CERROJO, org]);
      if (rows[0]?.tomado === true) return c;
      c.release();
      return null;
    } catch {
      c.release();
      return null;
    }
  }

  private async soltarCerrojo(c: PoolClient, org: string): Promise<void> {
    await c.query('select pg_advisory_unlock(hashtext($1), hashtext($2))', [ESPACIO_CERROJO, org]).catch(() => undefined);
    c.release();
  }
}
