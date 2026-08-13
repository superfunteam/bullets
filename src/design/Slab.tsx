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
  tone?: Tone;
  interactive?: boolean;
  className?: string;
};

/**
 * The primary surface. Every tappable thing in Bullets is a Slab, which is
 * what keeps press physics identical everywhere instead of drifting per screen.
 *
 * The client spine that used to run down the leading edge is gone; ClientPill
 * in bits.tsx carries client identity now, and its docstring holds the
 * calm-vs-candy argument this one used to make.
 */
export const Slab = forwardRef<HTMLDivElement, Props>(function Slab(
  { children, tone = 'default', interactive, className = '', style, ...rest },
  ref,
) {
  const pressable = interactive ?? Boolean(rest.onClick);
  return (
    <motion.div
      ref={ref}
      whileTap={pressable ? { scale: 0.978 } : undefined}
      transition={snap}
      style={style}
      className={`relative overflow-hidden rounded-[var(--r-lg)] border ${TONES[tone]} ${
        pressable ? 'cursor-pointer select-none' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
});
