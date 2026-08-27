/**
 * Gateway autenticado de la superficie vertical/experiencia (CUTOVER Macrobloque 1).
 *
 * En condiciones normales (hay `pool` y la demo legacy está deshabilitada), toda la superficie
 * vertical se registra DENTRO de este gateway, que:
 *   1. Exige sesión válida (sin sesión ⇒ 401). La ausencia de sesión nunca es autorización.
 *   2. Exige membresía activa en la organización indicada (`x-organization-slug`); si no es miembro
 *      ⇒ 404 (no filtra existencia). El `:org`/header del cliente NO autoriza por sí mismo: se
 *      valida contra la membresía derivada de la sesión.
 *   3. Inyecta contexto AUTORITATIVO server-side sobre las cabeceras que consumen las rutas
 *      header-driven (`x-organization-id`, `x-actor-id`, `x-scope`), derivando el alcance del rol.
 *      Los valores que envíe el cliente para esas cabeceras se descartan.
 *
 * Nota honesta de alcance: las experiencias que construyen contexto sintético server-side siguen
 * operando sobre datos de demostración; el gateway garantiza la SEGURIDAD (autenticación +
 * membresía) de toda la superficie, pero la vinculación tenant-a-tenant por cada experiencia es
 * trabajo posterior. La confianza-en-cabeceras sin autenticar existe únicamente bajo el flag legacy.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireUser } from './auth-context';
import type { ContextoOrg, IdentityService, Permission } from '@soec/identity';
import { EntradaInvalidaError } from '@soec/identity';
import { canonizarAliasLegado } from './plataforma/identidad-organizacion';

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Permisos que habilitan escritura de eventos (mutación). Los roles de solo lectura no los tienen. */
const PERMISOS_ESCRITURA: ReadonlySet<Permission> = new Set<Permission>([
  'organization.manage',
  'members.invite',
  'members.manage',
  'business.manage',
  'program.manage',
  'campaign.manage',
  'content.review',
  'content.approve',
  'budget.manage',
  'execution.approve',
  'operational_mode.manage',
]);

/** Deriva el alcance del event-store desde los permisos del rol. Lectura siempre; escritura si aplica. */
export function scopeEventStore(permisos: ReadonlySet<Permission>): string[] {
  const scope = ['events:read'];
  for (const p of PERMISOS_ESCRITURA) {
    if (permisos.has(p)) {
      scope.push('events:append');
      break;
    }
  }
  return scope;
}

/**
 * preHandler del gateway: resuelve sesión + membresía e inyecta contexto autoritativo. Lanza
 * NoAutenticadoError (401) sin sesión, EntradaInvalidaError (400) si falta la organización y
 * NoEncontradoError (404) si el usuario no es miembro activo de la organización indicada.
 */
export function guardarVerticales(identity: IdentityService) {
  return async (req: FastifyRequest): Promise<void> => {
    const user = await requireUser(identity, req); // 401 si no hay sesión
    const slug = header(req, 'x-organization-slug') ?? header(req, 'x-organization-id');
    if (!slug || !slug.trim()) throw new EntradaInvalidaError('falta la organización (x-organization-slug)');
    const ctx: ContextoOrg = await identity.resolverContextoOrganizacion(user, slug.trim()); // 404 si no es miembro
    // Contexto AUTORITATIVO: se sobreescriben las cabeceras que leen las rutas header-driven.
    // CANONIZACIÓN de alias legado (post-validación de membresía, seguro): el slug de identidad puede ser un
    // alias histórico (p. ej. 'smileflow') mientras el tenant canónico del registro/event-store es 'org-smileflow'.
    // Sin esto, getBusiness(slug) devolvía 404 ⇒ negocio=null. Sólo remapea aliases conocidos; si el slug ya es
    // canónico, pasa sin cambios. La membresía ya fue validada arriba: esto no acepta un alias sin autenticar.
    req.headers['x-organization-id'] = canonizarAliasLegado(ctx.organization.slug) ?? ctx.organization.slug;
    req.headers['x-actor-id'] = ctx.user.id;
    req.headers['x-scope'] = scopeEventStore(ctx.permisos).join(',');
    // Modo operativo AUTORITATIVO de la organización (fuente única del gate supervisedReal del executor). Se
    // deriva de la membresía validada, NUNCA del payload; lo que envíe el cliente se descarta (se sobreescribe).
    req.headers['x-operational-mode'] = String(ctx.organization.operationalMode ?? '');
    // Permisos comerciales EFECTIVOS del rol, para autorización fina de las rutas que la exijan
    // (p. ej. la superficie de generación). Autoritativo: lo que envíe el cliente se descarta.
    req.headers['x-permissions'] = [...ctx.permisos].join(',');
  };
}

/**
 * Registra la superficie vertical dentro de un ámbito encapsulado protegido por el gateway.
 * `registrarSuperficie` recibe el ámbito (plugin) y añade todas las rutas verticales sobre él.
 */
export function registrarVerticalesAutenticadas(
  app: FastifyInstance,
  identity: IdentityService,
  registrarSuperficie: (scope: FastifyInstance) => void,
): void {
  app.register(async (scope) => {
    scope.addHook('preHandler', guardarVerticales(identity));
    registrarSuperficie(scope);
  });
}
