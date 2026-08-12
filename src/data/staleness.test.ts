import { describe, it, expect, beforeEach } from 'vitest';
import { db, ENTITY_TABLES } from './db';
import { completeShot, createBullet, completeBullet, reopenBullet, pullToDay, pullToWeek, setActor } from './mutations';
import { surfacesFor } from './selectors';
import { today, addDays, weekStart } from '../lib/dates';
import type { Bullet, Shot } from './types';

const bulletOf = async (id: string) => (await db.bullets.get(id)) as unknown as Bullet;
const shotsOf = async (id: string) =>
  ((await db.shots.where('bulletId').equals(id).toArray()).filter(s => !s.deletedAt) as unknown as Shot[]);
const where = async (id: string) => surfacesFor(await bulletOf(id), await shotsOf(id), today());

beforeEach(async () => {
  await Promise.all([...ENTITY_TABLES.map(t => t.clear()), db.outbox.clear()]);
  setActor('clark');
});

// Objections raised against docs/state-model.md by an adversarial review.
// Each is written as the scenario it describes; whichever fail are real.

describe('objection 1: a commitment goes stale with the clock', () => {
  it('a week commitment from last week still leaves the bullet findable', async () => {
    const id = await createBullet({ title: 'Stale week', horizon: 'shelf' });
    await pullToWeek(id, today());
    // Rewrite the shot into last week, as the passage of time would.
    const shot = (await shotsOf(id))[0];
    await db.shots.update(shot.id, { date: weekStart(addDays(today(), -7)) } as never);
    expect(await where(id), 'invisible once its week passed').not.toHaveLength(0);
  });

  it('a day commitment from last week still leaves the bullet findable', async () => {
    const id = await createBullet({ title: 'Stale day', horizon: 'shelf' });
    await pullToDay(id, today());
    const shot = (await shotsOf(id))[0];
    await db.shots.update(shot.id, { date: addDays(today(), -9) } as never);
    expect(await where(id), 'invisible once its day passed').not.toHaveLength(0);
  });
});

describe('objection 2: hitting a shot that does not finish the bullet', () => {
  it('leaves a counted bullet findable', async () => {
    const id = await createBullet({ title: '20 posts', count: { total: 20, unit: 'posts' }, horizon: 'shelf' });
    await pullToDay(id, today(), 5);
    await completeShot((await shotsOf(id))[0].id);

    expect((await bulletOf(id)).state).toBe('open');
    expect(await where(id), '15 posts left but findable nowhere').not.toHaveLength(0);
  });
});

describe('objection 4: a child added to a finished parent', () => {
  it('reopens the parent so the new piece is reachable', async () => {
    const parent = await createBullet({ title: 'Parent', horizon: 'shelf' });
    const a = await createBullet({ title: 'A', parentId: parent });
    await completeBullet(a);
    expect((await bulletOf(parent)).state).toBe('done');

    await createBullet({ title: 'A sixth thing', parentId: parent });

    expect((await bulletOf(parent)).state, 'parent stayed done with open work inside').toBe('open');
    expect(await where(parent), 'new work exists but is reachable from nowhere').not.toHaveLength(0);
  });
});

describe('objection 5: a parent that can never be finished again', () => {
  it('can be marked done after reopening with all children already done', async () => {
    const parent = await createBullet({ title: 'Parent', horizon: 'shelf' });
    for (let i = 0; i < 3; i++) await createBullet({ title: `p${i}`, parentId: parent });
    await completeBullet(parent);
    await reopenBullet(parent);

    await completeBullet(parent);
    expect((await bulletOf(parent)).state, 'stuck open forever').toBe('done');
  });
});
