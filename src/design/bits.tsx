import { AnimatePresence, motion } from 'motion/react';
import { HORIZON_META, KIND_GLYPH, type BulletKind, type Horizon } from '../data/types';
import { settle, snap } from './springs';

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
        background: active ? `oklch(60% 0.14 ${meta.hue} / 0.16)` : 'var(--surface-2)',
        color: active ? `oklch(45% 0.15 ${meta.hue})` : 'var(--ink-2)',
        fontVariationSettings: "'wght' 700",
        letterSpacing: '0.06em',
      }}
    >
      <span aria-hidden>{meta.emoji}</span>
      {meta.label}
    </span>
  );
}

export function ClientDot({ hue, name }: { hue: number; name?: string }) {
  return (
    <span className="meta inline-flex items-center gap-2 text-[var(--ink-2)]">
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: `oklch(60% 0.16 ${hue})` }}
      />
      {name}
    </span>
  );
}

/**
 * Classic bullet journal signifier: a filled dot for a task, a ring for an
 * event, a dash for a note.
 *
 * Drawn rather than typed. The glyph characters render at wildly different
 * optical sizes across faces, which left the mark looking orphaned next to a
 * large title instead of anchoring it.
 */
export function KindGlyph({ kind, size = 16 }: { kind: BulletKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      className="shrink-0 text-[var(--ink-3)]"
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

export { KIND_GLYPH };

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

/** Undo affordance. Its existence is what lets completion skip confirmation. */
export function Toast({
  message,
  actionLabel,
  onAction,
}: {
  message: string | null;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="pointer-events-auto fixed inset-x-4 z-[60] flex items-center
                     justify-between gap-4 rounded-[var(--r-md)] bg-[var(--ink)]
                     px-5 py-4 text-[var(--bg)] shadow-[var(--shadow-3)]"
          style={{ bottom: 'calc(var(--inset-bottom) + 6.5rem)' }}
          initial={{ y: 20, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.97 }}
          transition={settle}
        >
          <span style={{ fontVariationSettings: "'wght' 550" }}>{message}</span>
          {actionLabel && (
            <button
              type="button"
              onClick={onAction}
              className="meta shrink-0 uppercase"
              style={{ fontVariationSettings: "'wght' 800" }}
            >
              {actionLabel}
            </button>
          )}
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
