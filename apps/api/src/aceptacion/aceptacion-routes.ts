/**
 * apps/api · ACEPTACIÓN · superficie HTTP de la PREPARACIÓN COMERCIAL (Autonomy Fase H, nivel C).
 *
 * Una sola ruta, de SOLO LECTURA: `GET /aceptacion/preparacion`. Reúne lo que ya está persistido por las
 * Fases A–G de la organización autenticada y lo pasa por el read model. No escribe, no dispara trabajos, no
 * llama a ningún proveedor externo y no rellena ningún dato que falte: si algo no está, el informe lo dice.
 *
 * Es la ruta con la que se puede contestar «¿está esta empresa lista para que SOEC lleve su marketing?» sin
 * abrir siete pantallas ni tocarle nada.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { contextoDe, modoOperativoDe } from '../superficie-auth';
import { OnboardingService } from '../onboarding/onboarding-service';
import { RepositorioOnboarding } from '../onboarding/onboarding-pg';
import { RepositorioNegocios } from '../negocio/negocio-pg';
import { RepositorioConexiones } from '../conexion/conexion-pg';
import { RepositorioInvestigacion } from '../investigacion/investigacion-pg';
import { RepositorioPlan } from '../investigacion/plan-pg';
import { RepositorioEjecucion } from '../ejecucion/ejecucion-pg';
import { RepositorioOptimizacion } from '../optimizacion/optimizacion-pg';
import { PgMandatoRepo } from '../accion/accion-pg';
import { evaluarPreparacionComercial, type DatosPreparacion } from './preparacion-comercial';

export function registerAceptacionRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/aceptacion/preparacion', async (req: FastifyRequest, reply) => {
    const ctx = contextoDe(req);
    const org = String(ctx.organizationId);
    const ahora = new Date().toISOString();
    // El modo lo dice el gateway (autoridad); sin cabecera se asume el más conservador.
    const modoOperativo = modoOperativoDe(req) ?? 'PILOT';

    const onboarding = new OnboardingService(pool, { leerModo: async () => modoOperativo });
    const repoOnb = new RepositorioOnboarding(pool);
    const negocios = new RepositorioNegocios(pool);
    const conexiones = new RepositorioConexiones(pool);
    const investigaciones = new RepositorioInvestigacion(pool);
    const planes = new RepositorioPlan(pool);
    const ejecuciones = new RepositorioEjecucion(pool);
    const optimizaciones = new RepositorioOptimizacion(pool);

    const perfil = await negocios.perfil(org);
    if (perfil === null) return reply.code(404).send({ error: 'NEGOCIO_NO_ENCONTRADO', message: 'esta organización no tiene un negocio dado de alta' });

    const [readiness, sitio, gobierno, conexion, capacidades, mandato, corrida, plan, medicion, peticion, politicaAutonomia] = await Promise.all([
      onboarding.readiness(org),
      repoOnb.observacionSitio(org),
      negocios.gobierno(org),
      conexiones.buscar(org, 'GOOGLE_ADS'),
      conexiones.capacidades(org),
      new PgMandatoRepo(pool).actual(org),
      investigaciones.ultimaCorrida(org),
      planes.ultimoPlan(org),
      ejecuciones.medicion(org, 'GOOGLE_ADS'),
      ejecuciones.ultima(org),
      optimizaciones.politica(org),
    ]);

    const cfg = (conexion?.configuracion ?? {}) as { customerId?: string };
    const cuenta = (cfg.customerId ?? conexion?.externalAccountId ?? '').replace(/\D/g, '') || null;
    const grupos = plan === null ? [] : await planes.grupos(org, plan.id);
    const terminos = corrida === null ? [] : await investigaciones.terminos(org, corrida.id);
    const landings = corrida === null ? [] : await investigaciones.landings(org, corrida.id);

    const datos: DatosPreparacion = {
      organizationId: org,
      ahora,
      readiness,
      sitio: sitio === null ? null : { url: sitio.url, estado: sitio.estado, paginas: sitio.paginas.length },
      sitioDeclarado: perfil.website,
      landings: landings.map((l) => ({ ofertaSlug: l.ofertaSlug, estado: l.estado, url: l.url })),
      conexionGoogle: conexion === null ? null : { estado: conexion.estado, cuenta },
      capacidades: capacidades.filter((c) => c.habilitada).map((c) => c.capacidad),
      modoOperativo,
      gobierno: gobierno === null ? null : {
        externalMutations: gobierno.externalMutations,
        campaignExecution: gobierno.campaignExecution,
        autonomousSpend: gobierno.autonomousSpend,
      },
      mandato: mandato === null ? null : {
        vigente: Date.parse(mandato.periodEnd) > Date.parse(ahora) && Date.parse(mandato.periodStart) <= Date.parse(ahora),
        topeMinor: mandato.authorizedBudgetMinor,
        moneda: mandato.currency,
        hasta: mandato.periodEnd,
      },
      investigacion: corrida === null ? null : {
        estado: corrida.estado,
        fresca: corrida.estado === 'COMPLETE' || corrida.estado === 'PARTIAL',
        terminos: terminos.length,
      },
      plan: plan === null ? null : { estado: plan.estado, vigente: plan.estado !== 'STALE', grupos: grupos.length },
      medicion: medicion.map((m) => ({ eventKey: m.eventKey, estado: m.estado })),
      campana: peticion === null ? null : {
        estado: peticion.estado,
        campaignId: peticion.recursosExternos?.campaigns?.[0]?.split('/').pop() ?? null,
        reconciliada: peticion.reconciliacion === null ? null : peticion.reconciliacion.coincide,
      },
      politicaAutonomia: politicaAutonomia === null ? null : {
        accionesPermitidas: politicaAutonomia.accionesPermitidas,
        activacionAutonomaPermitida: politicaAutonomia.activacionAutonomaPermitida,
      },
    };

    return reply.send({ preparacion: evaluarPreparacionComercial(datos) });
  });
}
