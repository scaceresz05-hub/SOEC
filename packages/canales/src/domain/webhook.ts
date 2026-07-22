/**
 * Webhooks entrantes (F2-CHAN-01 §14). SOEC recibe, valida firma (simulada),
 * deduplica, persiste y procesa; ignora eventos desconocidos de forma segura e
 * impide replay. Un webhook antiguo o fuera de orden no puede retroceder el estado.
 */
import { createHmac } from 'node:crypto';

/** Secreto de firma de desarrollo, compartido con el proveedor emulado (no es un secreto real). */
export const SECRETO_WEBHOOK_DEV = 'emu-webhook-secret-dev';

export interface WebhookEntrante {
  readonly id: string;
  readonly tipo: string;
  readonly externalRef: string;
  readonly status: string;
  readonly firma: string;
}

/** Valida la firma HMAC del cuerpo canónico del webhook. */
export function validarFirmaWebhook(id: string, tipo: string, externalRef: string, status: string, firma: string, secreto = SECRETO_WEBHOOK_DEV): boolean {
  const cuerpo = JSON.stringify({ tipo, externalId: externalRef, status });
  const esperado = createHmac('sha256', secreto).update(cuerpo).digest('hex');
  return esperado === firma;
}
