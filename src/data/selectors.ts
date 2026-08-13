import { daysUntil, weekStart } from '../lib/dates';
import type { Bullet, Horizon, Shot } from './types';
import { normalizeHorizon } from './types';

export type TensionLevel = 'calm' | 'incoming' | 'wide';
export type Tension = { level: TensionLevel; daysLeft?: number };

/**
 * How far out a horizon claims to be looking, in days. A bullet counts as
 * "aimed at" when its target falls inside the horizon it's parked on.
 */
const REACH: Record<Horizon, number> = {
  now: 1,
  next: 7,
  shelf: Number.MAX_SAFE_INTEGER,
};

/** How close a target has to be before an unaimed bullet starts shouting. */
const INCOMING_WINDOW = 3;

/**
 * The product's core idea, in one function.
 *
 * Every other tracker collapses "when it's due" and "when I decided to deal
 * with it" into a single date field, which is why they all degrade into a wall
 * of overdue red. Keeping them separate lets us say something much more useful:
 * this target is close and you have not actually aimed at it.
 */
export function tensionOf(bullet: Bullet, shots: Shot[], today: string): Tension {
  if (bullet.state !== 'open' || !bullet.deadline) return { level: 'calm' };

  const daysLeft = daysUntil(today, bullet.deadline);
  if (daysLeft < 0) return { level: 'wide', daysLeft };

  const live = shots.filter(s => !s.deletedAt && s.state === 'open');

  /**
   * "Aimed" means there is a live commitment that still lands between now and
   * the target.
   *
   * The date has to be bounded at BOTH ends. An open shot dated last Monday is
   * a commitment that was made and then abandoned — treating it as aim is how
   * the app ends up reassuring you about work nobody has touched in a week,
   * which is exactly the lie every other tracker tells.
   */
  const aimed = live.some(s => {
    const start = daysUntil(today, s.date);
    // A week shot covers its 7 days, so it reaches 6 days past its Monday.
    const end = s.scope === 'week' ? start + 6 : start;
    return end >= 0 && start <= daysLeft;
  });
  if (aimed) return { level: 'calm', daysLeft };

    // Through the normalizer, not raw: a retired value would give
  // REACH[x] === undefined, `daysLeft < undefined` is false, and the tension
  // badge would be silently suppressed — the app telling exactly the lie
  // tensionOf exists to refuse, with no error anywhere.
  if (daysLeft <= INCOMING_WINDOW && daysLeft < REACH[normalizeHorizon(bullet.horizon)]) {
    return { level: 'incoming', daysLeft };
  }
  return { level: 'calm', daysLeft };
}

/** Completion is always derived, so there is no progress field to keep honest. */
export function progressOf(bullet: Bullet, shots: Shot[]): { done: number; total: number } {
  const total = bullet.count?.total ?? 1;
  const done = shots
    .filter(s => !s.deletedAt && s.state === 'done')
    .reduce((sum, s) => sum + (s.amount ?? 1), 0);
  return { done: Math.min(done, total), total };
}

/**
 * How much of a counted bullet has not yet been claimed at a given scope.
 *
 * Scope matters and cannot be collapsed. The Daily Pull draws *out of* the
 * week's commitment, so a week shot of 10 and a day shot of 5 represent 10
 * posts committed, not 15. Summing both made a 20-post bullet report 5
 * unclaimed when 10 were genuinely outstanding, and after a few pulls it hit
 * zero — which silently collapsed the stepper and pulled in 1 at a time.
 */
export function unclaimedOf(
  bullet: Bullet,
  shots: Shot[],
  scope: 'day' | 'week' = 'day',
): number {
  const total = bullet.count?.total ?? 1;
  const claimed = shots
    .filter(s => !s.deletedAt && s.scope === scope)
    .reduce((sum, s) => sum + (s.amount ?? 1), 0);
  return Math.max(0, total - claimed);
}

const TENSION_RANK: Record<TensionLevel, number> = { wide: 0, incoming: 1, calm: 2 };

/** Loudest first, then by target, then by manual order. */
export function byUrgency(
  a: { bullet: Bullet; tension: Tension },
  b: { bullet: Bullet; tension: Tension },
): number {
  const rank = TENSION_RANK[a.tension.level] - TENSION_RANK[b.tension.level];
  if (rank !== 0) return rank;
  if (a.bullet.deadline && b.bullet.deadline && a.bullet.deadline !== b.bullet.deadline) {
    return a.bullet.deadline < b.bullet.deadline ? -1 : 1;
  }
  if (a.bullet.deadline && !b.bullet.deadline) return -1;
  if (!a.bullet.deadline && b.bullet.deadline) return 1;
  return a.bullet.sortKey < b.bullet.sortKey ? -1 : 1;
}

// ---------------------------------------------------------------- surfaces

/** Every place a bullet can show up. See docs/state-model.md, invariant 2. */
export type Surface = 'today' | 'week' | 'shelf' | 'weeklyPull' | 'dailyPull';

/**
 * Where does this bullet actually appear?
 *
 * One function, shared by the views and by the invariant test, because the real
 * bug behind a run of "I saved it and it's gone" reports was that each view
 * decided this for itself and the answers didn't cover the space. If this
 * returns [] for an open bullet, the app has lost it.
 */
export function surfacesFor(bullet: Bullet, shots: Shot[], today: string): Surface[] {
  if (bullet.deletedAt || bullet.state !== 'open') return [];
  // Children are reached by zooming into their parent, never on their own.
  if (bullet.parentId) return [];

  const live = shots.filter(s => !s.deletedAt && s.state === 'open');
  const out: Surface[] = [];

  const onToday = live.some(s => s.scope === 'day' && s.date === today);
  if (onToday) out.push('today');

  const weekOf = weekStart(today);
  const inWeek = live.some(
    s =>
      (s.scope === 'week' && s.date === weekOf) ||
      (s.scope === 'day' && weekStart(s.date) === weekOf),
  );
  if (inWeek) out.push('week');

  // A complement, not an allowlist: everything that is not committed to a day
  // or a week belongs on the Shelf, including values we no longer offer.
  if (normalizeHorizon(bullet.horizon) === 'shelf') out.push('shelf');

  /**
   * The safety net, and the rule that makes invariant 2 hold structurally.
   *
   * A commitment only counts while it is still ahead of you. Last Monday's
   * open week shot is not a plan, it is an abandoned intention — and treating
   * it as "already handled" is exactly the lie tensionOf refuses to tell.
   *
   * So: anything open without a live commitment is offered by the Weekly Pull,
   * whatever its horizon. That covers a commitment gone stale with the clock, a
   * counted bullet whose shot was hit with work still outstanding, and any
   * future way of ending up committed to nothing. Nothing can fall through.
   */
  const committed = live.some(s => {
    if (s.scope === 'day') return s.date >= today;
    return s.date >= weekOf; // a week shot covers the week it starts
  });
  if (!committed) out.push('weeklyPull');

  const weekCommitment = live.some(s => s.scope === 'week' && s.date === weekOf);
  if (weekCommitment && !onToday) out.push('dailyPull');

  return out;
}

/** Invariant 2, as a predicate. An open top-level bullet must be findable. */
export const isReachable = (bullet: Bullet, shots: Shot[], today: string): boolean =>
  bullet.state !== 'open' ||
  Boolean(bullet.deletedAt) ||
  Boolean(bullet.parentId) ||
  surfacesFor(bullet, shots, today).length > 0;
