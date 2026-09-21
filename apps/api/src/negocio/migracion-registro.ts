/**
 * apps/api · NEGOCIO COMO DATO · migración del registro TypeScript a PostgreSQL.
 *
 * SmileFlow y CP Odontología nacieron como módulos de código. Aquí sus datos comerciales pasan a ser filas,
 * conservando EXACTAMENTE su identidad (`organizationId`), su tipo, sus objetivos, su territorio y sus
 * restricciones. No se crean organizaciones nuevas, no se regeneran identificadores y no se tocan campañas.
 *
 * IDEMPOTENTE: se ejecuta en cada arranque y no hace nada si el negocio ya está migrado. Lo que el usuario
 * edite después en la base manda: la migración nunca sobrescribe un perfil existente.
 *
 * Lo que NO migra (y por qué): las fuentes de datos, sus credenciales y las experiencias habilitadas siguen
 * resolviéndose por el registro durante la transición. Son configuración OPERATIVA con secretos asociados,
 * no perfil comercial, y moverlas exige su propio trabajo. Una empresa NUEVA no depende de nada de eso.
 */
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { buscarNegocio, organizacionesRegistradas, type NegocioRegistrado } from '../plataforma';
import { RepositorioNegocios, type AmbitoGeografico, type TipoCliente, type TipoNegocio } from './negocio-pg';

/** `businessKey` estable y reproducible para un negocio migrado: no cambia entre despliegues ni entornos. */
function claveEstable(org: string, businessKey: string): string {
  return createHash('sha256').update(`soec:business:${org}:${businessKey}`).digest('hex').slice(0, 32);
}

/** Traduce el modelo de evaluación histórico al tipo de negocio del modelo canónico. */
export function tipoDesdeRegistro(n: NegocioRegistrado): TipoNegocio {
  const declarado = (n.tipoDeNegocio ?? '').toLowerCase();
  if (declarado.includes('clínic') || declarado.includes('clinic') || declarado.includes('dental')) return 'CLINICA';
  switch (n.modeloDeNegocio) {
    case 'SAAS_FUNNEL': return 'SAAS';
    case 'ECOMMERCE_DISTRIBUCION': return 'ECOMMERCE';
    case 'SERVICIOS': return 'SERVICIOS';
    default: return 'OTRO';
  }
}

const MERCADO_A_PAIS: Record<string, string> = { Chile: 'CL', CL: 'CL' };

export interface ResultadoMigracion {
  readonly migrados: readonly string[];
  readonly yaEstaban: readonly string[];
}

/**
 * Siembra en PostgreSQL los negocios que hoy declara el registro. Devuelve qué migró y qué ya estaba, para
 * que el arranque lo deje por escrito.
 */
export async function migrarNegociosDelRegistro(pool: Pool, ahora: () => string = () => new Date().toISOString()): Promise<ResultadoMigracion> {
  const repo = new RepositorioNegocios(pool);
  const migrados: string[] = [];
  const yaEstaban: string[] = [];

  for (const org of organizacionesRegistradas()) {
    const n = buscarNegocio(org);
    if (n === null) continue;
    if ((await repo.perfil(org)) !== null) { yaEstaban.push(org); continue; }

    const c = await pool.connect();
    try {
      await c.query('begin');
      await repo.insertarPerfil(c, {
        organizationId: n.organizationId,              // IDENTIDAD INTACTA: nunca se regenera
        businessKey: claveEstable(n.organizationId, n.businessKey),
        displayName: n.displayName,
        legalName: n.legalName || null,
        businessType: tipoDesdeRegistro(n),
        description: n.tipoDeNegocio ?? null,
        website: null,                                  // el sitio vive hoy en el perfil comercial/fuentes
        country: MERCADO_A_PAIS[n.mercado] ?? 'CL',
        currency: 'CLP',
        timezone: 'America/Santiago',
        language: 'es',
        customerType: (n.modeloDeNegocio === 'SAAS_FUNNEL' ? 'B2B' : 'B2C') as TipoCliente,
        primaryObjective: n.objetivoComercial ?? null,
        status: 'ACTIVE',                               // ya operan: no vuelven a borrador
        origen: 'MIGRACION',
      });

      // GOBIERNO: se preserva la postura vigente. SmileFlow conserva su pausa automática de seguridad; las
      // demás nacen con todo apagado. Ninguna migración enciende una capacidad que la empresa no tenía.
      await repo.insertarGobierno(c, {
        organizationId: org,
        externalMutations: false,
        autonomousSpend: false,
        automaticSafetyPause: n.politicaSeguridad?.pausaAutomatica === true,
        campaignExecution: false,
      });

      // Oferta declarada: lo que el negocio dice prestar (especialidad + otras líneas). Sin inventar catálogo.
      const lineas = [
        ...(n.especialidad ? [{ nombre: n.especialidad.principal, prioridad: 10 }] : []),
        ...(n.especialidad?.tambienPresta ?? []).map((x) => ({ nombre: x, prioridad: 50 })),
        ...n.categoriasDeclaradas.map((x) => ({ nombre: x, prioridad: 100 })),
      ];
      const vistos = new Set<string>();
      for (const linea of lineas) {
        const slug = linea.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (slug.length === 0 || vistos.has(slug)) continue;
        vistos.add(slug);
        await repo.guardarOferta(c, {
          organizationId: org, id: slug, slug, name: linea.nombre, description: null, category: null,
          status: 'ACTIVE', landingUrl: null, priority: linea.prioridad, geographicScope: null,
          // Declarada, no autorizada: promocionarla exige la decisión del propietario.
          advertisingEligibility: 'REQUIRES_APPROVAL', restrictions: [],
        });
      }

      // Territorio comercial declarado. La diferencia entre lo que el negocio atiende y lo que una plataforma
      // puede ejecutar se representa con dos ámbitos distintos, no con un solo campo.
      const alcance = n.alcanceComercial ?? null;
      if (alcance) {
        await repo.guardarTerritorio(c, {
          organizationId: org, id: 'business', ambito: 'BUSINESS' as AmbitoGeografico,
          country: alcance.pais ?? 'Chile', region: alcance.region ?? null, province: alcance.provincia ?? null,
          localities: alcance.comunas ?? [], criterio: alcance.criterioUbicacion ?? null,
          nota: 'territorio comercial declarado por el negocio',
        });
      }

      // Lo que la empresa declara que NO puede afirmarse todavía se conserva como restricción explícita.
      for (const [i, faltante] of n.datosHumanosPendientes.entries()) {
        await repo.guardarRestriccion(c, {
          organizationId: org, id: `pendiente-${i + 1}`, tipo: 'RESTRICTION',
          texto: `dato pendiente de aportar: ${faltante}`, alcance: null,
        });
      }

      await repo.registrarAuditoria(c, {
        organizationId: org, actor: 'migracion-business-as-data', action: 'BUSINESS_CREATED',
        changedFields: { origen: 'REGISTRO_TS', at: ahora() },
      });
      await c.query('commit');
      migrados.push(org);
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  return { migrados, yaEstaban };
}
