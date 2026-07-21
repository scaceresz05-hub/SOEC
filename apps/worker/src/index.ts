import type { Outbox, RecordedEvent } from '@soec/contracts';

/**
 * Procesa el outbox de forma idempotente: cada mensaje se maneja y se marca
 * procesado. Repetir el drenaje no reprocesa lo ya confirmado.
 */
export async function drainOutbox(
  outbox: Outbox,
  handle: (event: RecordedEvent) => Promise<void>,
  limit = 100,
): Promise<number> {
  const pending = await outbox.pending(limit);
  for (const message of pending) {
    await handle(message.event);
    await outbox.markProcessed(message.id);
  }
  return pending.length;
}
