/**
 * Servicio de configuración de Negocio. Registra la identidad y el perfil comercial de una
 * organización piloto y la inscribe en el registro de organizaciones (`orgindice`) para el
 * selector dinámico. `modoEjecucion` siempre PILOT. Event-sourced.
 */
import { ActorId, type Attribution, type EventInput, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import {
  type Negocio,
  type PerfilComercial,
  EVENTOS_NEGOCIO,
  negocioStreamId,
  reconstruirNegocio,
} from '../domain/negocio';
import { EVENTOS_ORGINDICE, type EntradaOrg, type OrgIndice, orgIndiceStreamId, reconstruirOrgIndice } from '../domain/indices';
import { NegocioInvalidoError } from '../domain/errors';

export interface EntradaNegocio {
  readonly nombre: string;
  readonly descripcion: string;
  readonly industria: string;
  readonly pais: string;
  readonly moneda: string;
  readonly zonaHoraria: string;
}

export class NegocioConfigService {
  constructor(private readonly store: EventStore) {}

  private org(ctx: RequestContext): string {
    return String(ctx.organizationId);
  }

  /**
   * Contexto de SISTEMA para el registro global de organizaciones. El PgEventStore aísla toda
   * lectura por `organization_id`; el registro (lista de ids+nombres, como el catálogo) se
   * escribe y lee siempre bajo esta org reservada. Los DATOS de cada organización permanecen
   * en sus propios streams, estrictamente aislados.
   */
  private ctxRegistro(): RequestContext {
    const o = OrganizationId('_registro');
    return { organizationId: o, actor: ActorId('sistema'), scope: { organizationId: o, permissions: ['events:append', 'events:read'] }, correlationId: 'registro-organizaciones' };
  }

  cargar(ctx: RequestContext): Promise<Negocio> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, negocioStreamId(org)).then((e) => reconstruirNegocio(org, e));
  }

  /** Lista las organizaciones piloto registradas (registro global, contexto de sistema). */
  async listarOrganizaciones(_ctx?: RequestContext): Promise<OrgIndice> {
    const reg = this.ctxRegistro();
    return reconstruirOrgIndice(await this.store.readStream(reg, orgIndiceStreamId()));
  }

  /** Registra el negocio (idempotente) y lo inscribe en el registro de organizaciones. */
  async registrar(ctx: RequestContext, entrada: EntradaNegocio, a: Attribution, o: string): Promise<Negocio> {
    if (!entrada.nombre.trim()) throw new NegocioInvalidoError('el negocio requiere un nombre');
    const org = this.org(ctx);
    const existente = await this.cargar(ctx);
    if (!existente.existe) {
      const input: EventInput = {
        type: EVENTOS_NEGOCIO.registrado,
        payload: { nombre: entrada.nombre, descripcion: entrada.descripcion, industria: entrada.industria, pais: entrada.pais, moneda: entrada.moneda, zonaHoraria: entrada.zonaHoraria },
        attribution: a,
        occurredAt: o,
        idempotencyKey: `registrar:${negocioStreamId(org)}`,
      };
      await this.store.append(ctx, negocioStreamId(org), existente.version, [input]);
    }
    // La inscripción en el registro es SIEMPRE idempotente: garantiza que el negocio aparezca en
    // el índice aunque ya existiera (evita quedar fuera del selector por un registro previo).
    await this.registrarEnIndice(ctx, org, entrada.nombre, a, o);
    return this.cargar(ctx);
  }

  /** Actualiza el perfil comercial (problemas, propuesta de valor, faltantes, etc.). */
  async actualizarPerfil(ctx: RequestContext, perfil: PerfilComercial, a: Attribution, o: string): Promise<Negocio> {
    const n = await this.cargar(ctx);
    if (!n.existe) throw new NegocioInvalidoError('el negocio no existe; regístrelo primero');
    const input: EventInput = { type: EVENTOS_NEGOCIO.perfilActualizado, payload: perfil, attribution: a, occurredAt: o };
    await this.store.append(ctx, negocioStreamId(this.org(ctx)), n.version, [input]);
    return this.cargar(ctx);
  }

  private async registrarEnIndice(_ctx: RequestContext, org: string, nombre: string, a: Attribution, o: string): Promise<void> {
    // El registro global vive bajo el contexto de sistema (el store aísla lecturas por org).
    const reg = this.ctxRegistro();
    const idx = reconstruirOrgIndice(await this.store.readStream(reg, orgIndiceStreamId()));
    if (idx.organizaciones.some((x) => x.org === org)) return;
    const entrada: EntradaOrg = { org, nombre };
    const input: EventInput = { type: EVENTOS_ORGINDICE.registrada, payload: entrada, attribution: a, occurredAt: o };
    await this.store.append(reg, orgIndiceStreamId(), idx.version, [input]);
  }
}
