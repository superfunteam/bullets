import { motion } from 'motion/react';
import { snap } from './springs';

export type Tab = 'today' | 'week' | 'shelf' | 'huddles';

/**
 * Inline SVG rather than glyph characters. Unicode block shapes render
 * inconsistently across Android WebView builds and read as mojibake when the
 * chosen face has no coverage.
 */
const ICONS: Record<Tab, (active: boolean) => React.ReactNode> = {
  today: a => (
    <>
      <circle cx="12" cy="12" r="8.5" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" opacity={a ? 1 : 0.5} />
    </>
  ),
  week: () => (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" strokeWidth="1.8" />
      <path d="M3.5 10h17" strokeWidth="1.8" />
      <path d="M8 3.5v3M16 3.5v3" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  shelf: () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="6" rx="2" strokeWidth="1.8" />
      <rect x="3.5" y="13.5" width="17" height="6" rx="2" strokeWidth="1.8" />
    </>
  ),
  huddles: () => (
    <>
      <circle cx="9" cy="12" r="5.2" strokeWidth="1.8" />
      <circle cx="15" cy="12" r="5.2" strokeWidth="1.8" />
    </>
  ),
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'shelf', label: 'Shelf' },
  { id: 'huddles', label: 'Huddles' },
];

/** Four giant targets and one capture button, all inside thumb reach. */
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
              aria-label={t.label}
              whileTap={{ scale: 0.92 }}
              transition={snap}
              aria-current={active ? 'page' : undefined}
              /* min-w-0 is load-bearing: flex-1 refuses to shrink below its
                 text content, so at large system font sizes the labels pushed
                 the capture button clean off the right edge of the screen. */
              className="relative flex min-h-[var(--tap)] min-w-0 flex-1 flex-col
                         items-center justify-center gap-1 rounded-[var(--r-md)] py-1"
            >
              {active && (
                <motion.span
                  layoutId="tab-pill"
                  transition={snap}
                  className="absolute inset-0 rounded-[var(--r-md)] bg-[var(--surface-2)]"
                />
              )}
              <span className="relative" style={{ color: active ? 'var(--ink)' : 'var(--ink-3)' }}>
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  aria-hidden
                >
                  {ICONS[t.id](active)}
                </svg>
                {t.id === 'huddles' && huddleBadge ? (
                  <span
                    className="absolute -top-0.5 -right-1 h-2.5 w-2.5 rounded-full ring-2"
                    style={{
                      background: 'var(--incoming)',
                      // Ring matches the pill behind it so the dot reads as raised.
                      ['--tw-ring-color' as string]: active
                        ? 'var(--surface-2)'
                        : 'var(--surface)',
                    }}
                  />
                ) : null}
              </span>
              {/* At huge text the labels stop fitting. The icons carry the
                  meaning, so drop the labels rather than shrink the targets —
                  aria-label keeps them named for screen readers either way. */}
              <span
                className="meta relative max-w-full truncate text-[0.6875rem]
                           [html[data-text-scale='huge']_&]:hidden"
                style={{ color: active ? 'var(--ink)' : 'var(--ink-3)' }}
              >
                {t.label}
              </span>
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
                     text-[var(--bg)] shadow-[var(--shadow-2)]"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </motion.button>
      </div>
    </nav>
  );
}
