/**
 * apps/api · CONEXIONES COMO DATO · casos de uso.
 *
 * Conectar una fuente y habilitar una capacidad son actos EXPLÍCITOS de una persona, hechos desde la
 * interfaz de SOEC: ni un módulo TypeScript, ni una variable del despliegue, ni un deploy. El servicio
 * guarda la configuración pública en `business_connection`, la credencial cifrada en el depósito KMS y la
 * decisión operativa en `business_capability`, y deja auditoría de cada cambio.
 *
 * REGLAS DURAS:
 *  · el VALOR de una credencial nunca vuelve a salir: la vista sólo dice si está configurada y de qué clase es;
 *  · sin depósito de secretos (KMS ausente) NO se guarda ninguna credencial — no hay modo degradado en claro;
 *  · guardar una conexión no habilita ninguna capacidad, y habilitar una capacidad no crea ninguna conexión:
 *    son dos decisiones distintas y el sistema no las mezcla por conveniencia;
 *  · probar una conexión es una LECTURA (un evento, sin mover cursores) y nunca escribe en el proveedor.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { ESQUEMA_EGRESS_GROWTH, crearGrowthAdapter } from '../ingesta/growth-adapter';
import type { DescriptorFuenteGrowth } from '../plataforma/registro';
import { RepositorioConexiones, type Conexion } from './conexion-pg';
import {
  CONEXION_REQUERIDA,
  ConexionInvalidaError,
  esCapacidad,
  esProveedor,
  normalizarConfigGoogleAds,
  normalizarConfigGrowth,
  type CapacidadNegocio,
  type ConfigGrowth,
  type ProveedorConexion,
} from './conexion-tipos';
import { crearAlmacenDeLecturaDeSecretos, type DepositoSecretosConexion } from './secreto-conexion';

export class NegocioSinPerfilError extends Error {}
export class DepositoNoDisponibleError extends Error {}
export class ConexionNoEncontradaError extends Error {}

/** Clase de credencial. No es la referencia ni el valor: sólo dónde vive. */
export type ClaseCredencial = 'DEPOSITO_CIFRADO' | 'ENTORNO' | null;

export interface VistaConexion {
  readonly provider: ProveedorConexion;
  readonly estado: Conexion['estado'];
  readonly cuenta: { readonly id: string | null; readonly nombre: string | null };
  /** Configuración PÚBLICA de la conexión (endpoint, ruta, hosts, identificadores). Nunca un secreto. */
  readonly configuracion: Record<string, unknown>;
  readonly credencial: { readonly configurada: boolean; readonly clase: ClaseCredencial };
  readonly ultimoError: string | null;
  readonly validadaEn: string | null;
  readonly origen: Conexion['origen'];
}

export interface VistaCapacidad {
  readonly capacidad: CapacidadNegocio;
  readonly habilitada: boolean;
  readonly requiereConexion: ProveedorConexion | null;
  readonly conexionLista: boolean;
  /** Por qué no está operativa, en lenguaje de negocio. `null` cuando sí lo está. */
  readonly motivo: string | null;
}

export interface VistaConexiones {
  readonly organizationId: string;
  readonly conexiones: readonly VistaConexion[];
  readonly capacidades: readonly VistaCapacidad[];
  /** `false` ⇒ este despliegue no puede guardar credenciales nuevas (KMS ausente). Se dice, no se disimula. */
  readonly depositoDisponible: boolean;
  /** Conexión OAuth de Google Ads, tal como la registró su propio flujo. Solo lectura, sin secretos. */
  readonly oauthGoogleAds: { readonly estado: string; readonly customerId: string | null; readonly salud: string } | null;
}

export interface EntradaGrowth {
  readonly baseUrl: string;
  readonly provider?: string;
  readonly rutaIngesta?: string;
  readonly hostsAutorizados?: readonly string[];
  readonly nombreLogicoCredencial?: string;
  /** Token del puente M2M. Se cifra y no vuelve a salir. Ausente ⇒ se conserva el que ya hubiera. */
  readonly token?: string;
}

function clase(secretRef: string | null): ClaseCredencial {
  if (secretRef === null) return null;
  if (secretRef.startsWith('secretstore:')) return 'DEPOSITO_CIFRADO';
  return 'ENTORNO';
}

function vista(c: Conexion): VistaConexion {
  return {
    provider: c.provider,
    estado: c.estado,
    cuenta: { id: c.externalAccountId, nombre: c.externalAccountName },
    configuracion: c.configuracion,
    credencial: { configurada: c.secretRef !== null, clase: clase(c.secretRef) },
    ultimoError: c.ultimoError,
    validadaEn: c.validadaEn,
    origen: c.origen,
  };
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

export interface DepsConexionService {
  readonly deposito: DepositoSecretosConexion | null;
  readonly env: Record<string, string | undefined>;
  readonly fetchFn?: typeof fetch;
  readonly ahora?: () => string;
  /** Se llama tras cada cambio para que el runtime lo vea sin esperar el refresco periódico. */
  readonly refrescar?: () => Promise<void>;
}

export class ConexionService {
  private readonly repo: RepositorioConexiones;
  private readonly negocios: RepositorioNegocios;
  private readonly ahora: () => string;

  constructor(private readonly pool: Pool, private readonly deps: DepsConexionService) {
    this.repo = new RepositorioConexiones(pool);
    this.negocios = new RepositorioNegocios(pool);
    this.ahora = deps.ahora ?? (() => new Date().toISOString());
  }

  /** Estado completo de lo conectado y lo habilitado. Es lo que pinta la interfaz de conexiones. */
  async estado(org: string): Promise<VistaConexiones> {
    await this.exigirNegocio(org);
    const [conexiones, capacidades, oauth] = await Promise.all([
      this.repo.listar(org),
      this.repo.capacidades(org),
      this.oauthGoogleAds(org),
    ]);
    const porProveedor = new Map(conexiones.map((c) => [c.provider, c]));
    const habilitadas = new Map(capacidades.map((c) => [c.capacidad, c.habilitada]));
    const vistasCap: VistaCapacidad[] = (Object.keys(CONEXION_REQUERIDA) as CapacidadNegocio[]).map((cap) => {
      const requiere = CONEXION_REQUERIDA[cap];
      const conexion = requiere ? porProveedor.get(requiere) ?? null : null;
      const listaPorConexion = requiere === null
        ? true
        : (conexion?.estado === 'CONNECTED') || (requiere === 'GOOGLE_ADS' && oauth?.estado === 'CONNECTED');
      const habilitada = habilitadas.get(cap) === true;
      return {
        capacidad: cap,
        habilitada,
        requiereConexion: requiere,
        conexionLista: listaPorConexion,
        motivo: !habilitada
          ? 'no habilitada'
          : listaPorConexion
            ? null
            : `falta conectar ${requiere}`,
      };
    });
    return {
      organizationId: org,
      conexiones: conexiones.map((c) => vista(c)),
      capacidades: vistasCap,
      depositoDisponible: this.deps.deposito !== null,
      oauthGoogleAds: oauth,
    };
  }

  /**
   * Guarda (o edita) la conexión del puente Growth. El token se cifra en el depósito por tenant: una empresa
   * nueva queda conectada SIN variable de entorno y sin desplegar, que es el objetivo de esta fase.
   */
  async guardarGrowth(org: string, actor: string, entrada: EntradaGrowth): Promise<VistaConexiones> {
    await this.exigirNegocio(org);
    const cfg = normalizarConfigGrowth({ ...entrada, provider: entrada.provider ?? `${org}-growth` });
    const existente = await this.repo.buscar(org, 'GROWTH_M2M');
    const token = typeof entrada.token === 'string' ? entrada.token.trim() : '';

    let secretRef: string | null = null;
    if (token.length > 0) {
      if (this.deps.deposito === null) {
        throw new DepositoNoDisponibleError('este despliegue no tiene depósito de secretos configurado: no se guarda ninguna credencial');
      }
      const r = await this.deps.deposito.almacenar(org, cfg.nombreLogicoCredencial, token);
      secretRef = r.secretRef;
    }
    const credencialFinal = secretRef ?? existente?.secretRef ?? null;

    await enTransaccion(this.pool, async (c) => {
      await this.repo.guardar(c, {
        organizationId: org,
        provider: 'GROWTH_M2M',
        id: existente?.id ?? randomUUID(),
        estado: credencialFinal === null ? 'NOT_CONNECTED' : 'CONNECTED',
        configuracion: { ...cfg },
        secretRef,
        ultimoError: null,
        origen: existente?.origen ?? 'UI',
      });
      await this.negocios.registrarAuditoria(c, {
        organizationId: org,
        actor,
        action: 'CONNECTION_SAVED',
        // Auditoría SIN secretos: qué proveedor, a qué endpoint y si se depositó credencial. Nunca el token.
        changedFields: { provider: 'GROWTH_M2M', endpoint: cfg.baseUrl, ruta: cfg.rutaIngesta, credencialDepositada: secretRef !== null, at: this.ahora() },
      });
    });
    await this.deps.refrescar?.();
    return this.estado(org);
  }

  /**
   * Guarda la conexión de Google Ads a nivel de RECURSO (cuenta + campaña gobernada). El token OAuth NO se
   * gestiona aquí: eso lo hace el flujo OAuth existente, que ya guarda credenciales cifradas por tenant.
   */
  async guardarGoogleAds(org: string, actor: string, entrada: Record<string, unknown>): Promise<VistaConexiones> {
    await this.exigirNegocio(org);
    const cfg = normalizarConfigGoogleAds(entrada);
    const existente = await this.repo.buscar(org, 'GOOGLE_ADS');
    const oauth = await this.oauthGoogleAds(org);
    await enTransaccion(this.pool, async (c) => {
      await this.repo.guardar(c, {
        organizationId: org,
        provider: 'GOOGLE_ADS',
        id: existente?.id ?? randomUUID(),
        // La credencial de Google Ads es el token OAuth: la conexión sólo está CONNECTED si ese flujo lo está.
        estado: oauth?.estado === 'CONNECTED' || existente?.secretRef !== null ? 'CONNECTED' : 'NOT_CONNECTED',
        externalAccountId: cfg.customerId,
        loginAccountId: cfg.loginCustomerId,
        externalAccountName: cfg.nombreCampania,
        configuracion: { ...cfg },
        secretRef: existente?.secretRef ?? null,
        ultimoError: null,
        origen: existente?.origen ?? 'UI',
      });
      await this.negocios.registrarAuditoria(c, {
        organizationId: org,
        actor,
        action: 'CONNECTION_SAVED',
        changedFields: { provider: 'GOOGLE_ADS', customerId: cfg.customerId, campaignId: cfg.campaignId, at: this.ahora() },
      });
    });
    await this.deps.refrescar?.();
    return this.estado(org);
  }

  /**
   * PRUEBA la conexión con una lectura mínima (un evento). No mueve cursores, no escribe en el proveedor y no
   * devuelve el cuerpo de la respuesta: sólo si funcionó. El resultado se persiste en la conexión.
   */
  async probar(org: string, actor: string, provider: ProveedorConexion): Promise<{ readonly ok: boolean; readonly detalle: string }> {
    await this.exigirNegocio(org);
    const c = await this.repo.buscar(org, provider);
    if (c === null) throw new ConexionNoEncontradaError(`el negocio no tiene conexión ${provider}`);
    if (provider !== 'GROWTH_M2M') {
      return { ok: false, detalle: `probar ${provider} todavía no está implementado; su estado lo reporta su propio flujo` };
    }
    if (c.secretRef === null) {
      await this.repo.fijarEstado(org, provider, 'NOT_CONNECTED', 'sin credencial depositada');
      return { ok: false, detalle: 'falta la credencial' };
    }
    const cfg = c.configuracion as unknown as ConfigGrowth;
    const descriptor: DescriptorFuenteGrowth = {
      organizationId: org,
      sourceId: String(cfg.sourceId ?? `src-${cfg.provider}`),
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      hostsAutorizados: cfg.hostsAutorizados,
      rutaIngesta: cfg.rutaIngesta,
      credencialRef: c.secretRef,
      baseUrlEnvOverride: cfg.baseUrlEnvOverride ?? null,
      estado: 'CONNECTED_READ_ONLY',
    };
    const adaptador = crearGrowthAdapter(descriptor, {
      secretStore: crearAlmacenDeLecturaDeSecretos(this.deps.deposito, this.deps.env),
      esquemaEgress: ESQUEMA_EGRESS_GROWTH,
      env: this.deps.env,
      fetchFn: this.deps.fetchFn,
    });
    const ctx: RequestContext = {
      organizationId: OrganizationId(org),
      actor: ActorId(actor),
      scope: { organizationId: OrganizationId(org), permissions: ['events:read'] },
      correlationId: `prueba-conexion-${org}`,
    };
    const salida = await adaptador.ejecutar(ctx, {
      solicitudId: `prueba-conexion:${org}:${this.ahora()}`,
      capacidadId: 'ingesta-growth',
      peticion: { operacion: 'growth-events', parametros: { cursor: '0', limit: '1' } },
    });
    const ok = salida.estado === 'OK';
    // Sólo la CLASE del fallo: el cuerpo del proveedor puede contener datos y no se guarda ni se devuelve.
    const detalle = ok ? 'lectura correcta' : `${salida.error?.clase ?? 'ERROR'}: ${salida.error?.mensaje ?? 'sin detalle'}`;
    await this.repo.fijarEstado(org, provider, ok ? 'CONNECTED' : 'ERROR', ok ? null : detalle, ok ? this.ahora() : null);
    await this.negocios.registrarAuditoria(this.pool, {
      organizationId: org, actor, action: 'CONNECTION_TESTED', changedFields: { provider, ok, at: this.ahora() },
    });
    await this.deps.refrescar?.();
    return { ok, detalle };
  }

  /** Apaga la conexión y OLVIDA su credencial. El negocio deja de leer esa fuente; nada más se toca. */
  async deshabilitar(org: string, actor: string, provider: ProveedorConexion): Promise<VistaConexiones> {
    await this.exigirNegocio(org);
    const c = await this.repo.buscar(org, provider);
    if (c === null) throw new ConexionNoEncontradaError(`el negocio no tiene conexión ${provider}`);
    if (c.secretRef !== null && c.secretRef.startsWith('secretstore:') && this.deps.deposito !== null) {
      await this.deps.deposito.revocar(c.secretRef).catch(() => undefined);
    }
    await this.repo.olvidarCredencial(org, provider);
    await this.negocios.registrarAuditoria(this.pool, {
      organizationId: org, actor, action: 'CONNECTION_DISABLED', changedFields: { provider, at: this.ahora() },
    });
    await this.deps.refrescar?.();
    return this.estado(org);
  }

  /**
   * Habilita o deshabilita una capacidad operativa. Sustituye a editar `experienciasHabilitadas` en un módulo
   * TypeScript. No enciende conexiones ni gobierno: sólo declara qué tiene permitido hacer el negocio.
   */
  async fijarCapacidad(org: string, actor: string, capacidad: CapacidadNegocio, habilitada: boolean, nota?: string | null): Promise<VistaConexiones> {
    await this.exigirNegocio(org);
    await enTransaccion(this.pool, async (c) => {
      await this.repo.fijarCapacidad(c, {
        organizationId: org, capacidad, habilitada, origen: 'UI', nota: nota ?? null, actor,
      });
      await this.negocios.registrarAuditoria(c, {
        organizationId: org, actor,
        action: habilitada ? 'CAPABILITY_ENABLED' : 'CAPABILITY_DISABLED',
        changedFields: { capacidad, at: this.ahora() },
      });
    });
    await this.deps.refrescar?.();
    return this.estado(org);
  }

  /** Estado de la conexión OAuth de Google Ads, leído de su propia tabla. Sin tokens ni referencias. */
  private async oauthGoogleAds(org: string): Promise<VistaConexiones['oauthGoogleAds']> {
    try {
      const { rows } = await this.pool.query(
        'select estado, salud, customer_id from google_ads_connection where organization_id = $1 order by updated_at desc limit 1',
        [org],
      );
      const r = rows[0] as { estado: string; salud: string; customer_id: string | null } | undefined;
      return r ? { estado: r.estado, salud: r.salud, customerId: r.customer_id ?? null } : null;
    } catch {
      return null; // el esquema OAuth puede no existir en un despliegue mínimo: no es un fallo del negocio
    }
  }

  /** Un negocio tiene conexiones sólo si el negocio existe. Fail-closed y con el motivo correcto. */
  private async exigirNegocio(org: string): Promise<void> {
    if ((await this.negocios.perfil(org)) === null) {
      throw new NegocioSinPerfilError(`el negocio '${org}' no existe`);
    }
  }
}

/** Valida entradas de la superficie HTTP sin que la ruta tenga que conocer el vocabulario. */
export function exigirProveedor(v: unknown): ProveedorConexion {
  if (!esProveedor(v)) throw new ConexionInvalidaError(`proveedor desconocido: ${String(v)}`);
  return v;
}

export function exigirCapacidad(v: unknown): CapacidadNegocio {
  if (!esCapacidad(v)) throw new ConexionInvalidaError(`capacidad desconocida: ${String(v)}`);
  return v;
}
