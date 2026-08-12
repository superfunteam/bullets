import type { Transition } from 'motion/react';

/**
 * The only source of motion config in the app.
 *
 * Duration-based easing is banned here on purpose. Springs are interruptible,
 * which is what makes an interface feel like physical material rather than
 * something playing animations at you. Everything below animates transform
 * and opacity only, so it stays on the compositor and holds 120Hz.
 */

/** Snappy and certain. Taps, chips, small state changes. */
export const snap: Transition = { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 };

/** Softer, a hint of overshoot. Cards arriving, sheets settling. */
export const settle: Transition = { type: 'spring', stiffness: 340, damping: 30, mass: 1 };

/** Shared-element zoom. Deliberately weighty — too fast and it reads as a glitch. */
export const zoom: Transition = { type: 'spring', stiffness: 280, damping: 32, mass: 1.1 };

/** Gesture release. Low stiffness so the finger's velocity carries the motion. */
export const fling: Transition = { type: 'spring', stiffness: 210, damping: 26 };

/** Lane moves on the huddle board, seen simultaneously on two screens. */
export const lane: Transition = { type: 'spring', stiffness: 380, damping: 33, mass: 0.95 };

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Stagger helper for list reveals. Capped so a long list never crawls. */
export const stagger = (i: number, step = 0.035, max = 0.28): number =>
  Math.min(i * step, max);
