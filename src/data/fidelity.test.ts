import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import {
  __resetClockForTests,
  createBullet,
  mutate,
  rollForwardNow,
  setTitle,
  settleFromOps,
  healPoisonedClocks,
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
  // Per-test clock isolation: the skew one test legitimately absorbs would
  // otherwise inflate every later test's writes.
  __resetClockForTests();
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

describe('poisoned timestamps cannot lock a field forever', () => {
  /**
   * Straight from production. "Call Ant Guy" carried a `state: "open"` op
   * stamped 10000000000025 — the year 2286 — so all SIX later "done" writes,
   * four from Clark and two from Angie, lost last-write-wins to it. The task
   * could not be marked done by anyone, on any device, ever.
   */
  const POISON = 10_000_000_000_025;

  it('a real write beats a year-2286 write', async () => {
    const id = await createBullet({ title: 'Call Ant Guy' });

    await applyLocal([
      {
        opId: 'poison:0',
        entity: 'bullet',
        entityId: id,
        field: 'state',
        value: 'open',
        ts: POISON,
        actor: 'clark',
      },
    ]);

    // An honest completion, stamped now.
    await applyLocal([
      {
        opId: 'honest:0',
        entity: 'bullet',
        entityId: id,
        field: 'state',
        value: 'done',
        ts: Date.now(),
        actor: 'angie',
      },
    ]);

    expect((await read(id)).state).toBe('done');
  });

  it('refuses to adopt an absurd clock, so the poison cannot spread', async () => {
    const id = await createBullet({ title: 'Victim' });
    await applyLocal([
      {
        opId: 'poison:1',
        entity: 'bullet',
        entityId: id,
        field: 'title',
        value: 'Poisoned',
        ts: POISON,
        actor: 'clark',
      },
    ]);

    // The next local write must be stamped from the real clock. Before this,
    // observeTs absorbed the 2286 stamp and every subsequent write on the
    // device was dated 2286 — outranking every honest write on both phones.
    await setTitle(id, 'Written now');
    const row = (await db.bullets.get(id))!;
    expect(row._ts.title).toBeLessThan(Date.now() + 60_000);
    expect((await read(id)).title).toBe('Written now');
  });

  it('an absurd op cannot overwrite a sane one', async () => {
    const id = await createBullet({ title: 'Real title' });
    await applyLocal([
      {
        opId: 'poison:2',
        entity: 'bullet',
        entityId: id,
        field: 'title',
        value: 'From 2286',
        ts: POISON,
        actor: 'angie',
      },
    ]);
    expect((await read(id)).title).toBe('Real title');
  });
});

describe('a completion that lost still lands', () => {
  it('repairs an open bullet whose every shot is done', async () => {
    // The production shape: three done day shots, bullet stuck open because
    // its state field was pinned by a poisoned timestamp.
    const id = await createBullet({ title: 'Call Ant Guy', horizon: 'now' });
    const shots = await shotsOf(id);
    for (const s of shots) await mutate('shot', s.id, { state: 'done' });
    await mutate('bullet', id, { state: 'open' });

    await settleFromOps([
      {
        opId: 'touch:0',
        entity: 'bullet',
        entityId: id,
        field: 'state',
        value: 'open',
        ts: Date.now(),
        actor: 'clark',
      },
    ]);

    expect((await read(id)).state).toBe('done');
  });
});

describe('healing rows already poisoned', () => {
  const POISON = 10_000_000_000_025;

  it('un-pins a stuck field and re-derives the truth', async () => {
    /**
     * The state two devices actually diverged on: the row is ALREADY
     * materialized with a year-2286 clock, and no further op is coming for it
     * — the cursor is long past. applyOp's absurd-loses rule decides future
     * ops and does nothing here, so without an active heal the device shows
     * the wrong status forever while the other device shows the right one.
     */
    const id = await createBullet({ title: 'Call Ant Guy', horizon: 'now' });
    for (const s of await shotsOf(id)) await mutate('shot', s.id, { state: 'done' });

    /**
     * Written STRAIGHT to the table, not through applyOp: the new rule blocks
     * a poisoned op from landing at all, so this is the only way to reproduce
     * what a device poisoned BEFORE the fix already holds on disk — which is
     * precisely the case the heal exists for.
     */
    const rec = (await db.bullets.get(id))!;
    await db.bullets.put({
      ...rec,
      state: 'open',
      _ts: { ...rec._ts, state: POISON },
      _op: { ...rec._op, state: 'poison:state' },
    } as never);
    expect((await read(id)).state).toBe('open');

    const healed = await healPoisonedClocks();

    expect(healed).toBeGreaterThan(0);
    expect((await read(id)).state).toBe('done');
    // And the clock is real again, so the field is editable by anyone.
    const row = (await db.bullets.get(id))!;
    expect(row._ts.state).toBeLessThan(Date.now() + 60_000);
  });

  it('un-pins a poisoned field without inventing a new value', async () => {
    const id = await createBullet({ title: 'Real title' });
    const rec = (await db.bullets.get(id))!;
    await db.bullets.put({
      ...rec,
      title: 'Pinned title',
      _ts: { ...rec._ts, title: POISON },
      _op: { ...rec._op, title: 'poison:title' },
    } as never);

    await healPoisonedClocks();

    const row = (await db.bullets.get(id))!;
    expect(row._ts.title).toBeLessThan(Date.now() + 60_000);
    // The value it was pinned at is preserved; only the clock is repaired, so
    // a later edit from either device can win normally.
    await setTitle(id, 'Edited after heal');
    expect((await read(id)).title).toBe('Edited after heal');
  });
});
