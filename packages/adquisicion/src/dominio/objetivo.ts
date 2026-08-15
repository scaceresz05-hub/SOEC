/**
 * ObjetivoComercial — qué le pedimos al motor de adquisición, en lenguaje de negocio.
 *
 * SOEC recibe un objetivo comercial (no una métrica intermedia). El objetivo es provider-neutral:
 * no menciona Meta, Google ni ninguna plataforma. Cada negocio declara CUÁLES objetivos admite;
 * no se asume que todo negocio admita todos (una distribuidora e-commerce persigue VENTA, una
 * clínica SaaS persigue LEAD/DEMO). La ausencia de objetivo declarado no es "cero objetivos":
 * es un negocio aún sin dirección comercial configurada.
 */

export type ObjetivoComercial =
  | 'GENERATE_LEADS'
  | 'GENERATE_DEMOS'
  | 'GENERATE_SALES'
  | 'GENERATE_TRAFFIC'
  | 'GENERATE_AWARENESS'
  | 'REACTIVATE_DEMAND';

export const OBJETIVOS_COMERCIALES: readonly ObjetivoComercial[] = [
  'GENERATE_LEADS',
  'GENERATE_DEMOS',
  'GENERATE_SALES',
  'GENERATE_TRAFFIC',
  'GENERATE_AWARENESS',
  'REACTIVATE_DEMAND',
] as const;

export function esObjetivoComercial(x: string): x is ObjetivoComercial {
  return (OBJETIVOS_COMERCIALES as readonly string[]).includes(x);
}

/**
 * Objetivos que un negocio concreto declara como válidos. Nunca se infiere el conjunto: se lee de
 * la configuración del negocio. Un negocio sin objetivos declarados devuelve `[]` (no "todos").
 */
export interface ObjetivosDeNegocio {
  readonly organizationId: string;
  readonly objetivosAdmitidos: readonly ObjetivoComercial[];
}

export function admiteObjetivo(negocio: ObjetivosDeNegocio, objetivo: ObjetivoComercial): boolean {
  return negocio.objetivosAdmitidos.includes(objetivo);
}
