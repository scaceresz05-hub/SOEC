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

/** Exige un permiso atómico del modelo canónico; lanza SinPermisoError (→ 403) si falta. */
export function exigir(req: FastifyRequest, permiso: Permission): void {
  if (!permisosDe(req).has(permiso)) throw new SinPermisoError(`falta el permiso ${permiso}`);
}
