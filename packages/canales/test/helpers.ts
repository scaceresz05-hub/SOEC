import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';
import { ObjectiveService, PlanningService } from '@soec/marketing';
import {
  ContentService,
  MarcaService,
  PromptService,
  ProveedorGenerativoDeterminista,
} from '@soec/contenido';
import {
  CONT_GANCHOS,
  IDS_CONT,
  IDS_MKT_CONT,
  marcaDemo,
  objetivoContenidoDemo,
  optsContenidoDemo,
  politicaContenidoDemo,
  promptAdaptDemo,
  promptPiezaDemo,
} from '@soec/contenido';
import {
  AdaptadorCanalSimulado,
  FixtureCredentialProvider,
  PublicationService,
  WebhookService,
  type AdaptadorCanal,
} from '../src';
import { IDS_CHAN, CANALES_PILOTO } from '../src/fixtures';

export const attr: Attribution = {
  source: 'plano-canales-test',
  purpose: 'publicar en un proveedor emulado; ningún efecto público real',
  assumptions: ['proveedor emulado/simulado; sin credenciales reales'],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};
export const now = '2026-07-21T09:00:00.000Z';
export const ORG = IDS_CHAN.org;
export { IDS_CHAN, IDS_MKT_CONT, CANALES_PILOTO };

export function ctxFor(org: string = ORG, permissions: string[] = ['events:append', 'events:read']): RequestContext {
  const organizationId = OrganizationId(org);
  return { organizationId, actor: ActorId('soec'), scope: { organizationId, permissions }, correlationId: `corr-${org}` };
}

export function montar(store: EventStore = new InMemoryEventStore(), sandbox?: AdaptadorCanal) {
  const operational = new OperationalService(store, [new AdaptadorSimulado()]);
  const planning = new PlanningService(store, operational);
  const content = new ContentService(store, new ProveedorGenerativoDeterminista(), planning);
  const credenciales = new FixtureCredentialProvider();
  credenciales.registrarTodosLosCanales(ORG, IDS_CHAN.cuentaLogica, IDS_CHAN.credencialId, ['blog', 'linkedin', 'instagram', 'correo', 'meta_ads', 'facebook']);
  const simulado = new AdaptadorCanalSimulado();
  const adaptadores = { simulado, sandbox: sandbox ?? simulado };
  const publicaciones = new PublicationService(store, adaptadores, credenciales, content);
  return {
    store,
    operational,
    planning,
    content,
    credenciales,
    publicaciones,
    webhooks: new WebhookService(store, publicaciones),
    marcas: new MarcaService(store),
    prompts: new PromptService(store),
    objetivos: new ObjectiveService(store),
    policies: new PolicyService(store),
  };
}

/** Siembra el pipeline de contenido y prepara el contenido de una actividad → paquete listo/autorizado. */
export async function sembrarPaquete(m: ReturnType<typeof montar>, actividadId: string, ctx = ctxFor()) {
  const rm = await m.marcas.registrarVersion(ctx, IDS_CONT.marca, marcaDemo, attr, now);
  await m.marcas.publicar(ctx, IDS_CONT.marca, rm.version, attr, now);
  const rp1 = await m.prompts.registrarVersion(ctx, IDS_CONT.promptPieza, promptPiezaDemo, attr, now);
  await m.prompts.publicar(ctx, IDS_CONT.promptPieza, rp1.version, attr, now);
  const rp2 = await m.prompts.registrarVersion(ctx, IDS_CONT.promptAdapt, promptAdaptDemo, attr, now);
  await m.prompts.publicar(ctx, IDS_CONT.promptAdapt, rp2.version, attr, now);
  await m.objetivos.registrar(ctx, IDS_MKT_CONT.objetivo, objetivoContenidoDemo, attr, now);
  const rpol = await m.policies.registrarVersion(ctx, IDS_MKT_CONT.politica, politicaContenidoDemo, attr, now);
  await m.policies.publicar(ctx, IDS_MKT_CONT.politica, rpol.version, attr, now);
  await m.planning.generarPlan(ctx, { planId: IDS_MKT_CONT.plan, objetivoId: IDS_MKT_CONT.objetivo, policyId: IDS_MKT_CONT.politica, fechaInicio: now, opts: optsContenidoDemo, attribution: attr, occurredAt: now });
  await m.content.prepararContenidoParaActividad(ctx, {
    planId: IDS_MKT_CONT.plan, actividadId, marcaId: IDS_CONT.marca, promptPiezaId: IDS_CONT.promptPieza, promptAdaptId: IDS_CONT.promptAdapt, ganchosPromocionales: CONT_GANCHOS, attribution: attr, occurredAt: now,
  });
  return `${IDS_MKT_CONT.plan}--${actividadId}`;
}

export function publicarCmd(paqueteId: string, canal: string, modo: 'simulado' | 'sandbox' | 'real_desactivado' = 'simulado') {
  return { paqueteId, canal, policyId: IDS_MKT_CONT.politica, modo, cuentaLogica: IDS_CHAN.cuentaLogica, credencialId: IDS_CHAN.credencialId, attribution: attr, occurredAt: now };
}
