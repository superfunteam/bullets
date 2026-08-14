import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createBullet, pullToDay, setCompletedCount } from './mutations';
import { progressOf } from './selectors';
import { clean } from './ops';
import { today as todayFn } from '../lib/dates';
import type { Bullet, Shot } from './types';

/**
 * Finishing ONE part of a counted bullet.
 *
 * Progress is derived from completed shot amounts, so ticking one dot has to
 * finish exactly one part — even when the open commitment on the calendar
 * claims the whole lot, which is what a Daily Pull that took all five looks
 * like.
 */

const read = async (id: string) => {
  const rec = await db.bullets.get(id);
  return clean<Bullet>(rec!);
};

const shotsOf = async (id: string) => {
  const rows = await db.shots.where('bulletId').equals(id).toArray();
  return rows.map(r => clean<Shot>(r)).filter(s => !s.deletedAt);
};

const progress = async (id: string) => progressOf(await read(id), await shotsOf(id));

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
});

describe('a counted bullet, one part at a time', () => {
  it('finishes one part when the day already claims all five', async () => {
    const id = await createBullet({
      title: 'Slideshow batch',
      count: { total: 5, unit: 'parts' },
    });
    // The Daily Pull claimed the whole thing for today: one open shot, amount 5.
    await pullToDay(id, todayFn(), 5);

    await setCompletedCount(id, 1);

    // The bug: completing the open shot wholesale finished all five.
    expect((await progress(id)).done).toBe(1);
    expect((await read(id)).state).toBe('open');
  });

  it('walks up one part at a time', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 4, unit: 'posts' } });
    await pullToDay(id, todayFn(), 4);

    for (const n of [1, 2, 3]) {
      await setCompletedCount(id, n);
      expect((await progress(id)).done).toBe(n);
      expect((await read(id)).state).toBe('open');
    }

    await setCompletedCount(id, 4);
    expect((await progress(id)).done).toBe(4);
    // Only the last part finishes the bullet.
    expect((await read(id)).state).toBe('done');
  });

  it('leaves the rest of the day still claimed', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 5, unit: 'posts' } });
    await pullToDay(id, todayFn(), 5);
    await setCompletedCount(id, 2);

    const live = await shotsOf(id);
    const open = live.filter(s => s.state === 'open');
    const openAmount = open.reduce((n, s) => n + (s.amount ?? 1), 0);
    // Three still committed for today, not zero and not five.
    expect(openAmount).toBe(3);
  });

  it('takes a part back without dropping the others', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 5, unit: 'posts' } });
    await pullToDay(id, todayFn(), 5);
    await setCompletedCount(id, 3);
    await setCompletedCount(id, 2);

    expect((await progress(id)).done).toBe(2);
    expect((await read(id)).state).toBe('open');
  });

  it('still works when nothing is scheduled at all', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 3, unit: 'posts' } });
    await setCompletedCount(id, 1);
    expect((await progress(id)).done).toBe(1);
    expect((await read(id)).state).toBe('open');
  });
});
