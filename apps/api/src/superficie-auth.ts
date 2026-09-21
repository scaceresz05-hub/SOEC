/**
 * Helpers de autorización para la superficie vertical AUTENTICADA (Macrobloque 3). Las rutas se registran
 * DENTRO del gateway (`guardarVerticales`), que ya validó sesión + membresía e inyectó el contexto
 * AUTORITATIVO server-side en `x-organization-id`/`x-actor-id`/`x-scope`/`x-permissions`. Aquí sólo se
 * lee ese contexto y se exige el permiso atómico fino. La organización NUNCA viene de la URL/body.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import { SinPermisoError, type Permission } from '@soec/identity';

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Contexto autenticado (org/actor/scope) desde las cabeceras autoritativas que inyectó el gateway. */
export function contextoDe(req: FastifyRequest): RequestContext {
  const org = header(req, 'x-organization-id');
  const actor = header(req, 'x-actor-id');
  if (!org || !actor) throw new SinPermisoError('contexto de organización ausente');
  const organizationId = OrganizationId(org);
  const permissions = (header(req, 'x-scope') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { organizationId, actor: ActorId(actor), scope: { organizationId, permissions }, correlationId: header(req, 'x-correlation-id') ?? randomUUID() };
}

/** Permisos comerciales EFECTIVOS del rol (autoritativos). Vacío ⇒ sin autorización. */
export function permisosDe(req: FastifyRequest): ReadonlySet<string> {
  return new Set((header(req, 'x-permissions') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

/** Modo operativo AUTORITATIVO de la organización autenticada (inyectado por el gateway). null si ausente. */
export function modoOperativoDe(req: FastifyRequest): string | null {
  const v = header(req, 'x-operational-mode');
  return v && v.trim() ? v.trim() : null;
}

/**
 * AUTORIDAD DE TENANT: la organización sobre la que se opera es la del CONTEXTO AUTENTICADO, nunca la que
 * llegue en la URL o el cuerpo. Compara ambas y lanza (→ 403) si no coinciden.
 *
 * `demoSinAuth` sólo se usa en la superficie DEMO LEGACY (sin gateway, prohibida en producción): allí no hay
 * cabeceras que comparar y el llamador ya declaró que esa superficie corre sin autenticación. Con gateway, la
 * ausencia de contexto es siempre un 403: nunca se interpreta como permiso.
 */
export function exigirOrganizacion(req: FastifyRequest, orgPedida: string, opts: { readonly demoSinAuth?: boolean } = {}): void {
  const org = header(req, 'x-organization-id');
  if (!org) {
    if (opts.demoSinAuth === true) return;
    throw new SinPermisoError('contexto de organización ausente');
  }
  if (org !== orgPedida) throw new SinPermisoError('ORGANIZACION_AJENA: la organización pedida no es la del contexto autenticado');
}

/** Exige un permiso atómico del modelo canónico; lanza SinPermisoError (→ 403) si falta. */
export function exigir(req: FastifyRequest, permiso: Permission): void {
  if (!permisosDe(req).has(permiso)) throw new SinPermisoError(`falta el permiso ${permiso}`);
}
