import { describe, it, expect } from 'vitest';
import { tensionOf, progressOf, unclaimedOf } from './selectors';
import type { Bullet, Shot } from './types';

const bullet = (over: Partial<Bullet> = {}): Bullet => ({
  id: 'b',
  createdAt: 0,
  updatedAt: 0,
  title: 'X',
  horizon: 'shelf',
  kind: 'task',
  state: 'open',
  sortKey: 'a0',
  ...over,
});

const shot = (over: Partial<Shot> = {}): Shot => ({
  id: 's',
  createdAt: 0,
  updatedAt: 0,
  bulletId: 'b',
  scope: 'day',
  date: '2026-08-12',
  state: 'open',
  sortKey: 'a0',
  ...over,
});

describe('tensionOf', () => {
  it('is calm when there is no target at all', () => {
    expect(tensionOf(bullet(), [], '2026-08-12').level).toBe('calm');
  });

  it('is calm when a distant target sits on a distant horizon', () => {
    const b = bullet({ deadline: '2026-12-01', horizon: 'later' });
    expect(tensionOf(b, [], '2026-08-12').level).toBe('calm');
  });

  it('is incoming when a near target has not been aimed at', () => {
    const b = bullet({ deadline: '2026-08-14', horizon: 'later' });
    expect(tensionOf(b, [], '2026-08-12').level).toBe('incoming');
  });

  it('is calm once that same target has been pulled onto a day', () => {
    const b = bullet({ deadline: '2026-08-14', horizon: 'now' });
    expect(tensionOf(b, [shot()], '2026-08-12').level).toBe('calm');
  });

  it('is wide when the target has passed and the work is still open', () => {
    const b = bullet({ deadline: '2026-08-09', horizon: 'next' });
    expect(tensionOf(b, [], '2026-08-12').level).toBe('wide');
  });

  it('is calm when the target has passed but the work is done', () => {
    const b = bullet({ deadline: '2026-08-09', state: 'done' });
    expect(tensionOf(b, [], '2026-08-12').level).toBe('calm');
  });

  it('is calm for a called-off bullet no matter how late', () => {
    const b = bullet({ deadline: '2026-01-01', state: 'dropped' });
    expect(tensionOf(b, [], '2026-08-12').level).toBe('calm');
  });

  it('ignores an already-completed shot when deciding whether we aimed', () => {
    const b = bullet({ deadline: '2026-08-14', horizon: 'later' });
    expect(tensionOf(b, [shot({ state: 'done' })], '2026-08-12').level).toBe('incoming');
  });

  it('treats a week commitment that lands before the target as aimed', () => {
    const b = bullet({ deadline: '2026-08-14', horizon: 'next' });
    const weekShot = shot({ scope: 'week', date: '2026-08-10' });
    expect(tensionOf(b, [weekShot], '2026-08-12').level).toBe('calm');
  });

  it('reports how many days are left', () => {
    const b = bullet({ deadline: '2026-08-15', horizon: 'later' });
    expect(tensionOf(b, [], '2026-08-12').daysLeft).toBe(3);
  });
});

describe('progressOf', () => {
  it('reports 0 of 1 for an untouched uncounted bullet', () => {
    expect(progressOf(bullet(), [])).toEqual({ done: 0, total: 1 });
  });

  it('sums the amounts of completed shots only', () => {
    const b = bullet({ count: { total: 20, unit: 'posts' } });
    const shots = [
      shot({ id: 's1', amount: 3, state: 'done' }),
      shot({ id: 's2', amount: 5, state: 'done' }),
      shot({ id: 's3', amount: 2, state: 'open' }),
    ];
    expect(progressOf(b, shots)).toEqual({ done: 8, total: 20 });
  });

  it('never reports more done than the total', () => {
    const b = bullet({ count: { total: 3, unit: 'posts' } });
    const shots = [shot({ id: 's1', amount: 10, state: 'done' })];
    expect(progressOf(b, shots)).toEqual({ done: 3, total: 3 });
  });
});

describe('unclaimedOf', () => {
  it('reports how much of a counted bullet is still uncommitted', () => {
    const b = bullet({ count: { total: 20, unit: 'posts' } });
    const shots = [shot({ id: 's1', amount: 3 }), shot({ id: 's2', amount: 5 })];
    expect(unclaimedOf(b, shots)).toBe(12);
  });

  it('floors at zero when more has been claimed than exists', () => {
    const b = bullet({ count: { total: 4, unit: 'posts' } });
    expect(unclaimedOf(b, [shot({ amount: 9 })])).toBe(0);
  });
});
