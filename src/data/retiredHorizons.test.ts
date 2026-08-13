import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { clean } from './ops';
import { surfacesFor, tensionOf } from './selectors';
import { normalizeHorizon, type Bullet, type Shot } from './types';
import { today as todayFn } from '../lib/dates';
import type { Horizon } from './types';

/**
 * Horizons that are still STORED and still arrive from peers, but are no longer
 * offered. Nothing was migrated, so these values live in the data forever and
 * the app has to keep understanding them.
 */
const RETIRED = {
  soon: 'soon' as unknown as Horizon,
  later: 'later' as unknown as Horizon,
};

/**
 * RETIRED.soon and RETIRED.later were retired WITHOUT rewriting a single row.
 *
 * Nothing is migrated, so nothing can be lost by a migration — but that means
 * both values live in the stored data and in the op log forever, and Angie's
 * phone can keep writing them until her APK updates: offline, at a higher HLC
 * stamp, winning last-write-wins after she reconnects.
 *
 * Every one of these tests is about a bullet that must not go invisible. A
 * bullet with a horizon nothing recognises gets no Shelf surface and no Pull
 * route, which is the trap that has already shipped twice.
 */

const bullet = (over: Partial<Bullet> = {}): Bullet =>
  ({
    id: 'b1',
    title: 'Site copy',
    horizon: RETIRED.later,
    kind: 'task',
    state: 'open',
    sortKey: 'a0',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as Bullet;

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
});

describe('retired horizons still reach the user', () => {
  it('folds anything unrecognised onto the Shelf, not just soon and later', () => {
    expect(normalizeHorizon('now')).toBe('now');
    expect(normalizeHorizon('next')).toBe('next');
    expect(normalizeHorizon(RETIRED.soon)).toBe('shelf');
    expect(normalizeHorizon(RETIRED.later)).toBe('shelf');
    expect(normalizeHorizon('shelf')).toBe('shelf');
    // The point of a complement: a typo or a value from a future build lands
    // somewhere visible rather than nowhere.
    expect(normalizeHorizon('someday')).toBe('shelf');
    expect(normalizeHorizon(undefined)).toBe('shelf');
    expect(normalizeHorizon(null)).toBe('shelf');
  });

  it('rewrites the horizon on the way out of clean(), so no view ever sees one', () => {
    const stored = { ...bullet({ horizon: RETIRED.soon }), _ts: {}, _op: {} };
    expect(clean<Bullet>(stored as never).horizon).toBe('shelf');
  });

  it('gives a stored "later" bullet a Shelf surface', () => {
    const today = todayFn();
    const surfaces = surfacesFor(bullet({ horizon: RETIRED.later }), [], today);
    expect(surfaces).toContain('shelf');
  });

  it('still lights the tension badge for a retired horizon', () => {
    // The regression this guards: indexing REACH with a retired value yields
    // undefined, `daysLeft < undefined` is false, and the badge silently never
    // appears — the app quietly reassuring you about work that is nearly due.
    const today = '2026-08-12';
    const soon = bullet({ horizon: RETIRED.later, deadline: '2026-08-14' });
    expect(tensionOf(soon, [], today).level).toBe('incoming');

    const late = bullet({ horizon: RETIRED.soon, deadline: '2026-08-01' });
    expect(tensionOf(late, [], today).level).toBe('wide');
  });

  it('leaves a retired bullet calm once it is actually aimed', () => {
    const today = '2026-08-12';
    const shot = {
      id: 's1',
      bulletId: 'b1',
      scope: 'day',
      date: '2026-08-13',
      state: 'open',
      sortKey: 'a0',
      createdAt: 1,
      updatedAt: 1,
    } as Shot;
    const b = bullet({ horizon: RETIRED.later, deadline: '2026-08-14' });
    expect(tensionOf(b, [shot], today).level).toBe('calm');
  });
});
