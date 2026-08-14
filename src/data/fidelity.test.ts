import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import {
  __resetClockForTests,
  createBullet,
  mutate,
  rollForwardNow,
  setTitle,
} from './mutations';
import { applyLocal } from './mutations';
import { clean } from './ops';
import { today as todayFn, weekStart } from '../lib/dates';
import type { Bullet, Shot } from './types';

/**
 * The data-fidelity pass: saving a task and seeing it complete must survive
 * app kills, restarts, clock skew, and sleeping devices.
 */

const read = async (id: string) => clean<Bullet>((await db.bullets.get(id))!);
const shotsOf = async (id: string) =>
  (await db.shots.where('bulletId').equals(id).toArray())
    .map(r => clean<Shot>(r))
    .filter(s => !s.deletedAt);

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
});

describe('crash-safe capture ordering', () => {
  it('commits the shot before the bullet', async () => {
    /**
     * A kill between the two commits must leave the INVISIBLE half. The old
     * order left a committed NEXT bullet with no shot — saved, synced, and on
     * no list at all until a Weekly Pull. The new order leaves an orphan shot:
     * inert, filtered out of every row build, harmless.
     */
    const spy = vi.spyOn(db.bullets, 'orderBy').mockImplementationOnce(() => {
      throw new Error('killed between commits');
    });
    await expect(createBullet({ title: 'Doomed', horizon: 'next' })).rejects.toThrow();
    spy.mockRestore();

    // The bullet never materialised…
    expect(await db.bullets.count()).toBe(0);
    // …and what leaked is an orphan shot no view will ever render.
    const orphans = await db.shots.toArray();
    for (const o of orphans) {
      expect(await db.bullets.get(clean<Shot>(o).bulletId)).toBeUndefined();
    }
  });

  it('a healthy capture still lands whole', async () => {
    const id = await createBullet({ title: 'Fine', horizon: 'next' });
    const shots = await shotsOf(id);
    expect(shots).toHaveLength(1);
    expect(shots[0].scope).toBe('week');
  });
});

describe('the NEXT safety net', () => {
  it('re-arms a shotless NEXT bullet on roll-forward, deterministically', async () => {
    // The shape an interrupted capture used to leave — possibly synced to
    // both devices. The heal row's id is stable so concurrent devices
    // converge on one row instead of minting twins.
    const id = await createBullet({ title: 'Stranded' });
    await mutate('bullet', id, { horizon: 'next' });

    await rollForwardNow();
    await rollForwardNow();

    const shots = await shotsOf(id);
    expect(shots).toHaveLength(1);
    expect(shots[0].scope).toBe('week');
    expect(shots[0].id).toBe(`carry-week-${id}-${weekStart(todayFn())}`);
  });
});

describe('the clock survives a restart', () => {
  it('reseeds above every timestamp this device has observed', async () => {
    const id = await createBullet({ title: 'Skewed' });

    // A peer op stamped from a fast clock, applied here.
    const future = Date.now() + 5 * 60_000;
    await applyLocal([
      {
        opId: 'peer:0',
        entity: 'bullet',
        entityId: id,
        field: 'title',
        value: 'Peer title',
        ts: future,
        actor: 'angie',
      },
    ]);

    /**
     * The restart the bug needs: the in-memory clock forgets everything.
     * observeTs had already absorbed the peer's future ts, so WITHOUT a
     * restart the next tap wins regardless — only a fresh module exhibits the
     * loss. The reset puts the module in the fresh-boot state; the next
     * mutate's backstop then reseeds from history, whose max ts recorded the
     * peer op in the same transaction as its entity write.
     */
    __resetClockForTests();
    await setTitle(id, 'Post-restart tap');

    /**
     * The tap must WIN. Before the reseed it was stamped plain Date.now(),
     * lost the LWW comparison against the future ts, did not render locally,
     * and was discarded identically on the peer — tap, nothing happens, for
     * the width of the skew.
     */
    expect((await read(id)).title).toBe('Post-restart tap');
  });
});
