import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { enqueue, pending, ack } from './outbox';
import type { Op } from './ops';

let clock = 1000;
const op = (id: string): Op => ({
  opId: id,
  entity: 'bullet',
  entityId: 'b1',
  field: 'title',
  value: id,
  ts: clock++,
  actor: 'clark',
});

beforeEach(async () => {
  clock = 1000;
  await db.outbox.clear();
});

describe('outbox', () => {
  it('holds enqueued ops until they are acked', async () => {
    await enqueue([op('a'), op('b')]);
    expect((await pending()).map(o => o.opId)).toEqual(['a', 'b']);
  });

  it('drops only the acked ops', async () => {
    await enqueue([op('a'), op('b')]);
    await ack(['a']);
    expect((await pending()).map(o => o.opId)).toEqual(['b']);
  });

  it('keeps ops enqueued while a send was in flight', async () => {
    await enqueue([op('a')]);
    const inFlight = await pending();
    await enqueue([op('b')]); // arrives mid-send
    await ack(inFlight.map(o => o.opId));
    expect((await pending()).map(o => o.opId)).toEqual(['b']);
  });

  it('is idempotent when the same op is enqueued twice', async () => {
    await enqueue([op('a')]);
    await db.outbox.bulkPut([{ ...op('a'), ts: 1000 }]);
    expect(await db.outbox.count()).toBe(1);
  });
});
