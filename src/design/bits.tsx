import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { HORIZON_META, type BulletKind, type Horizon } from '../data/types';
import { settle, snap } from './springs';
import { Icon } from './icons';

/** The horizon chip. Short, all caps, unmistakable at a glance. */
export function HorizonChip({
  horizon,
  size = 'md',
  active,
}: {
  horizon: Horizon;
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
}) {
  const meta = HORIZON_META[horizon];
  const pad =
    size === 'sm'
      ? 'px-2.5 py-1 text-[0.6875rem]'
      : size === 'lg'
        ? 'px-5 py-3 text-base'
        : 'px-3.5 py-1.5 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ${pad}`}
      style={{
        // The hue rides on the element so --chip-ink can resolve per theme.
        // Hardcoded oklch(45% …) was near-invisible on the 20.5% dark surface.
        ['--hue' as string]: meta.hue,
        background: active ? `oklch(60% 0.14 ${meta.hue} / 0.16)` : 'var(--surface-2)',
        color: active ? 'var(--chip-ink)' : 'var(--ink-2)',
        fontVariationSettings: "'wght' 700",
        letterSpacing: '0.06em',
      }}
    >
      <span aria-hidden>{meta.emoji}</span>
      {meta.label}
    </span>
  );
}

/**
 * A client, as a pill.
 *
 * This replaced the Slab spine — a 7px full-height bar at chroma 0.16 down the
 * leading edge of every card. The spine's own docstring argued it kept a screen
 * of eleven clients "calm instead of like a bag of candy", and it was right
 * about the risk and wrong about the cure: eleven spines line up into a
 * continuous colour column, which is exactly what reads as candy. It also could
 * only ever be a code you had to learn.
 *
 * The pill carries a sixth of the saturated area, pins every client to one wash
 * lightness and one ink so none of them shouts, and says the name out loud.
 * Chroma lives on the dot alone — nine coloured words in a column would let the
 * candy back in through the type.
 */
export function ClientPill({ hue, name }: { hue: number; name?: string }) {
  if (!name) return null;
  return (
    <span
      className="meta inline-flex max-w-[14ch] items-center gap-1.5 rounded-full px-2.5 py-1
                 text-[var(--ink-2)]"
      style={{
        // Set here, never inherited: Slab's old --hue is gone with the spine,
        // and a pill reading a missing var renders grey on every row.
        ['--pill-hue' as string]: hue,
        background: 'var(--pill-wash)',
        fontVariationSettings: "'wght' 600",
      }}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: 'oklch(60% 0.16 var(--pill-hue))' }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function KindGlyph({
  kind,
  size,
  className = 'text-[var(--ink-3)]',
}: {
  kind: BulletKind;
  /** Omit inside the selection mark, where the plate sizes it. */
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size ?? '100%'}
      height={size ?? '100%'}
      viewBox="0 0 16 16"
      aria-hidden
      // currentColor, so the glyph can invert when its plate fills with ink.
      className={`shrink-0 ${className}`}
    >
      {kind === 'task' && <circle cx="8" cy="8" r="4" fill="currentColor" />}
      {kind === 'event' && (
        <circle cx="8" cy="8" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      )}
      {kind === 'note' && (
        <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}


/**
 * The leading mark on every list row: selection control and bullet-journal
 * signifier in one plate.
 *
 * The rule is one sentence: **the box picks things, the swipe finishes them.**
 * It never mutates anything. That is what lets a checkbox sit beside a task
 * without lying — a plain checkbox there means "done" to everyone alive, and
 * swipe-right already means done, so a box that completed would have left no
 * way to select and a box that selected would have contradicted the gesture.
 *
 * The signifier survives because the plate HOLDS KindGlyph rather than
 * replacing it: filled dot, ring and dash are all still there, which matters in
 * an app named for the method. Events and notes get the same plate — a
 * signifier says what a row is, it was never a permission system.
 *
 * Two colours, and they never collide: selected fills with ink, done fills with
 * --hit and swaps in a check. A done row's mark is inert status, not a control.
 */
export function SelectionMark({
  kind,
  selected,
  done,
  title,
  onToggle,
}: {
  kind: BulletKind;
  selected?: boolean;
  /** Done rows render status, take no pointer events, and cannot be selected. */
  done?: boolean;
  title: string;
  onToggle?: () => void;
}) {
  const plate = (
    <motion.span
      className="flex items-center justify-center rounded-[10px] border-2"
      style={{
        width: 'var(--plate)',
        height: 'var(--plate)',
        background: done ? 'var(--hit)' : selected ? 'var(--ink)' : 'transparent',
        borderColor: done ? 'var(--hit)' : selected ? 'var(--ink)' : 'var(--line-strong)',
        color: done || selected ? 'var(--bg)' : 'var(--ink-3)',
      }}
      // Fill and scale only. `layout` here would make every row measure itself
      // on every tick of a selection.
      animate={selected ? { scale: [1, 1.12, 1] } : { scale: 1 }}
      transition={snap}
    >
      <span
        className="flex items-center justify-center"
        style={{ width: 'calc(var(--plate) * 0.58)', height: 'calc(var(--plate) * 0.58)' }}
      >
        {done ? <Icon name="check" size={undefined} className="h-full w-full" /> : (
          <KindGlyph kind={kind} className="" />
        )}
      </span>
    </motion.span>
  );

  if (done || !onToggle) {
    return (
      <span
        aria-hidden
        className="pointer-events-none inline-flex self-start"
        style={{ marginTop: 'var(--mark-offset)' }}
      >
        {plate}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={Boolean(selected)}
      // The label never changes, because the meaning never changes.
      aria-label={`Select ${title}`}
      onClick={e => {
        // The row's own tap zooms; without this both fire.
        e.stopPropagation();
        onToggle();
      }}
      className="-my-1.5 inline-flex min-h-11 min-w-11 select-none items-center justify-center self-start"
      style={{ marginTop: 'var(--mark-offset)' }}
    >
      {plate}
    </button>
  );
}

/**
 * Target tension, rendered. The one place saturated semantic color is allowed,
 * which is precisely why it registers when it shows up.
 *
 * Plain words on purpose. This badge reports a state you have to act on, and
 * "Wide" — however well it fit the target-shooting language — is not something
 * anyone can guess. Flavour belongs on the nouns, not on a warning.
 */
export function TensionBadge({
  level,
  daysLeft,
}: {
  level: 'calm' | 'incoming' | 'wide';
  daysLeft?: number;
}) {
  if (level === 'calm') return null;
  const incoming = level === 'incoming';
  return (
    <span
      className="meta inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 uppercase"
      style={{
        background: incoming ? 'var(--incoming-soft)' : 'var(--wide-soft)',
        color: incoming ? 'var(--incoming)' : 'var(--wide)',
        fontVariationSettings: "'wght' 750",
      }}
    >
      {incoming ? `Due in ${daysLeft}d` : 'Late'}
    </span>
  );
}

/** How long a toast stays up before it clears itself. */
const TOAST_MS = 3200;

export function Toast({
  message,
  actionLabel,
  onAction,
  onDismiss,
  duration = TOAST_MS,
}: {
  message: string | null;
  actionLabel?: string;
  onAction?: () => void;
  /** Called when the toast times out or is tapped away. */
  onDismiss?: () => void;
  duration?: number;
}) {
  /**
   * The callback lives in a ref so the timer depends only on the message.
   * An inline arrow from the caller is a new function every render, and using
   * it as an effect dependency restarts the countdown on every unrelated
   * re-render — which, in an app that re-renders on every sync tick, means the
   * toast never times out at all.
   */
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => dismiss.current?.(), duration);
    return () => clearTimeout(t);
  }, [message, duration]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          // Keyed on the message so a second toast restarts the countdown
          // instead of inheriting whatever was left of the first one's.
          key={message}
          className="pointer-events-auto fixed inset-x-4 z-[60] flex cursor-pointer items-center
                     justify-between gap-4 overflow-hidden rounded-[var(--r-md)] bg-[var(--ink)]
                     px-5 py-4 text-[var(--bg)] shadow-[var(--shadow-3)]"
          style={{ bottom: 'calc(var(--inset-bottom) + 6.5rem + var(--bulk-sheet-h, 0px))' }}
          initial={{ y: 20, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.97 }}
          transition={settle}
          onClick={() => onDismiss?.()}
        >
          <span style={{ fontVariationSettings: "'wght' 550" }}>{message}</span>
          {actionLabel && (
            <button
              type="button"
              onClick={e => {
                // Without this the toast's own tap-to-dismiss fires too, and
                // the action runs against an already-closing toast.
                e.stopPropagation();
                onAction?.();
              }}
              className="meta shrink-0 uppercase"
              style={{ fontVariationSettings: "'wght' 800" }}
            >
              {actionLabel}
            </button>
          )}

          {/* The countdown. Deliberately a depleting bar rather than a number:
              it says "this is leaving on its own" without asking to be read.
              scaleX on its own layer, so it never triggers layout. */}
          <motion.span
            aria-hidden
            className="absolute bottom-0 left-0 h-[3px] w-full origin-left bg-[var(--bg)]/45"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: duration / 1000, ease: 'linear' }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Primary action. Big, certain, one per screen. */
export function BigButton({
  children,
  onClick,
  tone = 'ink',
  disabled,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: 'ink' | 'quiet' | 'hit' | 'wide';
  disabled?: boolean;
  className?: string;
}) {
  const tones = {
    ink: 'bg-[var(--ink)] text-[var(--bg)]',
    quiet: 'bg-[var(--surface-2)] text-[var(--ink)]',
    hit: 'bg-[var(--hit)] text-white',
    wide: 'bg-[var(--wide-soft)] text-[var(--wide)]',
  };
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={snap}
      className={`min-h-[var(--tap)] w-full rounded-[var(--r-md)] px-6 py-4 text-lg
                  disabled:opacity-35 ${tones[tone]} ${className}`}
      style={{ fontVariationSettings: "'wght' 700", letterSpacing: '-0.01em' }}
    >
      {children}
    </motion.button>
  );
}

/** Empty states carry the one editorial voice moment in the app. */
export function Empty({ line, sub }: { line: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center px-10 py-20 text-center">
      <p className="editorial text-3xl leading-tight text-[var(--ink-2)]">{line}</p>
      {sub && <p className="meta mt-3 text-[var(--ink-3)]">{sub}</p>}
    </div>
  );
}
