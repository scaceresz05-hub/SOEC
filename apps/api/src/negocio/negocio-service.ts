/**
 * apps/api · NEGOCIO COMO DATO · caso de uso de alta y lectura.
 *
 * Crear una empresa es UNA transacción: organización, membresía del propietario, perfil comercial, postura
 * de gobierno segura y evento de auditoría. Si algo falla, no queda nada a medias — ni una organización
 * huérfana sin perfil, ni un perfil sin dueño.
 *
 * SEGURIDAD POR DEFECTO: toda empresa nace con TODO apagado (sin mutaciones externas, sin gasto autónomo,
 * sin pausa automática, sin ejecución de campañas) y en estado `DRAFT`. Crear una empresa no puede gastar.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { crearMembresia, crearOrganizacion, organizacionPorSlug, organizacionesDeUsuario, registrarAuditoria } from '@soec/identity/pg';
import { canonizarAliasLegado } from '../plataforma/identidad-organizacion';
import { RepositorioNegocios, type CambiosPerfil, type NegocioCompleto, type PerfilNegocio, type TipoCliente, type TipoNegocio } from './negocio-pg';

export class NegocioInvalidoError extends Error {}
export class NegocioDuplicadoError extends Error {}
export class NegocioNoEncontradoError extends Error {}

const TIPOS: ReadonlySet<string> = new Set(['CLINICA', 'SAAS', 'ECOMMERCE', 'SERVICIOS', 'LOCAL', 'OTRO']);
const CLIENTES: ReadonlySet<string> = new Set(['B2B', 'B2C', 'BOTH']);
const ESTADOS: ReadonlySet<string> = new Set(['DRAFT', 'CONFIGURING', 'READY', 'ACTIVE', 'SUSPENDED']);

export interface EntradaNuevoNegocio {
  readonly displayName: string;
  readonly businessType: string;
  readonly country: string;
  readonly currency: string;
  readonly timezone: string;
  readonly website?: string | null;
  readonly description?: string | null;
  readonly primaryObjective?: string | null;
  readonly legalName?: string | null;
  readonly language?: string;
  readonly customerType?: string;
}

/**
 * Slug de tenant a partir del nombre comercial. El nombre es del usuario y puede cambiar; el slug es la
 * clave de tenant y NO cambia. Lleva un sufijo aleatorio corto para que dos empresas con el mismo nombre no
 * colisionen y para que el identificador no sea adivinable a partir del nombre.
 */
export function slugDeNegocio(nombre: string, aleatorio: () => string = () => randomBytes(3).toString('hex')): string {
  const base = nombre
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return `${base.length >= 2 ? base : 'empresa'}-${aleatorio()}`;
}

function exigirTexto(v: unknown, campo: string, max = 200): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length === 0) throw new NegocioInvalidoError(`${campo} es obligatorio`);
  if (s.length > max) throw new NegocioInvalidoError(`${campo} excede ${max} caracteres`);
  return s;
}

/**
 * URL del sitio: se acepta vacía, pero si viene tiene que ser una dirección web de verdad. `new URL` sola no
 * basta: acepta `https://no-es-una-url` como válida. Se exige además un dominio con punto, para que un texto
 * escrito por error no quede guardado como si fuera el sitio de la empresa.
 */
function sitioValido(v: unknown): string | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/\s/.test(s)) throw new NegocioInvalidoError('sitio web inválido');
  let u: URL;
  try { u = new URL(s.startsWith('http') ? s : `https://${s}`); } catch { throw new NegocioInvalidoError('sitio web inválido'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new NegocioInvalidoError('sitio web inválido');
  const dominio = u.hostname;
  const esLocal = dominio === 'localhost';
  if (!esLocal && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(dominio)) throw new NegocioInvalidoError('sitio web inválido: falta el dominio');
  return u.toString();
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

export class NegocioService {
  private readonly repo: RepositorioNegocios;
  constructor(private readonly pool: Pool) {
    this.repo = new RepositorioNegocios(pool);
  }

  /**
   * ALTA COMPLETA en una transacción. Devuelve el negocio con su postura de gobierno. El usuario queda
   * OWNER: quien crea la empresa la administra, sin pasos posteriores.
   */
  async crear(userId: string, entrada: EntradaNuevoNegocio): Promise<NegocioCompleto> {
    const displayName = exigirTexto(entrada.displayName, 'nombre comercial', 120);
    const businessType = exigirTexto(entrada.businessType, 'tipo de negocio', 20).toUpperCase();
    if (!TIPOS.has(businessType)) throw new NegocioInvalidoError(`tipo de negocio desconocido: ${businessType}`);
    const country = exigirTexto(entrada.country, 'país', 2).toUpperCase();
    const currency = exigirTexto(entrada.currency, 'moneda', 3).toUpperCase();
    const timezone = exigirTexto(entrada.timezone, 'zona horaria', 64);
    const customerType = (entrada.customerType ?? 'B2C').toUpperCase();
    if (!CLIENTES.has(customerType)) throw new NegocioInvalidoError(`tipo de cliente desconocido: ${customerType}`);
    const website = sitioValido(entrada.website);

    // Slug libre: se reintenta con otro sufijo si colisiona (el sufijo es aleatorio, no un contador).
    let slug = slugDeNegocio(displayName);
    for (let i = 0; i < 5 && (await organizacionPorSlug(this.pool, slug)) !== null; i += 1) slug = slugDeNegocio(displayName);
    if ((await organizacionPorSlug(this.pool, slug)) !== null) throw new NegocioDuplicadoError('no se pudo asignar un identificador libre');

    await enTransaccion(this.pool, async (c) => {
      const org = await crearOrganizacion(c, slug, displayName, 'PILOT');
      await crearMembresia(c, userId, org.id, 'OWNER', 'ACTIVE');
      await registrarAuditoria(c, { organizationId: org.id, actorUserId: userId, action: 'organization.created', resourceType: 'organization', resourceId: org.id, result: 'SUCCESS', metadata: { slug, origen: 'business-as-data' } });
      await this.repo.insertarPerfil(c, {
        organizationId: slug,
        businessKey: randomUUID(), // identidad estable e independiente del nombre y del slug visible
        displayName,
        legalName: entrada.legalName?.trim() || null,
        businessType: businessType as TipoNegocio,
        description: entrada.description?.trim() || null,
        website,
        country, currency, timezone,
        language: (entrada.language ?? 'es').trim().toLowerCase().slice(0, 8),
        customerType: customerType as TipoCliente,
        primaryObjective: entrada.primaryObjective?.trim() || null,
        status: 'DRAFT', // nace en borrador: ACTIVE exige que el propietario complete lo que falta
        origen: 'UI',
      });
      // POSTURA SEGURA: todo apagado. Crear una empresa jamás puede producir gasto ni tocar una plataforma.
      await this.repo.insertarGobierno(c, { organizationId: slug, externalMutations: false, autonomousSpend: false, automaticSafetyPause: false, campaignExecution: false });
      await this.repo.registrarAuditoria(c, { organizationId: slug, actor: userId, action: 'BUSINESS_CREATED', changedFields: { displayName, businessType, country, currency, timezone } });
    });

    const creado = await this.repo.completo(slug);
    if (creado === null) throw new NegocioNoEncontradoError('el negocio no quedó persistido');
    return creado;
  }

  /** Lectura completa de UN negocio. La autorización la aplica la ruta: aquí no se decide quién puede ver. */
  async leer(org: string): Promise<NegocioCompleto> {
    const n = await this.repo.completo(org);
    if (n === null) throw new NegocioNoEncontradoError(org);
    return n;
  }

  /** Edición del perfil. La identidad (`organizationId`, `businessKey`) nunca se toca. */
  async actualizar(org: string, actor: string, cambios: CambiosPerfil): Promise<NegocioCompleto> {
    const limpios: CambiosPerfil = { ...cambios };
    if (limpios.businessType !== undefined && !TIPOS.has(String(limpios.businessType).toUpperCase())) throw new NegocioInvalidoError('tipo de negocio desconocido');
    if (limpios.customerType !== undefined && !CLIENTES.has(String(limpios.customerType).toUpperCase())) throw new NegocioInvalidoError('tipo de cliente desconocido');
    if (limpios.status !== undefined && !ESTADOS.has(String(limpios.status).toUpperCase())) throw new NegocioInvalidoError('estado desconocido');
    if (limpios.website !== undefined) (limpios as { website: string | null }).website = sitioValido(limpios.website);
    if (limpios.displayName !== undefined) (limpios as { displayName: string }).displayName = exigirTexto(limpios.displayName, 'nombre comercial', 120);

    const antes = await this.repo.perfil(org);
    if (antes === null) throw new NegocioNoEncontradoError(org);
    const actualizado = await this.repo.actualizarPerfil(org, limpios);
    if (actualizado === null) throw new NegocioNoEncontradoError(org);
    const cambiados = Object.fromEntries(Object.entries(limpios).filter(([, v]) => v !== undefined));
    const accion = limpios.status !== undefined && limpios.status !== antes.status ? 'BUSINESS_STATUS_CHANGED' : 'BUSINESS_UPDATED';
    await this.repo.registrarAuditoria(this.pool, { organizationId: org, actor, action: accion, changedFields: cambiados });
    return this.leer(org);
  }

  /**
   * Negocios que el usuario puede ver: los de sus membresías, nunca el catálogo completo.
   *
   * El slug de identidad puede ser un ALIAS histórico (`smileflow`) mientras el negocio está persistido con
   * su clave canónica (`org-smileflow`). Se canoniza igual que en el gateway; si no, una empresa migrada
   * desaparecería del listado de su propio dueño. Las empresas nuevas no tienen alias: slug y clave coinciden.
   */
  async listarDeUsuario(userId: string): Promise<readonly PerfilNegocio[]> {
    const orgs = await organizacionesDeUsuario(this.pool, userId);
    const slugs = orgs
      .filter((o) => o.organization.status === 'ACTIVE')
      .map((o) => canonizarAliasLegado(o.organization.slug) ?? o.organization.slug);
    return this.repo.perfilesDe([...new Set(slugs)]);
  }

  /** Descubrimiento para los runtimes: todas las organizaciones con negocio persistido. */
  async descubrirOperativos(): Promise<readonly PerfilNegocio[]> {
    return this.repo.listarTodos();
  }
}
