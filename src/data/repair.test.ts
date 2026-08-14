import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  completeBullet,
  completeShot,
  createBullet,
  deleteBullet,
  pullToDay,
  reopenBullet,
  settleFromOps,
  unpull,
} from './mutations';
import { clean } from './ops';
import { today as todayFn } from '../lib/dates';
import type { Bullet, Shot } from './types';

/**
 * Two-device races produce merged states no single device would ever write —
 * each field lands correctly, the combination is nonsense, and before
 * repairMerged nothing ever looked at it again. These tests build the exact
 * merged rows the races produce and assert the repair pass converges them.
 *
 * settleFromOps is what both devices run after peer ops land, so calling it
 * with ops naming the touched entities IS the sync-arrival simulation.
 */

const read = async (id: string) => clean<Bullet>((await db.bullets.get(id))!);
const shotsOf = async (id: string) => {
  const rows = await db.shots.where('bulletId').equals(id).toArray();
  return rows.map(r => clean<Shot>(r));
};
const live = async (id: string) => (await shotsOf(id)).filter(s => !s.deletedAt);

const touch = (bulletId: string) =>
  settleFromOps([
    { opId: 'x:0', entity: 'bullet', entityId: bulletId, field: 'state', value: 'x', ts: 1, actor: 'clark' },
  ]);

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
});

describe('repairMerged', () => {
  it('a done+deleted shot keeps the work: Take off today racing a swipe', async () => {
    const id = await createBullet({ title: 'Site copy', horizon: 'now' });
    const s = (await live(id)).find(x => x.state === 'open')!;

    // Device B swiped it done; device A's stale "Take off today" tombstoned it.
    await completeShot(s.id);
    await db.shots.update(s.id, { deletedAt: Date.now() } as never);

    await touch(id);

    const after = (await live(id)).filter(x => x.state === 'done');
    // The tombstone lost: the record of finished work survives.
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect((await read(id)).state).toBe('done');
  });

  it('a done bullet with a live open shot converges: roll-forward racing completion', async () => {
    const id = await createBullet({ title: 'Ant Guy', horizon: 'now' });
    // Device B completed it overnight.
    await completeBullet(id);
    // Device A's morning roll-forward, unaware, minted a fresh open row.
    await db.shots.put({
      id: `carry-${id}-${todayFn()}`,
      bulletId: id,
      scope: 'day',
      date: todayFn(),
      state: 'open',
      sortKey: 'a5',
      // Real rows are materialized through applyOp and always carry the
      // per-field clock; a bare put without it crashes the next fold.
      _ts: {},
      _op: {},
    } as never);

    await touch(id);

    // The phantom open card became the Done record instead of a resurrection.
    const opens = (await live(id)).filter(s => s.state === 'open');
    expect(opens.length).toBe(0);
    expect((await read(id)).state).toBe('done');
  });

  it('a done parent with an open child reconsiders: un-check racing completion', async () => {
    const p = await createBullet({ title: 'Q3 launch' });
    const c = await createBullet({ title: 'Deck', parentId: p });
    await completeBullet(p);
    expect((await read(c)).state).toBe('done');

    // Peer un-checked the piece; merged state: done parent, open child.
    await db.bullets.update(c, { state: 'open' } as never);
    await touch(c);

    // The doctrine already existed: a child transition reopens the parent.
    expect((await read(p)).state).toBe('open');
  });
});

describe('single-device holes the same sweep closed', () => {
  it('unpull refuses to tombstone finished work', async () => {
    const id = await createBullet({ title: 'Site copy', horizon: 'now' });
    const s = (await live(id)).find(x => x.state === 'open')!;
    await completeShot(s.id);

    await unpull(s.id);

    expect((await live(id)).some(x => x.state === 'done')).toBe(true);
  });

  it('Bring it back days later lands on today, once', async () => {
    const id = await createBullet({ title: 'Site copy', horizon: 'now' });
    const s = (await live(id)).find(x => x.state === 'open')!;
    // Completed on a past day.
    await db.shots.update(s.id, { date: '2026-08-10' } as never);
    await completeShot(s.id);

    await reopenBullet(id);

    const opens = (await live(id)).filter(x => x.state === 'open' && x.scope === 'day');
    // Re-dated to today and reused — not an open card stranded on Monday plus
    // a fresh mint for today.
    expect(opens.length).toBe(1);
    expect(opens[0].date).toBe(todayFn());
  });

  it('reopening a parent flips its own struck card back', async () => {
    const p = await createBullet({ title: 'Q3 launch', horizon: 'now' });
    await createBullet({ title: 'Deck', parentId: p });
    await completeBullet(p);

    await reopenBullet(p);

    const opens = (await live(p)).filter(x => x.state === 'open' && x.scope === 'day');
    // One open card — not a struck card plus a freshly minted twin.
    expect(opens.length).toBe(1);
  });

  it('deleting the last open piece rolls the parent up', async () => {
    const p = await createBullet({ title: 'Q3 launch' });
    const c1 = await createBullet({ title: 'Deck', parentId: p });
    const c2 = await createBullet({ title: 'Copy', parentId: p });
    await completeBullet(c1);

    await deleteBullet(c2);

    expect((await read(p)).state).toBe('done');
  });

  it('two roll-forward twins share one deterministic row', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 10, unit: 'posts' } });
    await pullToDay(id, '2026-08-10', 3);
    // Both devices retire the stale row and write carry-<id>-<today>: the ids
    // collide by construction, so LWW converges on ONE row, not twins that
    // double the claim.
    const { rollForwardNow } = await import('./mutations');
    await rollForwardNow();
    await rollForwardNow();

    const opens = (await live(id)).filter(s => s.state === 'open' && s.date === todayFn());
    expect(opens.length).toBe(1);
    expect(opens[0].amount).toBe(3);
    expect(opens[0].id).toBe(`carry-${id}-${todayFn()}`);
  });
});
