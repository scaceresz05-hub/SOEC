/**
 * @soec/adquisicion — MOTOR DE ADQUISICIÓN GENÉRICO Y MULTICANAL de SOEC.
 *
 * Nace para que SOEC reciba un OBJETIVO COMERCIAL y razone cómo generar demanda y potenciales
 * clientes, sin quedar atado a una empresa ni a una plataforma. Es una capa UNIFICADORA, no un
 * segundo sistema: compone los primitivos ya probados del monorepo (DesconocidoOValor y contienePII
 * de @soec/comercio; los gates y el mandato de @soec/autonomia; los fundamentos de la plataforma)
 * en el vocabulario provider-neutral que el motor necesita.
 *
 * Garantías por tipo (no por convención):
 *   · el canal es un enum tipado, con estado explícito; «no conectado» ╪ «cero»;
 *   · la identidad de un lead es organization + source + externalLeadId, jamás PII;
 *   · la atribución DESCONOCIDA permanece desconocida; nunca se promueve a orgánico/directo;
 *   · sin BrandPolicy ⇒ DRAFT_ONLY; sin StopLossPolicy ⇒ sin PAID autónomo;
 *   · las cuentas de canal son tenant-scoped y fail-closed; nunca hay fallback a otra organización.
 *
 * Ninguna función de este paquete produce efectos externos: no publica, no crea campañas, no gasta.
 */

export * from './dominio/pii';
export * from './dominio/objetivo';
export * from './dominio/canal';
export * from './dominio/cuenta-canal';
export * from './dominio/resultado';
export * from './dominio/atribucion';
export * from './dominio/lead';
export * from './dominio/economia';
export * from './dominio/marca-politica';
export * from './dominio/contenido-hipotesis';
export * from './dominio/campania';
export * from './dominio/experimento';
export * from './dominio/estrategia-canal';
export * from './dominio/planner';
export * from './dominio/enlace-resultado';
export * from './dominio/accion-social';
export * from './dominio/mandato-multicanal';
export * from './dominio/meta-adapter-contract';
