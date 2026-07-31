/** Errores de dominio de @soec/crm-comercial. Extienden SoecError para el mapeo HTTP central. */
import { SoecError } from '@soec/contracts';

/** Entrada inválida a un comando del CRM (→ 422). */
export class ComandoCrmInvalidoError extends SoecError {}

/** El contacto referido no existe en la organización del contexto (→ 404). */
export class ContactoNoEncontradoError extends SoecError {}

/** La hipótesis referida no existe en la organización del contexto (→ 404). */
export class HipotesisNoEncontradaError extends SoecError {}

/** Intento de operar sobre datos de otra organización (→ 403). Aislamiento multiempresa. */
export class SeparacionCrmVioladaError extends SoecError {}
