import { describe, it, expect, beforeEach } from 'vitest';
import { db, ENTITY_TABLES } from './db';
import {
  completeBullet,
  createBullet,
  moveToHorizon,
  pullToDay,
  pullToWeek,
  reopenBullet,
  setActor,
  unpull,
} from './mutations';
import { surfacesFor } from './selectors';
import { today, weekStart } from '../lib/dates';
import { HORIZONS, type Bullet, type Horizon, type Shot } from './types';

/**
 * The state model (docs/state-model.md) as an executable check.
 *
 * Invariant 2 — every open, top-level bullet appears somewhere — is the rule
 * this app broke over and over, always the same way: a committing horizon with
 * no shot falls through every calendar (they render shots), the Shelf (it lists
 * only shelf/later) and both Pulls. Saved, syncing, unreachable.
 *
 * Enumerating the space is the point. Each individual case was easy to miss by
 * hand, which is exactly how they kept shipping.
 */

const bulletOf = async (id: string) => (await db.bullets.get(id)) as unknown as Bullet;
const shotsOf = async (id: string) =>
  ((await db.shots.where('bulletId').equals(id).toArray()).filter(
    s => !s.deletedAt,
  ) as unknown as Shot[]);

beforeEach(async () => {
  await Promise.all([...ENTITY_TABLES.map(t => t.clear()), db.outbox.clear(), db.meta.clear()]);
  setActor('clark');
});

describe('invariant 1 — a committing horizon always has a matching open shot', () => {
  for (const horizon of HORIZONS) {
    it(`holds after moving a fresh bullet to ${horizon.toUpperCase()}`, async () => {
      const id = await createBullet({ title: `A ${horizon} bullet`, horizon: 'shelf' });
      await moveToHorizon(id, horizon as Horizon);

      const shots = await shotsOf(id);
      const open = shots.filter(s => s.state === 'open');

      if (horizon === 'now') {
        expect(open.some(s => s.scope === 'day' && s.date === today())).toBe(true);
      } else if (horizon === 'next') {
        expect(open.some(s => s.scope === 'week' && s.date === weekStart(today()))).toBe(true);
      } else {
        // Uncommitted horizons must carry no open commitment.
        expect(open).toHaveLength(0);
      }
    });
  }

  it('holds after taking something off today', async () => {
    const id = await createBullet({ title: 'On today', horizon: 'now' });
    const shot = (await shotsOf(id))[0];
    await unpull(shot.id);
    await moveToHorizon(id, 'soon');

    const b = await bulletOf(id);
    expect(b.horizon).not.toBe('now');
    expect(surfacesFor(b, await shotsOf(id), today()).length).toBeGreaterThan(0);
  });
});

describe('invariant 2 — every open top-level bullet is reachable', () => {
  const shotSetups: { name: string; setup: (id: string) => Promise<void> }[] = [
    { name: 'no shots', setup: async () => {} },
    { name: 'open day shot today', setup: async id => void (await pullToDay(id, today())) },
    { name: 'open week shot this week', setup: async id => void (await pullToWeek(id, today())) },
  ];

  for (const horizon of HORIZONS) {
    for (const { name, setup } of shotSetups) {
      it(`${horizon.toUpperCase()} + ${name}`, async () => {
        const id = await createBullet({ title: `${horizon} / ${name}`, horizon: 'shelf' });
        await setup(id);
        // Set the horizon last so it is the state under test, whatever the
        // setup implied.
        await moveToHorizon(id, horizon as Horizon);

        const b = await bulletOf(id);
        if (b.state !== 'open') return;
        const where = surfacesFor(b, await shotsOf(id), today());
        expect(where, `${horizon} + ${name} is reachable from nowhere`).not.toHaveLength(0);
      });
    }
  }

  it('a counted bullet fully claimed but unfinished is still reachable', async () => {
    const id = await createBullet({ title: '20 posts', count: { total: 20, unit: 'posts' } });
    await pullToWeek(id, today(), 20);
    const b = await bulletOf(id);
    expect(surfacesFor(b, await shotsOf(id), today())).not.toHaveLength(0);
  });

  it('a reopened bullet is reachable again', async () => {
    const id = await createBullet({ title: 'Finish then undo', horizon: 'now' });
    await completeBullet(id);
    await reopenBullet(id);

    const b = await bulletOf(id);
    expect(b.state).toBe('open');
    expect(
      surfacesFor(b, await shotsOf(id), today()),
      'reopening left it open but findable from nowhere',
    ).not.toHaveLength(0);
  });
});

describe('the three shapes complete the way the model says', () => {
  it('Parent: Mark done completes the children rather than fighting them', async () => {
    const parent = await createBullet({ title: 'Five pieces', horizon: 'shelf' });
    for (let i = 0; i < 5; i++) {
      await createBullet({ title: `Piece ${i}`, parentId: parent });
    }

    await completeBullet(parent);

    const kids = (await db.bullets.where('parentId').equals(parent).toArray()) as unknown as Bullet[];
    expect(kids.every(k => k.state === 'done'), 'children left open').toBe(true);
    expect((await bulletOf(parent)).state).toBe('done');
  });

  it('Parent: marking done then reopening does not flip back to done', async () => {
    // The exact reported bug: it vanished, then reappeared, because explicit
    // state and derived state were two different rules fighting each other.
    const parent = await createBullet({ title: 'Five pieces', horizon: 'shelf' });
    for (let i = 0; i < 5; i++) {
      await createBullet({ title: `Piece ${i}`, parentId: parent });
    }
    await completeBullet(parent);
    await reopenBullet(parent);

    expect((await bulletOf(parent)).state).toBe('open');
  });

  it('Counted: Mark done finishes the remainder instead of setting a flag', async () => {
    const id = await createBullet({ title: '20 posts', count: { total: 20, unit: 'posts' } });
    await pullToDay(id, today(), 5);

    await completeBullet(id);

    const b = await bulletOf(id);
    expect(b.state).toBe('done');
    // Derived completion must agree, or the next recompute undoes it.
    const done = (await shotsOf(id))
      .filter(s => s.state === 'done')
      .reduce((n, s) => n + (s.amount ?? 1), 0);
    expect(done).toBeGreaterThanOrEqual(20);
  });
});
