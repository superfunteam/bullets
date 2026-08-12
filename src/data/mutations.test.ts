import { describe, it, expect, beforeEach } from 'vitest';
import { db, ENTITY_TABLES } from './db';
import {
  addHuddleItem,
  callHuddle,
  callOff,
  completeShot,
  createBullet,
  decideItem,
  pullToDay,
  pullToWeek,
  respondToHuddle,
  setActor,
  undecideItem,
  setHorizon,
  shelve,
  uncompleteShot,
  wrapHuddle,
} from './mutations';
import { pending } from './outbox';
import type { Bullet, Huddle, Shot } from './types';

const bulletOf = async (id: string) =>
  (await db.bullets.get(id)) as unknown as Bullet;
const shotsOf = async (bulletId: string) =>
  (await db.shots.where('bulletId').equals(bulletId).toArray())
    .filter(s => !s.deletedAt) as unknown as Shot[];

beforeEach(async () => {
  await Promise.all([...ENTITY_TABLES.map(t => t.clear()), db.outbox.clear(), db.meta.clear()]);
  setActor('clark');
});

describe('bullets', () => {
  it('creates a bullet and records an op per field set', async () => {
    const id = await createBullet({ title: 'Ship the deck', horizon: 'shelf' });
    expect((await bulletOf(id)).title).toBe('Ship the deck');

    const fields = (await pending()).map(o => o.field);
    expect(fields).toContain('title');
    expect(fields).toContain('horizon');
    expect(fields).toContain('state');
  });

  it('defaults a new bullet to the shelf', async () => {
    const id = await createBullet({ title: 'Someday' });
    expect((await bulletOf(id)).horizon).toBe('shelf');
  });

  it('routes every mutation through the outbox', async () => {
    const id = await createBullet({ title: 'X' });
    const before = (await pending()).length;
    await setHorizon(id, 'next');
    expect((await pending()).length).toBeGreaterThan(before);
  });

  it('calls off a bullet rather than deleting it', async () => {
    const id = await createBullet({ title: 'Nope' });
    await callOff(id);
    const b = await bulletOf(id);
    expect(b.state).toBe('dropped');
    expect(b.deletedAt).toBeUndefined();
  });
});

describe('the Pull', () => {
  it('promotes horizon to now when pulled onto a day', async () => {
    const id = await createBullet({ title: 'X', horizon: 'shelf' });
    await pullToDay(id, '2026-08-12');
    expect((await bulletOf(id)).horizon).toBe('now');
  });

  it('promotes horizon to next when pulled into a week', async () => {
    const id = await createBullet({ title: 'X', horizon: 'shelf' });
    await pullToWeek(id, '2026-08-12');
    expect((await bulletOf(id)).horizon).toBe('next');
  });

  it('snaps a week shot to the Monday of that week', async () => {
    const id = await createBullet({ title: 'X' });
    await pullToWeek(id, '2026-08-12'); // a Wednesday
    expect((await shotsOf(id))[0].date).toBe('2026-08-10');
  });

  it('creates exactly one day-scoped shot per pull', async () => {
    const id = await createBullet({ title: 'X' });
    await pullToDay(id, '2026-08-12');
    const shots = await shotsOf(id);
    expect(shots).toHaveLength(1);
    expect(shots[0].scope).toBe('day');
    expect(shots[0].date).toBe('2026-08-12');
  });

  it('clears commitments when a bullet is shelved', async () => {
    const id = await createBullet({ title: 'X' });
    await pullToDay(id, '2026-08-12');
    await shelve(id);
    expect(await shotsOf(id)).toHaveLength(0);
    expect((await bulletOf(id)).horizon).toBe('shelf');
  });
});

describe('completion rollup', () => {
  it('completes an uncounted bullet when its only shot is hit', async () => {
    const id = await createBullet({ title: 'X' });
    await pullToDay(id, '2026-08-12');
    await completeShot((await shotsOf(id))[0].id);
    expect((await bulletOf(id)).state).toBe('done');
  });

  it('leaves a counted bullet open after a partial shot', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 20, unit: 'posts' } });
    await pullToDay(id, '2026-08-12', 3);
    await completeShot((await shotsOf(id))[0].id);
    expect((await bulletOf(id)).state).toBe('open');
  });

  it('completes a counted bullet once its shots reach the total', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 8, unit: 'posts' } });
    await pullToDay(id, '2026-08-12', 3);
    await pullToDay(id, '2026-08-13', 5);
    for (const s of await shotsOf(id)) await completeShot(s.id);
    expect((await bulletOf(id)).state).toBe('done');
  });

  it('reopens the bullet when a completed shot is undone', async () => {
    const id = await createBullet({ title: 'X' });
    await pullToDay(id, '2026-08-12');
    const shot = (await shotsOf(id))[0];
    await completeShot(shot.id);
    await uncompleteShot(shot.id);
    expect((await bulletOf(id)).state).toBe('open');
  });
});

describe('huddles', () => {
  it('auto-confirms both people with no accept step', async () => {
    const id = await callHuddle({ startsAt: Date.now() + 3_600_000, calledBy: 'angie' });
    const h = (await db.huddles.get(id)) as unknown as Huddle;
    expect(h.status).toBe('scheduled');
    expect(h.responses.angie?.status).toBe('in');
    expect(h.responses.clark?.status).toBe('in');
  });

  it('keeps the huddle scheduled when one person nudges', async () => {
    const id = await callHuddle({ startsAt: Date.now() + 3_600_000, calledBy: 'angie' });
    await respondToHuddle(id, { status: 'nudge', note: 'mid-flow', proposedAt: Date.now() + 7_200_000 }, 'clark');
    const h = (await db.huddles.get(id)) as unknown as Huddle;
    expect(h.status).toBe('scheduled');
    expect(h.responses.clark?.status).toBe('nudge');
    expect(h.responses.clark?.note).toBe('mid-flow');
  });

  it('moves a decided item into the decided lane with its note', async () => {
    const hid = await callHuddle({ startsAt: Date.now() + 1000 });
    const item = await addHuddleItem(hid, { text: 'TikTok cadence' });
    await decideItem(item, 'Three a week, Angie drafts');
    const rec = await db.huddleItems.get(item);
    expect((rec as unknown as { lane: string }).lane).toBe('decided');
  });

  it('writes decisions back onto the linked bullet when wrapped', async () => {
    const bullet = await createBullet({ title: 'TikTok posts' });
    const hid = await callHuddle({ startsAt: new Date(2026, 7, 12, 10).getTime() });
    const item = await addHuddleItem(hid, { bulletId: bullet });
    await decideItem(item, 'Three a week');
    await wrapHuddle(hid);

    expect((await bulletOf(bullet)).note).toContain('Three a week');
    expect((await db.huddles.get(hid)) as unknown as Huddle).toMatchObject({ status: 'done' });
  });

  it('keeps rapid successive edits in order despite a coarse clock', async () => {
    // Both writes land in the same millisecond; the later one must still win.
    const hid = await callHuddle({ startsAt: Date.now() + 1000 });
    const item = await addHuddleItem(hid, { text: 'Fast' });
    await decideItem(item, 'Decided immediately');
    await undecideItem(item);
    await decideItem(item, 'Decided again');
    const rec = (await db.huddleItems.get(item)) as unknown as { lane: string; decision: string };
    expect(rec.lane).toBe('decided');
    expect(rec.decision).toBe('Decided again');
  });

  it('leaves undecided items off the linked bullet', async () => {
    const bullet = await createBullet({ title: 'Untouched' });
    const hid = await callHuddle({ startsAt: Date.now() });
    await addHuddleItem(hid, { bulletId: bullet });
    await wrapHuddle(hid);
    expect((await bulletOf(bullet)).note).toBeUndefined();
  });
});
