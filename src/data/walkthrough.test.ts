import { describe, it, expect, beforeEach } from 'vitest';
import { db, ENTITY_TABLES } from './db';
import { completeBullet, createBullet, reopenBullet, setActor } from './mutations';
import { surfacesFor } from './selectors';
import { today } from '../lib/dates';
import type { Bullet, Shot } from './types';

beforeEach(async () => {
  await Promise.all([...ENTITY_TABLES.map(t => t.clear()), db.outbox.clear()]);
  setActor('clark');
});

describe("Clark's exact sequence", () => {
  it('mark done then reopen behaves predictably at every step', async () => {
    const t = today();
    const snap = async (label: string, id: string) => {
      const b = (await db.bullets.get(id)) as unknown as Bullet;
      const shots = (await db.shots.where('bulletId').equals(id).toArray())
        .filter(s => !s.deletedAt) as unknown as Shot[];
      const kids = (await db.bullets.where('parentId').equals(id).toArray())
        .filter(k => !k.deletedAt) as unknown as Bullet[];
      return {
        label,
        state: b.state,
        horizon: b.horizon,
        openShots: shots.filter(s => s.state === 'open').length,
        children: `${kids.filter(k => k.state === 'done').length}/${kids.length} done`,
        visibleIn: surfacesFor(b, shots, t),
      };
    };

    const id = await createBullet({ title: 'PROBE deck', horizon: 'next' });
    for (let i = 0; i < 5; i++) await createBullet({ title: `piece ${i}`, parentId: id });
    const s1 = await snap('1. created, 5 pieces, NEXT', id);

    await completeBullet(id);
    const s2 = await snap('2. Mark done', id);

    await reopenBullet(id);
    const s3 = await snap('3. Reopen', id);

    console.log(JSON.stringify([s1, s2, s3], null, 1));

    // Marking done completes the pieces, so nothing can flip it back.
    expect(s2.state).toBe('done');
    expect(s2.children).toBe('5/5 done');
    // Reopening sticks, and leaves it findable — including by the Daily Pull.
    expect(s3.state).toBe('open');
    expect(s3.visibleIn.length).toBeGreaterThan(0);
    expect(s3.visibleIn).toContain('dailyPull');
  });
});
