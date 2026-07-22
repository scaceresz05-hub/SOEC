/**
 * Servicio de organización piloto: registra la organización, conduce el onboarding
 * reanudable, define el perfil operacional/presupuesto/conexiones y acepta la política
 * inicial versionada. No exige datos reales; valida y conserva faltantes.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
import {
  type ConexionPrevista,
  type EstadoEtapa,
  type EstadoOrganizacion,
  type EtapaOnboarding,
  type IdentidadOrganizacion,
  type OrgState,
  type PerfilOperacional,
  type PresupuestoPiloto,
  EVENTOS_ORG,
  orgStreamId,
  reconstruirOrg,
  validarIdentidad,
} from '../domain/organizacion';
import { ComandoPilotoInvalidoError, OrganizacionNoEncontradaError } from '../domain/errors';

export class OrganizacionService {
  constructor(private readonly store: EventStore) {}

  cargar(ctx: RequestContext, orgId: string): Promise<OrgState> {
    return this.store.readStream(ctx, orgStreamId(orgId)).then((e) => reconstruirOrg(orgId, String(ctx.organizationId), e));
  }
  private input(type: string, payload: unknown, a: Attribution, o: string): EventInput {
    return { type, payload, attribution: a, occurredAt: o };
  }
  private async append(ctx: RequestContext, orgId: string, input: EventInput): Promise<OrgState> {
    const s = await this.cargar(ctx, orgId);
    await this.store.append(ctx, orgStreamId(orgId), s.version, [input]);
    return this.cargar(ctx, orgId);
  }

  async registrar(ctx: RequestContext, orgId: string, identidad: IdentidadOrganizacion, departamentos: string[], a: Attribution, o: string): Promise<OrgState> {
    const previo = await this.cargar(ctx, orgId);
    if (previo.existe) return previo; // idempotente
    const faltantes = validarIdentidad(identidad);
    if (faltantes.length > 0) throw new ComandoPilotoInvalidoError(`Identidad incompleta: faltan ${faltantes.join(', ')}`);
    await this.store.append(ctx, orgStreamId(orgId), previo.version, [this.input(EVENTOS_ORG.registrada, { identidad, departamentos }, a, o)]);
    return this.cargar(ctx, orgId);
  }

  async actualizarEtapa(ctx: RequestContext, orgId: string, etapa: EtapaOnboarding, estado: EstadoEtapa, datos: Record<string, string>, faltantes: string[], responsable: string, a: Attribution, o: string): Promise<OrgState> {
    if (!(await this.cargar(ctx, orgId)).existe) throw new OrganizacionNoEncontradaError(`La organización '${orgId}' no existe`);
    return this.append(ctx, orgId, this.input(EVENTOS_ORG.etapa, { etapa, estado, datos, faltantes, responsable }, a, o));
  }
  definirPerfil(ctx: RequestContext, orgId: string, perfil: PerfilOperacional, a: Attribution, o: string): Promise<OrgState> {
    return this.append(ctx, orgId, this.input(EVENTOS_ORG.perfil, { perfil }, a, o));
  }
  definirPresupuesto(ctx: RequestContext, orgId: string, presupuesto: PresupuestoPiloto, a: Attribution, o: string): Promise<OrgState> {
    return this.append(ctx, orgId, this.input(EVENTOS_ORG.presupuesto, { presupuesto }, a, o));
  }
  declararConexion(ctx: RequestContext, orgId: string, conexion: ConexionPrevista, a: Attribution, o: string): Promise<OrgState> {
    return this.append(ctx, orgId, this.input(EVENTOS_ORG.conexion, { conexion }, a, o));
  }
  aceptarPolitica(ctx: RequestContext, orgId: string, version: number, a: Attribution, o: string): Promise<OrgState> {
    return this.append(ctx, orgId, this.input(EVENTOS_ORG.politicaAceptada, { version }, a, o));
  }
  transicionar(ctx: RequestContext, orgId: string, nuevoEstado: EstadoOrganizacion, a: Attribution, o: string): Promise<OrgState> {
    return this.append(ctx, orgId, this.input(EVENTOS_ORG.transicion, { nuevoEstado }, a, o));
  }
}
