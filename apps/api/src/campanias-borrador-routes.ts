/**
 * Superficie AUTENTICADA de CAMPAÑAS EN BORRADOR, sobre el modelo persistente real (`@soec/campanias`).
 *
 * Existe porque el único camino HTTP que creaba campañas era el de programas, y ése está pensado para
 * simulación: exige presupuesto positivo, aprueba solo la decisión que crea y fija KPIs simulados. Aquí
 * no hay nada de eso. Se crea un BORRADOR exactamente como se describe:
 *
 *   · presupuesto `null` si todavía no está decidido (si se define, además exige `budget.manage`);
 *   · una decisión de marketing REAL, en el estado que le corresponde por sus datos —NO_EVALUABLE si
 *     falta información obligatoria, PROPUESTA si no—, y que esta superficie JAMÁS transiciona;
 *   · métricas y criterios que manda quien planifica; esta ruta no inventa ninguno.
 *
 * No hay ruta de activación. Entrar en un estado ejecutable sigue siendo una transición de dominio que
 * exige presupuesto > 0 y decisión aprobada (`CampaniaService.transicionar`).
 *
 * TERRITORIO: si la organización declara `alcanceComercial` en su registro, toda campaña suya lo lleva
 * obligatoriamente y ninguna comuna, provincia, región ni país puede quedar fuera de él. Se comprueba al
 * crear y al editar: un borrador no puede ampliarse fuera del territorio, ni perder el alcance.
 *
 * Se registra DENTRO del gateway vertical ⇒ sesión (401), membresía (404) y CSRF heredados. La
 * organización sale SIEMPRE del contexto autenticado, nunca de la URL ni del cuerpo.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Attribution, EventStore, RequestContext } from '@soec/contracts';
import type { Clock } from '@soec/event-store';
import {
  CampaniaInvalidaError,
  CampaniaService,
  POLITICA_CAMPANIA_CONSERVADORA,
  describirAlcance,
  validarContenidoDeBorrador,
  evaluarActivacion,
  fueraDeAlcance,
  type AlcanceGeografico,
  type CambiosBorrador,
  type Campania,
  type EntradaBorrador,
} from '@soec/campanias';
import { DecisionMktService, type EntradaDecision } from '@soec/decisiones-mkt';
import { contextoDe, exigir } from './superficie-auth';
import { buscarNegocio } from './plataforma';

const BODY_LIMIT = 64 * 1024;

const ATRIBUCION: Attribution = {
  source: 'campanias-borrador',
  purpose: 'planificar campañas comerciales en borrador, sin presupuesto ni ejecución',
  assumptions: ['borrador: sin gasto, sin publicación, sin objetos externos'],
  claimType: 'observational',
  regime: 'empirical',
  uncertainty: 'media',
};

const ID_CAMPANIA = /^[a-z0-9][a-z0-9-]{2,79}$/;

/** Campos editables de un borrador. Cualquier otra clave en el cuerpo se rechaza (400), no se ignora. */
const CLAVES_EDITABLES: ReadonlySet<keyof CambiosBorrador> = new Set<keyof CambiosBorrador>([
  'nombre', 'objetivo', 'publico', 'propuesta', 'mensaje', 'canal', 'contenidoRequerido', 'calendario', 'presupuesto',
  'hipotesis', 'metricas', 'criterioExito', 'criterioPausa', 'riesgos', 'destino', 'destinosPorGrupo',
  'requisitosPrevios', 'alcanceGeografico',
]);

type Cuerpo = Record<string, unknown>;

const texto = (b: Cuerpo, k: string): string => (typeof b[k] === 'string' ? (b[k] as string) : '');
const textos = (b: Cuerpo, k: string): string[] =>
  Array.isArray(b[k]) ? (b[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];

/**
 * Límite territorial de la organización. Si declara alcance comercial, el de la campaña es obligatorio y
 * debe estar contenido en él. Si no declara ninguno, no se impone (ni se infiere) nada.
 */
function exigirTerritorio(org: string, alcance: AlcanceGeografico | null | undefined): void {
  const declarado = buscarNegocio(org)?.alcanceComercial ?? null;
  if (declarado === null) return;
  if (alcance === null || alcance === undefined) {
    throw new CampaniaInvalidaError(
      `la organización declara territorio comercial (${describirAlcance(declarado)}): toda campaña debe llevar alcanceGeografico`,
    );
  }
  const fuera = fueraDeAlcance(alcance, declarado);
  if (fuera.length > 0) {
    throw new CampaniaInvalidaError(
      `alcance fuera del territorio comercial de la organización (${describirAlcance(declarado)}): ${fuera.join(', ')}`,
    );
  }
}

async function vista(svc: CampaniaService, ctx: RequestContext, c: Campania): Promise<Record<string, unknown>> {
  const estadoDecision = await svc.estadoDecision(ctx, c);
  return {
    campania: c,
    decision: { decisionId: c.decisionId, estado: estadoDecision },
    geographicScope: c.alcanceGeografico ? describirAlcance(c.alcanceGeografico) : null,
    // Qué le falta para poder ejecutarse. Informativo: la guarda real está en `transicionar`.
    activacion: evaluarActivacion(c, estadoDecision),
  };
}

export function registerCampaniasBorradorRoutes(app: FastifyInstance, store: EventStore, clock: Clock): void {
  const campanias = new CampaniaService(store);
  const decisiones = new DecisionMktService(store);
  const opts = { config: { bodyLimit: BODY_LIMIT } };

  // Crear BORRADOR (+ su decisión, sin aprobarla).
  app.post('/campanias/borradores', opts, async (req: FastifyRequest, reply: FastifyReply) => {
    exigir(req, 'campaign.manage');
    const ctx = contextoDe(req);
    const org = String(ctx.organizationId);
    const b = (req.body ?? {}) as Cuerpo;
    const campaniaId = texto(b, 'campaniaId');
    if (!ID_CAMPANIA.test(campaniaId)) return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'campaniaId inválido' });
    const c = (b['campania'] ?? {}) as Cuerpo;
    const d = (b['decision'] ?? {}) as Cuerpo;
    if (typeof b['campania'] !== 'object' || typeof b['decision'] !== 'object') {
      return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'se requieren campania y decision' });
    }
    if (!('presupuesto' in c)) {
      return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: 'presupuesto es obligatorio: null si aún no está decidido' });
    }
    const presupuesto = c['presupuesto'] as EntradaBorrador['presupuesto'];
    // Fijar dinero es otra autoridad: quien planifica no decide el presupuesto por el mero hecho de planificar.
    if (presupuesto !== null) exigir(req, 'budget.manage');

    const alcance = (c['alcanceGeografico'] ?? null) as AlcanceGeografico | null;
    exigirTerritorio(org, alcance);

    const decisionId = `dec-${campaniaId}`;
    const entrada: EntradaBorrador = {
      organizacionId: org,
      decisionId,
      nombre: texto(c, 'nombre'),
      objetivo: texto(c, 'objetivo'),
      publico: texto(c, 'publico'),
      propuesta: texto(c, 'propuesta'),
      mensaje: texto(c, 'mensaje'),
      canal: texto(c, 'canal'),
      contenidoRequerido: textos(c, 'contenidoRequerido'),
      calendario: texto(c, 'calendario'),
      presupuesto,
      hipotesis: textos(c, 'hipotesis'),
      metricas: textos(c, 'metricas'),
      criterioExito: texto(c, 'criterioExito'),
      criterioPausa: texto(c, 'criterioPausa'),
      riesgos: textos(c, 'riesgos'),
      destino: typeof c['destino'] === 'string' ? (c['destino'] as string) : null,
      destinosPorGrupo: Array.isArray(c['destinosPorGrupo']) ? (c['destinosPorGrupo'] as EntradaBorrador['destinosPorGrupo']) : [],
      requisitosPrevios: textos(c, 'requisitosPrevios'),
      alcanceGeografico: alcance,
    };
    // Todo lo verificable sin tocar el store se verifica ANTES de escribir la decisión: un cuerpo
    // inválido no deja una decisión huérfana detrás.
    validarContenidoDeBorrador(entrada, POLITICA_CAMPANIA_CONSERVADORA);

    const entradaDecision: EntradaDecision = {
      organizacionId: org,
      objetivo: texto(d, 'objetivo'),
      contexto: texto(d, 'contexto'),
      hechos: [],
      fuentes: textos(d, 'fuentes'),
      faltantesObligatorios: textos(d, 'faltantesObligatorios'),
      inferencias: [],
      hipotesis: textos(d, 'hipotesis').map((enunciado, i) => ({ id: `h${i + 1}`, enunciado, tipo: 'HIPOTESIS' as const })),
      alternativas: [],
      justificacion: texto(d, 'justificacion'),
      riesgos: textos(d, 'riesgos'),
      confianza: null, // sin datos reales no hay confianza que declarar
      criterioExito: texto(d, 'criterioExito'),
      criterioFracaso: texto(d, 'criterioFracaso'),
      aprobacionRequerida: true,
      nivelAutonomia: 0,
      aprendizajeQueLaCambio: null,
    };
    const ahora = clock.now();
    await decisiones.crear(ctx, decisionId, entradaDecision, ATRIBUCION, ahora);

    const creada = await campanias.crearBorrador(ctx, campaniaId, entrada, POLITICA_CAMPANIA_CONSERVADORA, ATRIBUCION, ahora);
    return reply.code(201).send(await vista(campanias, ctx, creada));
  });

  // Editar BORRADOR.
  app.patch('/campanias/:campaniaId/borrador', opts, async (req: FastifyRequest, reply: FastifyReply) => {
    exigir(req, 'campaign.manage');
    const ctx = contextoDe(req);
    const org = String(ctx.organizationId);
    const { campaniaId } = req.params as { campaniaId: string };
    const b = (req.body ?? {}) as Cuerpo;
    const desconocidas = Object.keys(b).filter((k) => !CLAVES_EDITABLES.has(k as keyof CambiosBorrador));
    if (desconocidas.length > 0) {
      return reply.code(400).send({ error: 'ENTRADA_INVALIDA', message: `claves no editables: ${desconocidas.join(', ')}` });
    }
    if ('presupuesto' in b && b['presupuesto'] !== null) exigir(req, 'budget.manage');
    if ('alcanceGeografico' in b) exigirTerritorio(org, b['alcanceGeografico'] as AlcanceGeografico | null);
    const editada = await campanias.actualizarBorrador(ctx, campaniaId, b as CambiosBorrador, POLITICA_CAMPANIA_CONSERVADORA, ATRIBUCION, clock.now());
    return reply.send(await vista(campanias, ctx, editada));
  });

  // Leer una campaña de la organización autenticada.
  app.get('/campanias/:campaniaId', async (req: FastifyRequest, reply: FastifyReply) => {
    exigir(req, 'campaign.read');
    const ctx = contextoDe(req);
    const { campaniaId } = req.params as { campaniaId: string };
    const c = await campanias.cargar(ctx, campaniaId);
    if (!c.existe) return reply.code(404).send({ error: 'CAMPANIA_NO_ENCONTRADA', message: 'la campaña no existe en esta organización' });
    return reply.send(await vista(campanias, ctx, c));
  });
}
