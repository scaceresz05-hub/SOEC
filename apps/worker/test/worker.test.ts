import { describe, expect, it } from 'vitest';
import type { Outbox, OutboxMessage, RecordedEvent } from '@soec/contracts';
import { drainOutbox } from '../src/index';

function fakeEvent(id: string): RecordedEvent {
  return {
    eventId: id,
    streamId: 's',
    sequence: 1,
    organizationId: 'orgA' as RecordedEvent['organizationId'],
    actor: 'a' as RecordedEvent['actor'],
    type: 'X',
    payload: {},
    attribution: {
      source: 's',
      purpose: 'p',
      assumptions: [],
      claimType: 'observational',
      regime: 'empirical',
      uncertainty: 'none',
    },
    occurredAt: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    correlationId: 'c',
    causationId: null,
    idempotencyKey: null,
  };
}

class FakeOutbox implements Outbox {
  private messages: OutboxMessage[];
  constructor(count: number) {
    this.messages = Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      event: fakeEvent(`e${i}`),
    }));
  }
  async pending(limit: number): Promise<readonly OutboxMessage[]> {
    return this.messages.slice(0, limit);
  }
  async markProcessed(id: string): Promise<void> {
    this.messages = this.messages.filter((m) => m.id !== id);
  }
}

describe('Worker de outbox', () => {
  it('procesa los pendientes y los marca; un segundo drenaje no reprocesa', async () => {
    const outbox = new FakeOutbox(3);
    const handled: string[] = [];
    const n1 = await drainOutbox(outbox, async (e) => {
      handled.push(e.eventId);
    });
    expect(n1).toBe(3);
    expect(handled).toHaveLength(3);

    const n2 = await drainOutbox(outbox, async (e) => {
      handled.push(e.eventId);
    });
    expect(n2).toBe(0); // idempotente: nada que reprocesar
    expect(handled).toHaveLength(3);
  });
});
