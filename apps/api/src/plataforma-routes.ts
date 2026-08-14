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
import { contextoDe } from './superficie-auth';
import {
  getBusiness,
  buscarFuentes,
  buscarProfile,
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

export function registerPlataformaRoutes(app: FastifyInstance): void {
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
}
