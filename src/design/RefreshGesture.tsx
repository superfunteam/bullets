import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { fling, prefersReducedMotion, settle } from './springs';
import { ARM, begin, commits, idle, step, type GestureState } from './pullGesture';
import { MIN_HOLD, localTruth, resolvePull, type Outcome } from './pullOutcome';
import { onSyncState, syncOnce, syncState } from '../sync/client';
import { db } from '../data/db';
import { tapLight, warmHaptics } from '../native/haptics';

/**
 * Pull to refresh, for all four views at once.
 *
 * Wraps ONLY <motion.main>. Not the app root: a transform there would make it
 * the containing block for the tab bar, the toast and every `fixed inset-0`
 * overlay, so the tab bar would slide down with the pull. Every sheet and
 * overlay is a SIBLING of motion.main, which is also why their pointer events
 * can never arm this.
 *
 * The honest bit: this app polls every 1.5-4s and pushes within 250ms of a
 * write, so a pull almost never finds news. Rather than dress that up with a
 * spinner, the pill answers from LOCAL state on the way down — "Last synced
 * just now", "3 changes waiting on this device" — which is free and true, and
 * is the actual question being asked. The round trip still fires, and its
 * result is proved only by lastOkAt advancing.
 *
 * There is no spinner anywhere. A median round trip is a few hundred ms, and a
 * rotating thing implies measured progress we do not have.
 */

const RESULT_HOLD = 600;
const REST_MIN = 56;
const REST_MAX = 104;

const TONE: Record<Outcome['tone'], string> = {
  ok: 'var(--incoming)',
  wait: 'var(--incoming)',
  off: 'var(--ink-3)',
  err: 'var(--incoming)',
};

type Label = { l1: string; l2: string; dot: string };

export function RefreshGesture({
  children,
  disabled,
  resetKey,
}: {
  children: ReactNode;
  /** True while any overlay or sheet owns the screen. */
  disabled: boolean;
  /** Changing this abandons an in-flight run — the tab changed under it. */
  resetKey: string;
}) {
  const travel = useMotionValue(0);
  const pillY = useMotionValue(0);
  // Derived from pillY, not travel, so it stays lit while the content goes home.
  const pillOpacity = useTransform(pillY, [0, 20, 56], [0, 0, 1]);

  const gesture = useRef<GestureState>(idle());
  const pointerId = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const busy = useRef(false);
  const detached = useRef(false);
  const runId = useRef(0);
  const pillEl = useRef<HTMLDivElement>(null);
  const restPx = useRef(REST_MIN);
  const wasArmed = useRef(false);

  const [label, setLabel] = useState<Label | null>(null);
  /**
   * The armed state is the ONE thing worth a re-render during the drag.
   * Everything else rides motion values off the compositor, but "let go now"
   * has to be readable — the haptic alone tells you something happened without
   * telling you what it was, and on a phone in a pocket-warm hand the buzz is
   * easy to miss entirely.
   */
  const [armed, setArmed] = useState(false);

  // The pill mirrors the content until it is detached to hold a result.
  useMotionValueEvent(travel, 'change', v => {
    if (!detached.current) pillY.set(v);
  });

  /**
   * Measured, never computed. The pill is always mounted (transparent at rest)
   * so it always has layout, and a ResizeObserver re-derives when Angie's text
   * scale changes the line height.
   */
  useLayoutEffect(() => {
    const el = pillEl.current;
    if (!el) return;
    const measure = () =>
      (restPx.current = Math.min(REST_MAX, Math.max(REST_MIN, el.offsetHeight + 16)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A tab change abandons whatever was in flight, so the incoming view is never
  // pushed down by the outgoing one's pull.
  useEffect(() => {
    runId.current += 1;
    busy.current = false;
    detached.current = false;
    gesture.current = idle();
    travel.jump(0);
    pillY.jump(0);
    setLabel(null);
  }, [resetKey, travel, pillY]);

  const end = () => {
    pointerId.current = null;
    gesture.current = idle();
    wasArmed.current = false;
    setArmed(false);
  };

  const settleBack = () => {
    animate(travel, 0, fling);
    end();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (
      busy.current ||
      disabled ||
      !e.isPrimary ||
      // Touch idiom only. A trackpad on Electron scrolls; it does not pull.
      e.pointerType === 'mouse' ||
      window.scrollY > 0 ||
      (e.target as Element).closest('[role="dialog"],[data-no-pull]')
    ) {
      return;
    }
    pointerId.current = e.pointerId;
    start.current = { x: e.clientX, y: e.clientY };
    gesture.current = begin(window.scrollY);
    wasArmed.current = false;
    warmHaptics();
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (pointerId.current === null || e.pointerId !== pointerId.current) return;
      if (gesture.current.phase === 'idle') return;

      const next = step(gesture.current, {
        dx: Math.abs(e.clientX - start.current.x),
        dy: e.clientY - start.current.y,
        scrollY: window.scrollY,
      });
      gesture.current = next;

      if (next.phase === 'idle') {
        // Disarmed mid-gesture — hand it back and put anything we moved home.
        animate(travel, 0, fling);
        end();
        return;
      }
      if (next.phase === 'pulling') {
        // The list cannot scroll while we own it.
        if (e.cancelable) e.preventDefault();
        travel.set(next.travel);
        if (next.armed !== wasArmed.current) {
          if (next.armed) void tapLight();
          wasArmed.current = next.armed;
          setArmed(next.armed);
        }
      }
    };

    const up = () => {
      if (pointerId.current === null) return;
      const g = gesture.current;
      if (!commits(g)) {
        settleBack();
        return;
      }
      end();
      void runRefresh();
    };

    // Window listeners, not React props: a Motion pan session starting on a
    // ShotCard must never be able to retarget these away mid-gesture.
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- all handles are refs
  }, []);

  const runRefresh = async () => {
    if (busy.current) return;
    busy.current = true;
    const mine = ++runId.current;
    const reduced = prefersReducedMotion();

    // Freeze the local answer at the moment of commit so it cannot tick.
    const frozen = localTruth(syncState(), Date.now());
    // Two lines: what is happening, and the local answer read on the way down.
    setLabel({ l1: 'Syncing', l2: frozen, dot: 'var(--incoming)' });

    animate(travel, restPx.current, reduced ? { duration: 0.01 } : fling);

    const floor = new Promise(r => setTimeout(r, MIN_HOLD));
    const outcome = resolvePull({
      syncState,
      onSyncState,
      syncOnce,
      readCursor: async () => Number((await db.meta.get('cursor'))?.value ?? 0),
    });

    await floor;
    if (runId.current !== mine) return;

    // The band closes at the floor so the list is usable again, while the pill
    // detaches and holds whatever the answer turns out to be.
    detached.current = true;
    animate(travel, 0, reduced ? { duration: 0.01 } : fling);

    const result = await outcome;
    if (runId.current !== mine) return;
    setLabel({ l1: result.l1, l2: result.l2, dot: TONE[result.tone] });

    setTimeout(() => {
      if (runId.current !== mine) return;
      animate(pillY, 0, reduced ? { duration: 0.01 } : settle);
      detached.current = false;
      busy.current = false;
      setLabel(null);
    }, RESULT_HOLD);
  };

  const shown =
    label ??
    (armed
      ? { l1: 'Release to sync', l2: ' ', dot: 'var(--ink)' }
      : { l1: 'Pull to sync', l2: ' ', dot: 'var(--ink-3)' });

  return (
    // pointerdown is a React prop so ONLY motion.main's subtree can arm the
    // gesture; the sheets and overlays are siblings and never reach it.
    <div className="relative" onPointerDown={onPointerDown}>
      <motion.div style={{ y: travel }}>{children}</motion.div>

      {/* Behind and above the content, never in flow. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
      >
        <motion.div style={{ y: pillY, opacity: pillOpacity }}>
          <div className="-translate-y-full px-4">
            <div
              ref={pillEl}
              className="flex items-center gap-3 rounded-[var(--r-md)] border px-5 py-3.5"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: shown.dot }}
              />
              <span className="min-w-0">
                <span className="meta block uppercase text-[var(--ink-2)]">{shown.l1}</span>
                <span className="meta block text-[var(--ink-2)]">{shown.l2}</span>
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {label ? `${label.l1}. ${label.l2}` : ''}
      </span>
    </div>
  );
}

export { ARM as PULL_ARM };
