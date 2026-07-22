import { ActorId, type Attribution, type EventStore, OrganizationId, type RequestContext } from '@soec/contracts';
import { InMemoryEventStore } from '@soec/event-store';
import { OperationalService, PolicyService, AdaptadorSimulado } from '@soec/operacional';
import { ObjectiveService, PlanningService } from '@soec/marketing';
import { ContentService, MarcaService, PromptService, ProveedorGenerativoDeterminista, CONT_GANCHOS, IDS_CONT, IDS_MKT_CONT, marcaDemo, objetivoContenidoDemo, optsContenidoDemo, politicaContenidoDemo, promptAdaptDemo, promptPiezaDemo } from '@soec/contenido';
import { AdaptadorCanalSimulado, FixtureCredentialProvider, PublicationService } from '@soec/canales';
import { MeasurementService, OptimizationService } from '../src';
import { FuenteMetricasSimulada, type FilaProveedor } from '../src/app/metrics-source';

export const attr: Attribution = {
  source: 'medicion-test',
  purpose: 'medir y optimizar sobre datos sintéticos',
  assumptions: ['datos sintéticos; sin gasto real'],
  claimType: 'observational',
  regime: 'institutional',
  uncertainty: 'baja',
};
export const now = '2026-07-21T09:00:00.000Z';
export const ORG = 'pyme-met-demo';
export { IDS_MKT_CONT, IDS_CONT };

export function ctxFor(org: string = ORG, permissions: string[] = ['events:append', 'events:read']): RequestContext {
  const organizationId = OrganizationId(org);
  return { organizationId, actor: ActorId('soec'), scope: { organizationId, permissions }, correlationId: `corr-${org}` };
}

export function montar(store: EventStore = new InMemoryEventStore(), source = new FuenteMetricasSimulada()) {
  const operational = new OperationalService(store, [new AdaptadorSimulado()]);
  const planning = new PlanningService(store, operational);
  const content = new ContentService(store, new ProveedorGenerativoDeterminista(), planning);
  const creds = new FixtureCredentialProvider();
  creds.registrarTodosLosCanales(ORG, 'cuenta-demo', 'cred-demo', ['blog', 'linkedin', 'instagram', 'correo', 'meta_ads', 'facebook']);
  const publicaciones = new PublicationService(store, { simulado: new AdaptadorCanalSimulado(), sandbox: new AdaptadorCanalSimulado() }, creds, content);
  return {
    store,
    source,
    planning,
    content,
    publicaciones,
    medicion: new MeasurementService(store, source),
    optimizacion: new OptimizationService(store, planning),
    marcas: new MarcaService(store),
    prompts: new PromptService(store),
    objetivos: new ObjectiveService(store),
    policies: new PolicyService(store),
  };
}

/** Siembra contenido + publica una actividad (simulado) y devuelve refs. */
export async function sembrarYPublicar(m: ReturnType<typeof montar>, actividadId: string, ctx = ctxFor()) {
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
  const paqueteId = `${IDS_MKT_CONT.plan}--${actividadId}`;
  await m.content.prepararContenidoParaActividad(ctx, { planId: IDS_MKT_CONT.plan, actividadId, marcaId: IDS_CONT.marca, promptPiezaId: IDS_CONT.promptPieza, promptAdaptId: IDS_CONT.promptAdapt, ganchosPromocionales: CONT_GANCHOS, attribution: attr, occurredAt: now });
  const pub = await m.publicaciones.publicarCiclo(ctx, { paqueteId, canal: actividadId.includes('blog') ? 'blog' : 'linkedin', policyId: IDS_MKT_CONT.politica, modo: 'simulado', cuentaLogica: 'cuenta-demo', credencialId: 'cred-demo', attribution: attr, occurredAt: now });
  return { ctx, paqueteId, publicationId: pub.publicationId, externalRef: pub.externalRef! };
}

/** Filas de métricas deterministas por escenario (para la fuente simulada). */
export function filas(externalRef: string, escenario: 'alto' | 'bajo' | 'gasto_excedido' | 'insuficiente', seq = 1): FilaProveedor[] {
  const periodo = '2026-07-21';
  const f = (metrica: string, valor: number, unidad = 'conteo', moneda: string | null = null): FilaProveedor => ({ externalId: externalRef, metrica, valor, unidad, moneda, periodo, ocurridoEn: now, proveedorSeq: seq, acumulativa: true, estimada: false });
  if (escenario === 'insuficiente') return [f('impresiones', 20), f('clics', 2), f('leads', 1), f('conversiones', 0), f('gasto', 5, 'monetario', 'CLP')];
  if (escenario === 'bajo') return [f('impresiones', 1000), f('clics', 100), f('leads', 10), f('conversiones', 0), f('gasto', 200, 'monetario', 'CLP')];
  if (escenario === 'gasto_excedido') return [f('impresiones', 1000), f('clics', 100), f('leads', 10), f('conversiones', 8), f('gasto', 9000, 'monetario', 'CLP')];
  return [f('impresiones', 1000), f('clics', 100), f('leads', 40), f('conversiones', 8), f('gasto', 200, 'monetario', 'CLP')]; // alto: tasa_conversion 0.08
}
