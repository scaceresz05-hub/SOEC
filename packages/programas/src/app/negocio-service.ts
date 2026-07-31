/**
 * Servicio de configuración de Negocio. Registra la identidad y el perfil comercial de una
 * organización piloto y la inscribe en el registro de organizaciones (`orgindice`) para el
 * selector dinámico. `modoEjecucion` siempre PILOT. Event-sourced.
 */
import type { Attribution, EventInput, EventStore, RequestContext } from '@soec/contracts';
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

  cargar(ctx: RequestContext): Promise<Negocio> {
    const org = this.org(ctx);
    return this.store.readStream(ctx, negocioStreamId(org)).then((e) => reconstruirNegocio(org, e));
  }

  /** Lista las organizaciones piloto registradas (registro global). */
  async listarOrganizaciones(ctx: RequestContext): Promise<OrgIndice> {
    return reconstruirOrgIndice(await this.store.readStream(ctx, orgIndiceStreamId()));
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
      await this.registrarEnIndice(ctx, org, entrada.nombre, a, o);
    }
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

  private async registrarEnIndice(ctx: RequestContext, org: string, nombre: string, a: Attribution, o: string): Promise<void> {
    const idx = reconstruirOrgIndice(await this.store.readStream(ctx, orgIndiceStreamId()));
    if (idx.organizaciones.some((x) => x.org === org)) return;
    const entrada: EntradaOrg = { org, nombre };
    const input: EventInput = { type: EVENTOS_ORGINDICE.registrada, payload: entrada, attribution: a, occurredAt: o };
    await this.store.append(ctx, orgIndiceStreamId(), idx.version, [input]);
  }
}
