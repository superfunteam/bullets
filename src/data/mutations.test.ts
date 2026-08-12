import { describe, it, expect, beforeEach } from 'vitest';
import { db, ENTITY_TABLES } from './db';
import {
  addHuddleItem,
  callHuddle,
  callOff,
  completeBullet,
  moveToHorizon,
  settleFromOps,
  deleteBullet,
  reopenBullet,
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
import { applyLocal } from './mutations';
import { seedIfEmpty } from './seed';
import { today, weekStart } from '../lib/dates';
import { progressOf } from './selectors';
import { hasAnswered, responseOf, type Bullet, type Huddle, type Shot } from './types';

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
    expect(responseOf(h, 'angie')?.status).toBe('in');
    expect(responseOf(h, 'clark')?.status).toBe('in');
    // Presumed in, not stated — this is what the unread badge keys off.
    expect(hasAnswered(h, 'clark')).toBe(false);
  });

  it('keeps the huddle scheduled when one person nudges', async () => {
    const id = await callHuddle({ startsAt: Date.now() + 3_600_000, calledBy: 'angie' });
    await respondToHuddle(id, { status: 'nudge', note: 'mid-flow', proposedAt: Date.now() + 7_200_000 }, 'clark');
    const h = (await db.huddles.get(id)) as unknown as Huddle;
    expect(h.status).toBe('scheduled');
    expect(responseOf(h, 'clark')?.status).toBe('nudge');
    expect(responseOf(h, 'clark')?.note).toBe('mid-flow');
    expect(hasAnswered(h, 'clark')).toBe(true);
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

// ---------------------------------------------------------------------------
// Regressions from the 2026-08-12 audit. Each of these silently corrupted data
// or silently dropped a user action, so each gets a permanent test.
// ---------------------------------------------------------------------------

describe('clock skew between the two devices', () => {
  it('lets a local edit win after a peer op arrives from a faster clock', async () => {
    const hid = await callHuddle({ startsAt: Date.now() + 3_600_000 });
    const item = await addHuddleItem(hid, { text: 'Cadence' });

    // Angie's phone is a minute ahead. Her op lands with a far-future ts.
    await applyLocal([
      {
        opId: 'peer-1',
        entity: 'huddleItem',
        entityId: item,
        field: 'lane',
        value: 'decided',
        ts: Date.now() + 60_000,
        actor: 'angie',
      },
    ]);
    expect(((await db.huddleItems.get(item)) as unknown as { lane: string }).lane).toBe('decided');

    // Clark taps undecide on his slower device. It must still take effect.
    await undecideItem(item);
    expect(((await db.huddleItems.get(item)) as unknown as { lane: string }).lane).toBe('table');
  });
});

describe('concurrent huddle responses', () => {
  it('does not let one person clobber the other', async () => {
    const hid = await callHuddle({ startsAt: Date.now() + 3_600_000, calledBy: 'angie' });

    // Angie declines with a note.
    await respondToHuddle(hid, { status: 'out', note: 'sick' }, 'angie');
    // Clark, whose device had not yet pulled her op, confirms a moment later.
    await respondToHuddle(hid, { status: 'in' }, 'clark');

    const h = (await db.huddles.get(hid)) as unknown as Huddle;
    expect(responseOf(h, 'clark')?.status).toBe('in');
    // Angie's decline and her reason must both survive.
    expect(responseOf(h, 'angie')?.status).toBe('out');
    expect(responseOf(h, 'angie')?.note).toBe('sick');
  });
});

describe('wrapHuddle', () => {
  it('is idempotent, so wrapping twice does not duplicate the decision', async () => {
    const bullet = await createBullet({ title: 'TikTok posts' });
    const hid = await callHuddle({ startsAt: new Date(2026, 7, 12, 10).getTime() });
    const item = await addHuddleItem(hid, { bulletId: bullet });
    await decideItem(item, 'Three a week');

    await wrapHuddle(hid);
    await wrapHuddle(hid);

    const note = (await bulletOf(bullet)).note ?? '';
    expect(note.match(/Three a week/g)).toHaveLength(1);
  });

  it('stamps the local date, not the UTC one, for an evening huddle', async () => {
    const bullet = await createBullet({ title: 'Evening decision' });
    // 8pm local on Aug 12 is Aug 13 in UTC for any timezone behind it.
    const hid = await callHuddle({ startsAt: new Date(2026, 7, 12, 20, 0).getTime() });
    const item = await addHuddleItem(hid, { bulletId: bullet });
    await decideItem(item, 'Ship it');
    await wrapHuddle(hid);

    expect((await bulletOf(bullet)).note).toContain('Huddle 2026-08-12:');
  });
});

describe('seeding', () => {
  it('uses stable ids so the second device does not duplicate the clients', async () => {
    await db.clients.clear();
    await seedIfEmpty();
    const first = (await db.clients.toArray()).map(c => c.id).sort();

    // Angie's fresh device seeds against its own empty table.
    await db.clients.clear();
    await seedIfEmpty();
    const second = (await db.clients.toArray()).map(c => c.id).sort();

    expect(second).toEqual(first);
  });
});

describe('capturing with a committing horizon', () => {
  it('puts a NOW bullet on today, so it is not invisible everywhere', async () => {
    // The bug: every calendar view renders shots, so a bullet with horizon
    // 'now' and no shot appeared in Today, Week and Shelf alike — which is to
    // say nowhere at all. It saved, it synced, and you could never find it.
    const id = await createBullet({ title: 'Urgent thing', horizon: 'now' });
    const shots = await shotsOf(id);
    expect(shots).toHaveLength(1);
    expect(shots[0].scope).toBe('day');
    expect(shots[0].date).toBe(today());
  });

  it('puts a NEXT bullet into this week', async () => {
    const id = await createBullet({ title: 'This week thing', horizon: 'next' });
    const shots = await shotsOf(id);
    expect(shots).toHaveLength(1);
    expect(shots[0].scope).toBe('week');
    expect(shots[0].date).toBe(weekStart(today()));
  });

  it('leaves uncommitted horizons off the calendar', async () => {
    for (const h of ['soon', 'later', 'shelf'] as const) {
      const id = await createBullet({ title: `A ${h} thing`, horizon: h });
      expect(await shotsOf(id)).toHaveLength(0);
    }
  });

  it('does not put a sub-bullet on a day of its own', async () => {
    const parent = await createBullet({ title: 'Parent', horizon: 'shelf' });
    const child = await createBullet({ title: 'Child', horizon: 'now', parentId: parent });
    expect(await shotsOf(child)).toHaveLength(0);
  });
});

describe('scheduling is idempotent', () => {
  it('does not create a second shot for the same bullet on the same day', async () => {
    const id = await createBullet({ title: 'Do it', horizon: 'shelf' });
    await pullToDay(id, '2026-08-12');
    await pullToDay(id, '2026-08-12');
    // Two shots rendered as the task appearing twice — indistinguishable from
    // having accidentally created a duplicate task.
    expect(await shotsOf(id)).toHaveLength(1);
  });

  it('merges a second partial claim into the existing shot', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 20, unit: 'posts' } });
    await pullToDay(id, '2026-08-12', 3);
    await pullToDay(id, '2026-08-12', 5);
    const shots = await shotsOf(id);
    expect(shots).toHaveLength(1);
    expect(shots[0].amount).toBe(8);
  });

  it('still allows the same bullet on two different days', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 20, unit: 'posts' } });
    await pullToDay(id, '2026-08-12', 3);
    await pullToDay(id, '2026-08-13', 5);
    expect(await shotsOf(id)).toHaveLength(2);
  });
});

describe('completing a bullet', () => {
  it('closes its open shots so it stops rendering as open work', async () => {
    const id = await createBullet({ title: 'X', horizon: 'shelf' });
    await pullToDay(id, '2026-08-12');
    await completeBullet(id);
    expect((await shotsOf(id)).every(s => s.state === 'done')).toBe(true);
  });

  it('rolls up to the parent when the last piece is done', async () => {
    const parent = await createBullet({ title: 'Five pieces', horizon: 'shelf' });
    const kids = [];
    for (let i = 0; i < 5; i++) {
      kids.push(await createBullet({ title: `Piece ${i}`, parentId: parent }));
    }
    for (const k of kids.slice(0, 4)) await completeBullet(k);
    expect((await bulletOf(parent)).state).toBe('open');

    await completeBullet(kids[4]);
    expect((await bulletOf(parent)).state).toBe('done');
  });

  it('reopens the parent when a finished piece is unchecked', async () => {
    const parent = await createBullet({ title: 'Two pieces', horizon: 'shelf' });
    const a = await createBullet({ title: 'A', parentId: parent });
    const b = await createBullet({ title: 'B', parentId: parent });
    await completeBullet(a);
    await completeBullet(b);
    expect((await bulletOf(parent)).state).toBe('done');

    await reopenBullet(b);
    expect((await bulletOf(parent)).state).toBe('open');
  });
});

describe('deleting a bullet', () => {
  it('takes its children and shots with it', async () => {
    const parent = await createBullet({ title: 'Parent', horizon: 'shelf' });
    const child = await createBullet({ title: 'Child', parentId: parent });
    await pullToDay(parent, '2026-08-12');

    await deleteBullet(parent);

    expect((await db.bullets.get(parent))?.deletedAt).toBeTruthy();
    expect((await db.bullets.get(child))?.deletedAt).toBeTruthy();
    // An orphaned shot would keep rendering a card for a bullet that is gone.
    expect(await shotsOf(parent)).toHaveLength(0);
  });
});

describe('moving a bullet keeps the calendar honest', () => {
  it('putting it on NOW actually schedules it for today', async () => {
    // The strand-it-nowhere bug: setHorizon alone left the bullet off every
    // calendar AND off the Shelf, with no way to reach it again.
    const id = await createBullet({ title: 'Invoice', horizon: 'shelf' });
    await moveToHorizon(id, 'now');
    const shots = await shotsOf(id);
    expect(shots).toHaveLength(1);
    expect(shots[0].date).toBe(today());
    expect((await bulletOf(id)).horizon).toBe('now');
  });

  it('putting it on NEXT schedules the week and drops today', async () => {
    const id = await createBullet({ title: 'Invoice', horizon: 'now' });
    await moveToHorizon(id, 'next');
    const shots = await shotsOf(id);
    expect(shots).toHaveLength(1);
    expect(shots[0].scope).toBe('week');
  });

  it('shelving keeps the record of work already done', async () => {
    const id = await createBullet({ title: 'Posts', count: { total: 20, unit: 'posts' } });
    await pullToDay(id, today(), 8);
    const shot = (await shotsOf(id))[0];
    await completeShot(shot.id);
    expect(progressOf(await bulletOf(id), await shotsOf(id)).done).toBe(8);

    await shelve(id);

    // Deleting the done shots would silently reset 8 posts of real work to zero.
    expect(progressOf(await bulletOf(id), await shotsOf(id)).done).toBe(8);
  });
});

describe('completion converges across devices', () => {
  it('finishes a counted bullet whose halves were done on two phones', async () => {
    const id = await createBullet({ title: '20 posts', count: { total: 20, unit: 'posts' } });
    await pullToDay(id, '2026-08-12', 10);
    const mine = (await shotsOf(id))[0];
    await completeShot(mine.id);
    expect((await bulletOf(id)).state).toBe('open');

    // Angie's half arrives from the server. Her device never saw ours, so the
    // rollup she computed locally could not know the total was reached.
    const peerShot = 'peer-shot-1';
    await applyLocal([
      { opId: 'p1', entity: 'shot', entityId: peerShot, field: 'bulletId', value: id, ts: Date.now() + 1, actor: 'angie' },
      { opId: 'p2', entity: 'shot', entityId: peerShot, field: 'scope', value: 'day', ts: Date.now() + 1, actor: 'angie' },
      { opId: 'p3', entity: 'shot', entityId: peerShot, field: 'date', value: '2026-08-13', ts: Date.now() + 1, actor: 'angie' },
      { opId: 'p4', entity: 'shot', entityId: peerShot, field: 'amount', value: 10, ts: Date.now() + 1, actor: 'angie' },
      { opId: 'p5', entity: 'shot', entityId: peerShot, field: 'state', value: 'done', ts: Date.now() + 1, actor: 'angie' },
      { opId: 'p6', entity: 'shot', entityId: peerShot, field: 'sortKey', value: 'a1', ts: Date.now() + 1, actor: 'angie' },
    ]);

    expect((await bulletOf(id)).state).toBe('open'); // not settled yet
    await settleFromOps([
      { opId: 'p5', entity: 'shot', entityId: peerShot, field: 'state', value: 'done', ts: Date.now() + 1, actor: 'angie' },
    ]);
    expect((await bulletOf(id)).state).toBe('done');
  });
});

describe('hitting a shot tidies up after itself', () => {
  it('closes the bullets other open shots so they stop showing as unhit', async () => {
    const id = await createBullet({ title: 'Invoice', horizon: 'shelf' });
    await pullToDay(id, '2026-08-10');
    await pullToDay(id, '2026-08-11');
    const shots = await shotsOf(id);
    expect(shots).toHaveLength(2);

    await completeShot(shots[1].id);

    // A finished bullet must not keep rendering an open card on Monday.
    expect((await shotsOf(id)).every(s => s.state === 'done')).toBe(true);
    expect((await bulletOf(id)).state).toBe('done');
  });

  it('rolls a sub-bullets hit up to its parent', async () => {
    const parent = await createBullet({ title: 'Parent', horizon: 'shelf' });
    const child = await createBullet({ title: 'Only piece', parentId: parent });
    await pullToDay(child, today());
    const shot = (await shotsOf(child))[0];

    await completeShot(shot.id);

    expect((await bulletOf(child)).state).toBe('done');
    expect((await bulletOf(parent)).state).toBe('done');
  });
});
