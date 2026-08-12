import { describe, it, expect, beforeEach } from 'vitest';
import { db, ENTITY_TABLES } from './db';
import {
  completeBullet,
  completeShot,
  createBullet,
  pullToDay,
  reopenBullet,
  setActor,
  setCompletedCount,
} from './mutations';
import { stampOf, type Materialized } from './ops';
import { surfacesFor } from './selectors';
import { today, addDays } from '../lib/dates';
import type { Bullet, Shot } from './types';

const bulletOf = async (id: string) => (await db.bullets.get(id)) as unknown as Bullet;
const rawOf = async (id: string) => (await db.bullets.get(id)) as Materialized | undefined;
const shotsOf = async (id: string) =>
  ((await db.shots.where('bulletId').equals(id).toArray()).filter(
    s => !s.deletedAt,
  ) as unknown as Shot[]);

beforeEach(async () => {
  await Promise.all([...ENTITY_TABLES.map(t => t.clear()), db.outbox.clear()]);
  setActor('clark');
});

describe('completed history', () => {
  it('records who finished it and when', async () => {
    const id = await createBullet({ title: 'Ship it', horizon: 'shelf' });
    setActor('angie');
    await completeBullet(id);

    const stamp = stampOf(await rawOf(id), 'state');
    expect(stamp?.by, 'attribution lost').toBe('angie');
    expect(stamp?.at).toBeGreaterThan(0);
  });

  it('keeps the days work actually landed on', async () => {
    const id = await createBullet({ title: '8 posts', count: { total: 8, unit: 'posts' } });
    await pullToDay(id, addDays(today(), -2), 3);
    await pullToDay(id, today(), 5);
    for (const s of await shotsOf(id)) await completeShot(s.id);

    const log = (await shotsOf(id)).filter(s => s.state === 'done');
    expect(log).toHaveLength(2);
    expect(log.reduce((n, s) => n + (s.amount ?? 1), 0)).toBe(8);
    expect((await bulletOf(id)).state).toBe('done');
  });

  it('attributes the two people separately on the same bullet', async () => {
    const id = await createBullet({ title: 'Shared', count: { total: 2, unit: 'bits' } });
    setActor('clark');
    await setCompletedCount(id, 1);
    setActor('angie');
    await setCompletedCount(id, 2);

    expect(stampOf(await rawOf(id), 'state')?.by).toBe('angie');
    expect((await bulletOf(id)).state).toBe('done');
  });
});

describe('resurrection', () => {
  it('brings a finished bullet back somewhere findable', async () => {
    const id = await createBullet({ title: 'Back from the dead', horizon: 'now' });
    await completeBullet(id);
    expect((await bulletOf(id)).state).toBe('done');

    await reopenBullet(id);

    const b = await bulletOf(id);
    expect(b.state).toBe('open');
    // The whole point of the state model: reopening must not strand it.
    expect(surfacesFor(b, await shotsOf(id), today())).not.toHaveLength(0);
  });

  it('reopening a counted bullet leaves work outstanding again', async () => {
    const id = await createBullet({ title: '4 posts', count: { total: 4, unit: 'posts' } });
    await setCompletedCount(id, 4);
    expect((await bulletOf(id)).state).toBe('done');

    await reopenBullet(id);

    const done = (await shotsOf(id))
      .filter(s => s.state === 'done')
      .reduce((n, s) => n + (s.amount ?? 1), 0);
    expect(done, 'still at total, so it would just re-finish itself').toBeLessThan(4);
    expect((await bulletOf(id)).state).toBe('open');
  });

  it('a resurrected parent stays open rather than flipping back', async () => {
    const parent = await createBullet({ title: 'Parent', horizon: 'shelf' });
    for (let i = 0; i < 3; i++) await createBullet({ title: `p${i}`, parentId: parent });
    await completeBullet(parent);

    await reopenBullet(parent);

    expect((await bulletOf(parent)).state).toBe('open');
  });
});
