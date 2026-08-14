/**
 * apps/api · Superficie de PLATAFORMA: estado de incorporación de un negocio.
 *
 * Existe porque una organización recién incorporada (C Y P) todavía NO tiene perfil de evaluación y,
 * por tanto, NO puede pasar por `bindExperienciaReal`. Necesita igualmente una lectura honesta que
 * diga qué es, en qué estado está y qué le falta — sin inventar métricas ni mostrar las de otra.
 *
 * Reglas:
 *  · la organización viene del contexto AUTENTICADO (nunca de la URL ni de una constante);
 *  · no requiere perfil: una organización en `SOURCES_PENDING` responde 200 describiendo su estado;
 *  · no expone NINGUNA métrica comercial, ni cuentas externas, ni referencias de credencial;
 *  · `CERO ≠ NO CONECTADO`: cada fuente informa su estado real y qué falta para conectarla.
 */
import type { FastifyInstance } from 'fastify';
import { ActorId, OrganizationId, type EventStore, type RequestContext } from '@soec/contracts';
import {
  CatalogoComercioService,
  VentasComercioService,
  embudoNoInstrumentado,
} from '@soec/comercio';
import { contextoDe } from './superficie-auth';
import { estadoDeposito } from './plataforma/deposito-secretos';
import {
  getBusiness,
  buscarFuentes,
  buscarPerfilComercial,
  buscarProfile,
  evaluarFundamentos,
  organizacionesRegistradas,
  buscarNegocio,
} from './plataforma';

/** Vista de una fuente para la UI. Sin `credentialRef` ni `externalAccountId`: no son de la vista. */
interface FuenteVista {
  readonly sourceId: string;
  readonly tipo: string;
  readonly proveedor: string;
  readonly estado: string;
  readonly faltantes: readonly string[];
}

export function registerPlataformaRoutes(app: FastifyInstance, store?: EventStore): void {
  /** Contexto de lectura de la organización AUTENTICADA. */
  const ctxDe = (req: Parameters<typeof contextoDe>[0]): { ctx: RequestContext; org: string } => {
    const autenticado = contextoDe(req);
    const org = String(autenticado.organizationId);
    const o = OrganizationId(org);
    return {
      ctx: {
        organizationId: o,
        actor: ActorId(String(autenticado.actor)),
        scope: { organizationId: o, permissions: ['events:read'] },
        correlationId: autenticado.correlationId,
      },
      org,
    };
  };

  /**
   * Estado de incorporación del negocio AUTENTICADO. 404 si la organización no está registrada.
   */
  app.get('/plataforma/negocio', async (req, reply) => {
    const ctx = contextoDe(req);
    const org = String(ctx.organizationId);
    const negocio = getBusiness(org); // 404 ORGANIZATION_NOT_CONFIGURED si no existe
    const perfil = buscarProfile(org);
    const fuentes: FuenteVista[] = buscarFuentes(org).map((f) => ({
      sourceId: f.sourceId,
      tipo: f.tipo,
      proveedor: f.provider,
      estado: f.estado,
      faltantes: f.faltantes,
    }));

    return reply.send({
      organizationId: negocio.organizationId,
      businessKey: negocio.businessKey,
      displayName: negocio.displayName,
      legalName: negocio.legalName,
      // `null` significa "no lo sabemos", nunca un valor de relleno.
      rut: negocio.rut,
      modeloDeNegocio: negocio.modeloDeNegocio,
      mercado: negocio.mercado,
      estado: negocio.estado,
      categoriasDeclaradas: negocio.categoriasDeclaradas,
      // Honestidad epistémica: se declara si HAY perfil, no se fabrica uno.
      perfilDeEvaluacion: perfil
        ? {
            configurado: true,
            modeloDeNegocio: perfil.modeloDeNegocio,
            objetivoId: perfil.objetivoId,
          }
        : { configurado: false, motivo: 'BUSINESS_PROFILE_NOT_CONFIGURED' },
      fuentes,
      resumenFuentes: {
        conectadas: fuentes.filter((f) => f.estado === 'CONNECTED_READ_ONLY').length,
        pendientes: fuentes.filter((f) => f.estado === 'PENDING').length,
        noConectadas: fuentes.filter((f) => f.estado === 'NOT_CONNECTED').length,
        noAplica: fuentes.filter((f) => f.estado === 'NOT_APPLICABLE').length,
      },
      experienciasHabilitadas: negocio.experienciasHabilitadas,
      datosHumanosPendientes: negocio.datosHumanosPendientes,
    });
  });

  /**
   * SELECTOR de negocio. Devuelve ÚNICAMENTE identificador, nombre y estado de incorporación:
   * ninguna métrica, ninguna cuenta externa, ningún dato comercial. NO es una vista de portafolio.
   *
   * LIMITACIÓN DECLARADA: este despliegue no filtra la lista por membresía porque el plano de
   * identidad todavía no tiene organizaciones dadas de alta. Antes de que SOEC sea multi-usuario,
   * esta lista DEBE filtrarse por las membresías del usuario autenticado.
   */
  app.get('/plataforma/negocios', async (req, reply) => {
    contextoDe(req); // exige contexto de organización; sin él, 403
    const negocios = organizacionesRegistradas()
      .map((org) => buscarNegocio(org))
      .filter((n): n is NonNullable<typeof n> => n !== null)
      .map((n) => ({
        organizationId: n.organizationId,
        displayName: n.displayName,
        estado: n.estado,
        modeloDeNegocio: n.modeloDeNegocio,
        mercado: n.mercado,
      }));
    return reply.send({ negocios, filtradoPorMembresia: false });
  });

  /**
   * ESTADO DEL DEPÓSITO DE CREDENCIALES de la organización autenticada.
   *
   * Responde qué credenciales EXIGE cada fuente y cuáles ya fueron depositadas por una persona.
   * Devuelve nombres lógicos y booleanos: **nunca** valores, longitudes, prefijos ni fragmentos.
   */
  app.get('/plataforma/credenciales', async (req, reply) => {
    const { org } = ctxDe(req);
    getBusiness(org); // 404 si no está registrada
    const fuentes = buscarFuentes(org).filter((f) => f.credenciales.length > 0);
    const nombresLocales = fuentes
      .flatMap((f) => f.credenciales)
      .filter((c) => c.secretRef.startsWith(`file:${org}/`))
      .map((c) => c.nombreLogico);

    const deposito = estadoDeposito(org, nombresLocales);
    return reply.send({
      organizationId: org,
      depositoPresente: deposito.depositoPresente,
      // Se informa DÓNDE depositar, no qué contiene.
      ruta: deposito.ruta,
      completo: deposito.completo,
      credenciales: deposito.credenciales,
      fuentesQueLasExigen: fuentes.map((f) => ({
        sourceId: f.sourceId,
        tipo: f.tipo,
        estado: f.estado,
        nombresLogicos: f.credenciales.map((c) => c.nombreLogico),
      })),
    });
  });

  /**
   * FUNDAMENTOS: ¿puede el Director razonar sobre este negocio todavía?
   *
   * Devuelve un veredicto DETERMINISTA con motivos estructurados. Nunca devuelve métricas, y
   * `puedeRecomendarInversionPublicitaria` es del tipo literal `false`.
   */
  app.get('/plataforma/fundamentos', async (req, reply) => {
    const { ctx, org } = ctxDe(req);
    const negocio = getBusiness(org);
    const fuenteVentas = buscarFuentes(org).find((f) => f.tipo === 'SALES');
    const ventas =
      store && fuenteVentas
        ? await new VentasComercioService(store).ultimaLineaBase(ctx, fuenteVentas.provider)
        : null;
    const fundamentos = evaluarFundamentos(
      negocio,
      buscarFuentes(org),
      buscarPerfilComercial(org),
      buscarProfile(org) !== null,
      ventas,
    );
    return reply.send({
      ...fundamentos,
      // El embudo de comercio, hoy sin instrumentar. Ningún paso reporta «0 eventos».
      embudo: embudoNoInstrumentado(org),
    });
  });

  /**
   * VENTAS OBSERVADAS EN LA FUENTE. Deliberadamente NO se llama «ventas de la empresa»: mientras
   * existan canales sin instrumentar, esta fuente no es el 100% del negocio y el campo
   * `coberturaDelNegocio` lo dice. Sin observación previa responde `observado: false`, nunca ceros.
   */
  app.get('/plataforma/ventas', async (req, reply) => {
    const { ctx, org } = ctxDe(req);
    getBusiness(org);
    const fuente = buscarFuentes(org).find((f) => f.tipo === 'SALES');
    if (!store || !fuente) {
      return reply.send({
        organizationId: org,
        observado: false,
        motivo: fuente ? 'SIN_ALMACEN_DE_EVENTOS' : 'SALES_SOURCE_NOT_REGISTERED',
      });
    }
    const lineaBase = await new VentasComercioService(store).ultimaLineaBase(ctx, fuente.provider);
    if (!lineaBase) {
      return reply.send({
        organizationId: org,
        observado: false,
        source: fuente.provider,
        estadoFuente: fuente.estado,
        motivo:
          fuente.estado === 'CREDENTIALS_REQUIRED'
            ? 'SALES_PENDING_CREDENTIALS'
            : 'VENTAS_AUN_NO_OBSERVADAS',
      });
    }
    return reply.send({
      organizationId: org,
      observado: true,
      estadoFuente: fuente.estado,
      lineaBase,
    });
  });

  /**
   * CATÁLOGO observado de la organización. 404 si la organización no está registrada.
   * Si nunca se observó, responde `observado: false` — NUNCA un resumen en cero.
   */
  app.get('/plataforma/catalogo', async (req, reply) => {
    const { ctx, org } = ctxDe(req);
    getBusiness(org); // 404 si no está registrada
    const fuente = buscarFuentes(org).find((f) => f.tipo === 'CATALOG');
    if (!store || !fuente) {
      return reply.send({
        organizationId: org,
        observado: false,
        motivo: fuente ? 'SIN_ALMACEN_DE_EVENTOS' : 'CATALOG_SOURCE_NOT_REGISTERED',
      });
    }
    const catalogo = await new CatalogoComercioService(store).ultimoCatalogo(ctx, fuente.provider);
    if (!catalogo) {
      return reply.send({
        organizationId: org,
        observado: false,
        source: fuente.provider,
        estadoFuente: fuente.estado,
        motivo: 'CATALOGO_AUN_NO_OBSERVADO',
      });
    }
    return reply.send({
      organizationId: org,
      observado: true,
      source: catalogo.source,
      observedAt: catalogo.observedAt,
      completo: catalogo.completo,
      advertencias: catalogo.advertencias,
      resumen: catalogo.resumen,
      hallazgos: catalogo.hallazgos,
    });
  });
}
