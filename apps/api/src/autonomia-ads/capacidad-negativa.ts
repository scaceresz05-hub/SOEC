/**
 * apps/api · CAPA DE COMPOSICIÓN · G2-A · Única capacidad WRITE preparada (NO habilitada para efecto real).
 *
 * ADD_NEGATIVE_KEYWORD: agregar una palabra clave NEGATIVA a nivel de campaña. Es la acción de MENOR radio
 * de riesgo (reversible, sólo reduce desperdicio, no sube gasto). NINGUNA otra operación está habilitada en G2-A
 * (presupuesto, CPC, keywords positivas, RSA, pujas, ubicación, pausa de campaña: todas fuera de alcance).
 *
 * Los builders de mutate/rollback son PUROS y DESCRIPTIVOS: producen el cuerpo que se ENVIARÍA a
 * `googleAds:mutate`, pero en G2-A NUNCA se envía (AUTONOMOUS_REAL=false lo bloquea aguas abajo).
 *
 * CONFINAMIENTO DE TENANT: los IDs de cuenta son FIJOS por CONFIGURACIÓN REGISTRADA de la organización
 * (`plataforma/registro`); jamás provienen de texto generado por M9 ni de inputs no confiables.
 * Cualquier intención con IDs distintos se RECHAZA.
 *
 * Antes esto era una constante GLOBAL de un solo tenant: ninguna segunda organización podía tener
 * cuenta externa, y el confinamiento de toda la plataforma era el de SmileFlow. Ahora se resuelve
 * POR ORGANIZACIÓN y es FAIL-CLOSED: una organización sin cuenta de Ads registrada no resuelve nada.
 */
import { getRecursoGoogleAds, ORG_SMILEFLOW } from '../plataforma';

export interface ConfinamientoTenant {
  readonly org: string;
  readonly customerId: string;
  readonly loginCustomerId: string;
}

/**
 * Confinamiento de la organización indicada, desde su configuración registrada. LANZA si la
 * organización no está registrada o no tiene cuenta de Google Ads: nunca cae en la de otra.
 */
export function confinamientoDe(org: string): ConfinamientoTenant {
  const ads = getRecursoGoogleAds(org);
  return { org, customerId: ads.customerId, loginCustomerId: ads.loginCustomerId };
}

/**
 * Confinamiento de `org-smileflow`. Se conserva porque es la configuración registrada de ESA
 * organización (pruebas y adaptador por defecto). NO es el confinamiento de la plataforma: el camino
 * genérico usa `confinamientoDe(org)`.
 */
export const CONFINAMIENTO: ConfinamientoTenant = confinamientoDe(ORG_SMILEFLOW);

/** Referencia OPACA del secreto de escritura, SEPARADA del Reader. El valor NO existe aún (gate humano). */
export const WRITE_CREDENTIAL_REF = 'env:GOOGLE_ADS_WRITE_REFRESH_TOKEN' as const;

/** Tipos de acción. En G2-A SOLO ADD_NEGATIVE_KEYWORD está habilitada. */
export type ActionTypeAds = 'ADD_NEGATIVE_KEYWORD';
export const CAPACIDADES_HABILITADAS_G2A: readonly ActionTypeAds[] = ['ADD_NEGATIVE_KEYWORD'];

export function esCapacidadHabilitada(actionType: string): actionType is ActionTypeAds {
  return (CAPACIDADES_HABILITADAS_G2A as readonly string[]).includes(actionType);
}

/** Operación de mutate DESCRITA (no enviada). `resourcePath` es el endpoint que se usaría. */
export interface OperacionMutate {
  readonly resourcePath: string; // p. ej. v25/customers/<cid>/googleAds:mutate
  readonly operacion: string; // descripción legible de la operación
  readonly cuerpo: Record<string, unknown>; // cuerpo que se enviaría (para auditoría; NO se envía)
}

/**
 * Construye (describe) el mutate para agregar una negativa EXACTA a nivel de campaña. PURO. Nunca se envía.
 * before = la negativa NO existe; after = la negativa existe.
 */
export function construirMutateNegativa(
  customerId: string,
  campaignId: string,
  termino: string,
): OperacionMutate {
  return {
    resourcePath: `v25/customers/${customerId}/googleAds:mutate`,
    operacion: `CampaignCriterionOperation.create — negative keyword EXACT "${termino}" en campaña ${campaignId}`,
    cuerpo: {
      customerId,
      mutateOperations: [
        {
          campaignCriterionOperation: {
            create: {
              campaign: `customers/${customerId}/campaigns/${campaignId}`,
              negative: true,
              keyword: { text: termino, matchType: 'EXACT' },
            },
          },
        },
      ],
    },
  };
}

/**
 * Construye (describe) el rollback: elimina ÚNICAMENTE el criterio creado por esta intención, por su
 * resource_name exacto. PURO. Nunca se envía en G2-A.
 */
export function construirRollbackNegativa(
  customerId: string,
  criterionResourceName: string,
): OperacionMutate {
  return {
    resourcePath: `v25/customers/${customerId}/googleAds:mutate`,
    operacion: `CampaignCriterionOperation.remove — ${criterionResourceName}`,
    cuerpo: {
      customerId,
      mutateOperations: [{ campaignCriterionOperation: { remove: criterionResourceName } }],
    },
  };
}
