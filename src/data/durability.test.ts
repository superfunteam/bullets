import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { createBullet, mutate, setTitle } from './mutations';

/**
 * "Nothing should get lost, make sure all data is always accounted for at a
 * server level."
 *
 * Every local write must be queued for the server in the SAME transaction that
 * materialises it. They used to be two commits — applyLocal over the entity
 * tables, then enqueue over the outbox — so an app killed in between kept the
 * change locally with no op queued. It looked saved, survived a reload, and
 * never reached the server or the other device, and nothing reported it because
 * from the app's point of view there was nothing outstanding.
 *
 * These tests fail the queue write on purpose. If the entity write survives
 * that, the atomicity is gone.
 */

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
});

describe('every write is accounted for', () => {
  it('rolls the local change back when the op cannot be queued', async () => {
    const id = await createBullet({ title: 'Halcyon rebrand deck' });
    await db.outbox.clear();

    const before = await db.bullets.get(id);
    expect((before as { title?: string } | undefined)?.title).toBe('Halcyon rebrand deck');

    // Simulate the queue write failing mid-transaction.
    const spy = vi.spyOn(db.outbox, 'bulkPut').mockRejectedValueOnce(new Error('disk full'));
    await expect(setTitle(id, 'Renamed')).rejects.toThrow();
    spy.mockRestore();

    const after = await db.bullets.get(id);
    // The rename must NOT be visible locally, because it was never queued.
    // A change the server will never hear about is worse than no change.
    expect((after as { title?: string } | undefined)?.title).toBe('Halcyon rebrand deck');
    expect(await db.outbox.count()).toBe(0);
  });

  it('queues exactly one op per changed field', async () => {
    const id = await createBullet({ title: 'A' });
    await db.outbox.clear();

    await mutate('bullet', id, { title: 'B', note: 'hello' });

    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(2);
    expect(queued.map(o => o.field).sort()).toEqual(['note', 'title']);
    // Same user action, so the ops share a timestamp — that is what a history
    // grouping key can hang off later.
    expect(new Set(queued.map(o => o.ts)).size).toBe(1);
  });

  it('queues nothing when a write changes nothing', async () => {
    const id = await createBullet({ title: 'A' });
    await db.outbox.clear();

    await mutate('bullet', id, { title: 'A' });

    expect(await db.outbox.count()).toBe(0);
  });

  it('leaves every op queued until the server acknowledges it', async () => {
    const a = await createBullet({ title: 'One' });
    const b = await createBullet({ title: 'Two' });
    await setTitle(a, 'One renamed');

    // Nothing has been acked, so every op is still outstanding and countable.
    const queued = await db.outbox.toArray();
    expect(queued.length).toBeGreaterThan(0);
    const ids = new Set(queued.map(o => o.entityId));
    expect(ids.has(a)).toBe(true);
    expect(ids.has(b)).toBe(true);
    // opIds are unique, so the server's `on conflict (op_id) do nothing` makes
    // a retry idempotent rather than duplicating work.
    expect(new Set(queued.map(o => o.opId)).size).toBe(queued.length);
  });
});
