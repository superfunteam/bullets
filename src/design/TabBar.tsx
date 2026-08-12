import { motion } from 'motion/react';
import { snap } from './springs';

export type Tab = 'today' | 'week' | 'shelf' | 'huddles';

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'today', label: 'Today', glyph: '◉' },
  { id: 'week', label: 'Week', glyph: '▤' },
  { id: 'shelf', label: 'Shelf', glyph: '▥' },
  { id: 'huddles', label: 'Huddles', glyph: '◑' },
];

/** Four giant targets and one capture button. Everything is thumb-reachable. */
export function TabBar({
  tab,
  onTab,
  onCapture,
  huddleBadge,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  onCapture: () => void;
  huddleBadge?: number;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)]
                 bg-[var(--surface)]/92 backdrop-blur-xl"
      style={{ paddingBottom: 'var(--inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-2xl items-stretch gap-1 px-3 pt-2 pb-2">
        {TABS.map(t => {
          const active = t.id === tab;
          return (
            <motion.button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              whileTap={{ scale: 0.92 }}
              transition={snap}
              className="relative flex min-h-[var(--tap)] flex-1 flex-col items-center
                         justify-center gap-1 rounded-[var(--r-md)] py-1"
            >
              {active && (
                <motion.span
                  layoutId="tab-pill"
                  transition={snap}
                  className="absolute inset-0 rounded-[var(--r-md)] bg-[var(--surface-2)]"
                />
              )}
              <span
                className="relative text-lg"
                style={{ color: active ? 'var(--ink)' : 'var(--ink-3)' }}
              >
                {t.glyph}
              </span>
              <span
                className="meta relative text-[0.6875rem]"
                style={{ color: active ? 'var(--ink)' : 'var(--ink-3)' }}
              >
                {t.label}
              </span>
              {t.id === 'huddles' && huddleBadge ? (
                <span
                  className="absolute top-1 right-1/4 h-2 w-2 rounded-full"
                  style={{ background: 'var(--incoming)' }}
                />
              ) : null}
            </motion.button>
          );
        })}

        <motion.button
          type="button"
          aria-label="Add a bullet"
          onClick={onCapture}
          whileTap={{ scale: 0.9 }}
          transition={snap}
          className="ml-1 flex h-[var(--tap)] w-[var(--tap)] shrink-0 items-center
                     justify-center self-center rounded-[var(--r-md)] bg-[var(--ink)]
                     text-3xl text-[var(--bg)] shadow-[var(--shadow-2)]"
          style={{ fontVariationSettings: "'wght' 400" }}
        >
          +
        </motion.button>
      </div>
    </nav>
  );
}
