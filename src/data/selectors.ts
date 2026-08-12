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

  // Committed to a specific day, or to a week that starts before the target.
  const aimed = live.some(s => s.scope === 'day' || daysUntil(today, s.date) <= daysLeft);
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

/** How much of a counted bullet has not yet been committed to any day. */
export function unclaimedOf(bullet: Bullet, shots: Shot[]): number {
  const total = bullet.count?.total ?? 1;
  const claimed = shots
    .filter(s => !s.deletedAt)
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
