import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { completeShot, createBullet, pullToDay, setCompletedCount, uncompleteShot } from './mutations';
import { groupCountedDayRows, type ShotRow } from './store';
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

describe('one card per day, no matter what', () => {
  /**
   * The screenshot bug: "TikToks · 5 of 5 parts" and "TikToks · 1 of 5 parts"
   * as two separate cards on Today.
   *
   * The fix is a RENDER rule, deliberately: the data layer holds per-writer
   * rows (folding amounts across rows under field-LWW is how recorded work
   * gets erased by a concurrent write), and the store groups a day's rows into
   * one card per state. So these assert what the user sees — grouped cards —
   * and that the amounts always conserve.
   */
  const cards = async (id: string, state: 'open' | 'done') => {
    const bullet = await read(id);
    const rows: ShotRow[] = (await shotsOf(id))
      .filter(s => s.scope === 'day' && s.state === state)
      .map(shot => ({ shot, bullet }));
    return groupCountedDayRows(rows);
  };
  const openDayShots = (id: string) => cards(id, 'open');
  const doneDayShots = (id: string) => cards(id, 'done');

  it('never shows two open cards after adjusting the count', async () => {
    const id = await createBullet({ title: 'TikToks', count: { total: 5, unit: 'parts' } });
    await pullToDay(id, todayFn(), 5);

    // Up, down, up — the sequence that minted cards.
    await setCompletedCount(id, 2);
    await setCompletedCount(id, 1);
    await setCompletedCount(id, 3);

    expect((await openDayShots(id)).length).toBeLessThanOrEqual(1);
    expect((await doneDayShots(id)).length).toBeLessThanOrEqual(1);
    expect((await progress(id)).done).toBe(3);
  });

  it('handles the shot "Do today" creates, which has no amount at all', async () => {
    // pullToDay without an amount claims "the whole thing" as one undefined-
    // amount shot. The last fix was only ever tested with explicit amounts.
    const id = await createBullet({ title: 'TikToks', count: { total: 5, unit: 'parts' } });
    await pullToDay(id, todayFn());

    await setCompletedCount(id, 1);

    expect((await progress(id)).done).toBe(1);
    expect((await read(id)).state).toBe('open');
    const opens = await openDayShots(id);
    expect(opens.length).toBe(1);
    // "The whole thing" means the remainder: 4 parts still claimed for today,
    // so the card STAYS on Today instead of vanishing at 1 of 5.
    expect(opens[0].shot.amount).toBe(4);
    expect((await doneDayShots(id)).length).toBe(1);
  });

  it('walks the dots up and down without ever growing the row count', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 8, unit: 'posts' } });
    await pullToDay(id, todayFn(), 8);

    for (const n of [1, 3, 2, 5, 4, 8, 3, 0, 6]) {
      await setCompletedCount(id, n);
      expect((await progress(id)).done).toBe(n);
      const opens = await openDayShots(id);
      const dones = await doneDayShots(id);
      expect(opens.length).toBeLessThanOrEqual(1);
      expect(dones.length).toBeLessThanOrEqual(1);
      // And the day never claims more than the total.
      const claimed =
        opens.reduce((a, r) => a + (r.shot.amount ?? 1), 0) +
        dones.reduce((a, r) => a + (r.shot.amount ?? 1), 0);
      expect(claimed).toBeLessThanOrEqual(8);
    }
  });

  it('heals data the old code already broke', async () => {
    // Clark's phone genuinely holds this shape. The reconciler must repair it
    // on the next touch rather than leave the duplicate cards forever.
    const id = await createBullet({ title: 'TikToks', count: { total: 5, unit: 'parts' } });
    await pullToDay(id, todayFn(), 5);
    // A second open shot on the same day, exactly what the buggy split minted.
    await pullToDay(id, todayFn(), 1);

    await setCompletedCount(id, 1);

    expect((await openDayShots(id)).length).toBeLessThanOrEqual(1);
    expect((await progress(id)).done).toBe(1);
  });
});

describe('the swipe round trip', () => {
  const cards = async (id: string, state: 'open' | 'done') => {
    const bullet = await read(id);
    const rows: ShotRow[] = (await shotsOf(id))
      .filter(s => s.scope === 'day' && s.state === state)
      .map(shot => ({ shot, bullet }));
    return groupCountedDayRows(rows);
  };

  it('swipe finishes the day as one card and never over-logs', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 5, unit: 'posts' } });
    await pullToDay(id, todayFn(), 5);
    await setCompletedCount(id, 2); // open 3 / done 2

    const open = (await cards(id, 'open'))[0];
    await completeShot(open.shot.id);

    expect((await cards(id, 'done')).length).toBe(1);
    expect((await progress(id)).done).toBe(5);
    expect((await read(id)).state).toBe('done');
  });

  it('un-tapping after a swipe restores the pre-swipe count, not zero', async () => {
    /**
     * The round trip that used to erase work: dots to 2, swipe (finishes the
     * remaining 3), then tap the struck card. The un-tap must give back what
     * THE SWIPE recorded — the done representative is the newest row, which is
     * exactly the swipe's — leaving the 2 parts recorded before it intact.
     */
    const id = await createBullet({ title: 'Posts', count: { total: 5, unit: 'posts' } });
    await pullToDay(id, todayFn(), 5);
    await setCompletedCount(id, 2);

    const open = (await cards(id, 'open'))[0];
    await completeShot(open.shot.id);
    expect((await progress(id)).done).toBe(5);

    const done = (await cards(id, 'done'))[0];
    await uncompleteShot(done.shot.id);

    expect((await progress(id)).done).toBe(2);
    expect((await read(id)).state).toBe('open');
    expect((await cards(id, 'open')).length).toBe(1);
  });

  it('swiping the whole-thing card logs the remainder, not one part', async () => {
    // "Do today" creates an undefined-amount claim; swiping it is the app's
    // signature gesture and must record all five, not 1.
    const id = await createBullet({ title: 'Posts', count: { total: 5, unit: 'posts' } });
    await pullToDay(id, todayFn());

    const open = (await cards(id, 'open'))[0];
    await completeShot(open.shot.id);

    expect((await progress(id)).done).toBe(5);
    expect((await read(id)).state).toBe('done');
  });
});
