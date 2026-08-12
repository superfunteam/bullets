import { motion, type HTMLMotionProps } from 'motion/react';
import { forwardRef, type ReactNode } from 'react';
import { snap } from './springs';

type Tone = 'default' | 'raised' | 'quiet' | 'sunken';

const TONES: Record<Tone, string> = {
  default: 'bg-[var(--surface)] shadow-[var(--shadow-1)] border-[var(--line)]',
  raised: 'bg-[var(--surface)] shadow-[var(--shadow-2)] border-[var(--line)]',
  quiet: 'bg-[var(--surface-2)] border-transparent',
  sunken: 'bg-[var(--surface-2)] border-[var(--line)] shadow-none',
};

type Props = Omit<HTMLMotionProps<'div'>, 'ref'> & {
  children: ReactNode;
  /** Client hue. Renders the accent spine down the leading edge. */
  hue?: number;
  tone?: Tone;
  interactive?: boolean;
  className?: string;
};

/**
 * The primary surface. Every tappable thing in Bullets is a Slab, which is
 * what keeps press physics identical everywhere instead of drifting per screen.
 *
 * A client's color appears as a spine on the leading edge rather than a fill,
 * so a screen holding eleven clients reads calm instead of like a bag of candy.
 */
export const Slab = forwardRef<HTMLDivElement, Props>(function Slab(
  { children, hue, tone = 'default', interactive, className = '', style, ...rest },
  ref,
) {
  const pressable = interactive ?? Boolean(rest.onClick);
  return (
    <motion.div
      ref={ref}
      whileTap={pressable ? { scale: 0.978 } : undefined}
      transition={snap}
      style={{ ...(hue !== undefined ? { ['--hue' as string]: hue } : {}), ...style }}
      className={`relative overflow-hidden rounded-[var(--r-lg)] border ${TONES[tone]} ${
        pressable ? 'cursor-pointer select-none' : ''
      } ${className}`}
      {...rest}
    >
      {hue !== undefined && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[7px]"
          style={{ background: `oklch(60% 0.16 ${hue})` }}
        />
      )}
      {children}
    </motion.div>
  );
});
