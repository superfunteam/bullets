import { db } from './db';
import type { Op } from './ops';

/**
 * Durable queue of ops not yet accepted by the server. This is what makes
 * offline work without any special-case code: mutations always land here,
 * and the sync loop drains it whenever the network happens to be there.
 */
export async function enqueue(ops: Op[]): Promise<void> {
  await db.outbox.bulkPut(ops);
}

export async function pending(limit = 500): Promise<Op[]> {
  return db.outbox.orderBy('ts').limit(limit).toArray();
}

/**
 * Ack by explicit id, never by "clear everything". A mutation made while a
 * request is in flight would otherwise be dropped and silently never sync.
 */
export async function ack(opIds: string[]): Promise<void> {
  await db.outbox.bulkDelete(opIds);
}

export const outboxCount = (): Promise<number> => db.outbox.count();
