import { motion } from 'motion/react';
import { snap } from './springs';

/**
 * Giant plus/minus slabs, no text input. This is what you get when you pull a
 * portion of a counted bullet — "how many today?" — and it is deliberately the
 * opposite of the tiny number spinners we're escaping.
 */
export function Stepper({
  value,
  max,
  min = 1,
  unit,
  onChange,
}: {
  value: number;
  max: number;
  min?: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  const btn = `flex h-[var(--tap)] w-[var(--tap)] shrink-0 items-center justify-center
               rounded-[var(--r-md)] bg-[var(--surface-2)] text-3xl
               text-[var(--ink)] disabled:opacity-25`;

  return (
    <div className="flex items-center justify-center gap-7">
      <motion.button
        type="button"
        aria-label="One fewer"
        className={btn}
        whileTap={{ scale: 0.88 }}
        transition={snap}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </motion.button>

      <div className="min-w-[4.5rem] text-center">
        <motion.div
          key={value}
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={snap}
          className="numeral text-6xl leading-none text-[var(--ink)]"
        >
          {value}
        </motion.div>
        {unit && <div className="meta mt-2 text-[var(--ink-3)] uppercase">{unit}</div>}
      </div>

      <motion.button
        type="button"
        aria-label="One more"
        className={btn}
        whileTap={{ scale: 0.88 }}
        transition={snap}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </motion.button>
    </div>
  );
}
