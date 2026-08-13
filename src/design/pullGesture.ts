/**
 * The pull-to-refresh gesture, as a pure state machine.
 *
 * Separated from the component on purpose: the failure that matters here is
 * STEALING A GESTURE — a vertical pull that starts on a ShotCard and eats the
 * swipe-to-complete — and that is only testable if the decision logic can be
 * fed a stream of samples without a DOM.
 *
 * Everything is in PIXELS, never rem. Angie's large system font arrives as a
 * WebView text zoom (see design/textScale.ts), and a threshold in rem would
 * grow with her font — the gesture would commit at a different finger distance
 * on her phone than on Clark's.
 */

/** Dead zone before any travel is written, so a tap can never nudge the list. */
export const ENGAGE = 12;
/** Horizontal movement past this, and dominant, permanently disarms. */
export const AXIS_BAIL = 6;
/** Upward movement past this disarms. Tolerates digitizer jitter on the way down. */
export const UP_BAIL = -6;
/** Asymptote of the resistance curve. The list can never travel further. */
export const MAX = 160;
/** Travel at which the pull commits. */
export const ARM = 64;
/** Hysteresis: the latch only reopens below this, so a wobble is not four buzzes. */
export const ARM_RELEASE = 58;

export type Phase = 'idle' | 'watching' | 'pulling';

export type GestureState = {
  phase: Phase;
  /** How far the content has moved. Always 0 unless phase is 'pulling'. */
  travel: number;
  /** Latched: true once ARM is crossed, false only below ARM_RELEASE. */
  armed: boolean;
};

export type Sample = {
  /** Absolute horizontal distance from the pointer's start. */
  dx: number;
  /** Signed vertical distance from the pointer's start. Positive is downward. */
  dy: number;
  /** Document scroll at the moment of THIS sample. */
  scrollY: number;
};

export const idle = (): GestureState => ({ phase: 'idle', travel: 0, armed: false });

/**
 * Resistance. Subtracting ENGAGE is load-bearing rather than cosmetic: it makes
 * the slope exactly 1.0 at the moment of engagement, so the content picks up
 * 1:1 under the finger instead of jumping ~11px the instant it starts moving.
 */
export function travelFor(dy: number): number {
  if (dy <= ENGAGE) return 0;
  return MAX * (1 - Math.exp(-(dy - ENGAGE) / MAX));
}

/** Finger distance needed to reach a given travel. Used to sanity-check tuning. */
export function fingerFor(travel: number): number {
  return ENGAGE - MAX * Math.log(1 - travel / MAX);
}

/**
 * Begin watching, but only from a standing start at the very top.
 *
 * `phase === 'idle'` is checked by the caller: re-arming while a previous run
 * is still settling would fight the release spring with per-move writes.
 */
export function begin(scrollY: number): GestureState {
  if (scrollY > 0) return idle();
  return { phase: 'watching', travel: 0, armed: false };
}

/**
 * Advance one sample.
 *
 * Scroll is only consulted while WATCHING. Once the pull owns the gesture the
 * reducer never reads scroll again — re-reading it per move would force a style
 * recalculation on every frame, and the page cannot scroll during a pull
 * anyway.
 */
export function step(state: GestureState, s: Sample): GestureState {
  if (state.phase === 'idle') return state;

  if (state.phase === 'watching') {
    // The finger is already scrolling the list; the content owns this.
    if (s.scrollY > 0) return idle();
    // Upward. Let it scroll away.
    if (s.dy < UP_BAIL) return idle();
    /**
     * The rule that protects swipe-to-complete. A ShotCard swipe is dx-dominant
     * from its very first samples, so this disarms before `travel` is ever
     * written and the card keeps its own gesture.
     */
    if (s.dx > AXIS_BAIL && s.dx >= s.dy) return idle();
    if (s.dy <= ENGAGE) return state;
    return { phase: 'pulling', travel: travelFor(s.dy), armed: false };
  }

  // phase === 'pulling'
  const travel = Math.max(0, travelFor(s.dy));
  const armed = state.armed ? travel >= ARM_RELEASE : travel >= ARM;
  return { phase: 'pulling', travel, armed };
}

/** True when releasing here should actually run a sync. */
export const commits = (state: GestureState): boolean =>
  state.phase === 'pulling' && state.armed;
