import { describe, expect, it } from 'vitest';
import {
  ARM,
  ENGAGE,
  begin,
  commits,
  fingerFor,
  idle,
  step,
  travelFor,
  type GestureState,
  type Sample,
} from './pullGesture';

/**
 * The failure that matters is a STOLEN GESTURE. Every row on Today and Week is
 * a ShotCard with `drag="x"` and swipe-right-to-complete; if the pull arms on
 * one of those, the card stops working and the app feels broken in the place it
 * is used most.
 */

const run = (samples: Sample[], startScroll = 0): GestureState => {
  let s = begin(startScroll);
  for (const sample of samples) s = step(s, sample);
  return s;
};

const at = (dx: number, dy: number, scrollY = 0): Sample => ({ dx, dy, scrollY });

describe('pull gesture', () => {
  it('never arms on a ShotCard swipe-right', () => {
    // The real shape of a swipe-to-complete: horizontal from the first samples,
    // with a few px of incidental vertical drift.
    const swipe = [at(0, 0), at(10, 2), at(40, 4), at(140, 6)];

    let s = begin(0);
    s = step(s, swipe[0]);
    s = step(s, swipe[1]);
    // Disarmed on the very sample where horizontal dominance appears, BEFORE
    // any travel is written, so the card never competes with us for the frame.
    expect(s.phase).toBe('idle');

    const end = run(swipe);
    expect(end.phase).toBe('idle');
    expect(end.travel).toBe(0);
    expect(commits(end)).toBe(false);
  });

  it('never arms when the list is already scrolled', () => {
    const s = run([at(0, 20), at(0, 60), at(0, 120)], 40);
    expect(s.phase).toBe('idle');
    expect(s.travel).toBe(0);
  });

  it('keeps the gesture once engaged, even if scroll is reported later', () => {
    // Guards a real regression: re-reading scroll on every move forces a style
    // recalculation per frame, and the page cannot scroll during a pull anyway.
    const s = run([at(0, 20), at(0, 80, 200), at(0, 120, 200)]);
    expect(s.phase).toBe('pulling');
    expect(s.travel).toBeGreaterThan(0);
  });

  it('picks up 1:1 at the moment it engages, with no pop', () => {
    expect(travelFor(ENGAGE)).toBe(0);
    expect(travelFor(ENGAGE - 1)).toBe(0);
    // Slope 1.0 at engagement — the content tracks the finger exactly.
    expect(travelFor(ENGAGE + 1) - travelFor(ENGAGE)).toBeCloseTo(1.0, 2);
  });

  it('commits at 94px of finger travel', () => {
    // Pinned so that tuning MAX or ARM in isolation cannot silently move the
    // commitment point. 64px of content travel is 94px of finger.
    expect(Math.round(fingerFor(ARM))).toBe(94);
  });

  it('resists: the content moves less than the finger', () => {
    expect(travelFor(100)).toBeLessThan(100);
    expect(travelFor(400)).toBeLessThan(160);
  });

  it('arms exactly once through a wobble', () => {
    // Without hysteresis this oscillation fires four times: four haptics and
    // four label swaps for one indecisive thumb.
    const dys = [ARM - 1, ARM + 20, ARM - 5, ARM + 12, ARM - 2].map(t => fingerFor(Math.max(1, t)));

    let s = begin(0);
    let crossings = 0;
    let was = false;
    for (const dy of dys) {
      s = step(s, at(0, dy));
      if (s.armed && !was) crossings += 1;
      was = s.armed;
    }
    expect(crossings).toBe(1);
    expect(s.armed).toBe(true);
  });

  it('tolerates a jitter sample upward but bails on a real upward drag', () => {
    const jittered = run([at(0, -3), at(0, 20), at(0, 90)]);
    expect(jittered.phase).toBe('pulling');

    const upward = run([at(0, -8), at(0, 20), at(0, 90)]);
    expect(upward.phase).toBe('idle');
  });

  it('does not commit a short pull', () => {
    const short = run([at(0, 20), at(0, 40)]);
    expect(short.phase).toBe('pulling');
    expect(commits(short)).toBe(false);
  });

  it('commits a pull past the threshold', () => {
    const long = run([at(0, 20), at(0, 120)]);
    expect(commits(long)).toBe(true);
  });

  it('ignores samples once idle', () => {
    expect(step(idle(), at(0, 200))).toEqual(idle());
  });
});
