import { daysUntil } from '../lib/dates';
import type { Bullet, Horizon, Shot } from './types';

export type TensionLevel = 'calm' | 'incoming' | 'wide';
export type Tension = { level: TensionLevel; daysLeft?: number };

/**
 * How far out a horizon claims to be looking, in days. A bullet counts as
 * "aimed at" when its target falls inside the horizon it's parked on.
 */
const REACH: Record<Horizon, number> = {
  now: 1,
  next: 7,
  soon: 30,
  later: Number.MAX_SAFE_INTEGER,
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

  if (daysLeft <= INCOMING_WINDOW && daysLeft < REACH[bullet.horizon]) {
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
