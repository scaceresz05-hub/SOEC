/** Helpers de prueba para @soec/adaptadores (M4-C-A-H). No es una suite. */
import { ActorId, OrganizationId, type RequestContext } from '@soec/contracts';
import type { CapacidadState, PoliticaDegradacion, SaludCapacidad, EstadoCapacidad } from '@soec/plataforma-capacidades';
import type { SolicitudAdaptador } from '../src/index';

export const O = '2026-08-02T00:00:00.000Z';

export const ctx = (org = 'org-a', requestId = 'req-1'): RequestContext => {
  const o = OrganizationId(org);
  return { organizationId: o, actor: ActorId('sistema'), scope: { organizationId: o, permissions: ['events:read'] }, correlationId: requestId };
};

export const solicitud = (over: Partial<SolicitudAdaptador> = {}): SolicitudAdaptador => ({
  solicitudId: 'sol-1',
  capacidadId: 'gen',
  peticion: { operacion: 'generar', parametros: { a: '1' } },
  ...over,
});

/** CapacidadState por defecto: consumible (EN_USO + SALUDABLE, org-a/gen). */
export const cap = (over: Partial<CapacidadState> = {}): CapacidadState => ({
  organizationId: 'org-a',
  capacidadId: 'gen',
  tipo: 'generacion',
  version: 5,
  existe: true,
  estado: 'EN_USO' as EstadoCapacidad,
  modo: 'REAL',
  salud: 'SALUDABLE' as SaludCapacidad,
  politicaDegradacion: 'SIMULAR' as PoliticaDegradacion,
  proveedorRef: 'proveedor-logico',
  secretRef: 'env:GEN',
  alternativaCapacidadId: null,
  cacheRef: null,
  configVersion: 3,
  reemplazadaPor: null,
  terminada: false,
  ...over,
});

export const frontHabilitado = { activacion: 'ACTIVADO', modo: 'REAL', credencial: 'CON_CREDENCIAL', consumo: 'CONSUMIBLE', secretRef: 'env:GEN' } as const;
