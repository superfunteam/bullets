import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { HuddleStrip } from './HuddleStrip';
import { BigButton, Empty } from '../design/bits';
import { settle, snap, stagger } from '../design/springs';
import { Icon } from '../design/icons';
import { useHuddles } from '../data/store';
import { relativeDay, timeOfDay, toDay, today as todayFn } from '../lib/dates';
import type { Huddle } from '../data/types';

/**
 * The huddle list. Its real job is telegraphing: the next one should be
 * legible from across the room, and nothing here should ever feel like an
 * inbox of requests waiting on you, because there are no requests.
 */

const endOf = (h: Huddle): number => h.startsAt + h.durationMin * 60_000;

const isToday = (ms: number): boolean => toDay(new Date(ms)) === todayFn();

/** 'today at 2pm' / 'Wed Aug 19 at 10am'. */
function whenPhrase(ms: number): string {
  const rel = relativeDay(toDay(new Date(ms)));
  const t = timeOfDay(ms);
  if (rel === 'Today') return `today at ${t}`;
  if (rel === 'Tomorrow') return `tomorrow at ${t}`;
  return `${rel} at ${t}`;
}

export function HuddlesView({
  onOpen,
  onRequest,
}: {
  onOpen: (id: string) => void;
  onRequest: () => void;
}) {
  const huddles = useHuddles();
  const [showDone, setShowDone] = useState(false);

  const { nextUp, earlier, done } = useMemo(() => {
    const now = Date.now();
    const live = huddles.filter(h => h.status !== 'done' && h.status !== 'cancelled');
    return {
      nextUp: live.filter(h => endOf(h) > now),
      // Ended but never wrapped. Newest first — the one you just finished is
      // the one you are most likely coming back to.
      earlier: live.filter(h => endOf(h) <= now).sort((a, b) => b.startsAt - a.startsAt),
      done: huddles
        .filter(h => h.status === 'done' || h.status === 'cancelled')
        .sort((a, b) => b.startsAt - a.startsAt),
    };
  }, [huddles]);

  const next = nextUp[0];
  // Honest labelling: don't say "today" over a strip from last Thursday.
  const earlierLabel = earlier.every(h => isToday(h.startsAt)) ? 'Earlier today' : 'Earlier';
  const nothingAtAll = huddles.length === 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-40">
      <header className="px-2 pt-6 pb-5">
        <p className="meta text-[var(--ink-3)] uppercase">Together</p>
        <h1 className="display mt-1 text-5xl text-[var(--ink)]">Huddles</h1>
        {next && (
          <p className="editorial mt-3 text-xl leading-snug text-[var(--ink-2)]">
            Next one {whenPhrase(next.startsAt)}.
          </p>
        )}
      </header>

      <div className="mb-8">
        <BigButton onClick={onRequest}>Call a huddle</BigButton>
        <p className="meta mt-2.5 text-center text-[var(--ink-3)]">
          Lands on both calendars. Nothing to approve.
        </p>
      </div>

      {nothingAtAll ? (
        <Empty
          line="Nothing on the books."
          sub="Call one whenever. Advance notice is the whole point."
        />
      ) : (
        <div className="space-y-9">
          <Section label="Next up" count={nextUp.length} huddles={nextUp} onOpen={onOpen} />

          {earlier.length > 0 && (
            <Section
              label={earlierLabel}
              count={earlier.length}
              huddles={earlier}
              onOpen={onOpen}
            />
          )}

          {done.length > 0 && (
            <section>
              <motion.button
                type="button"
                onClick={() => setShowDone(v => !v)}
                whileTap={{ scale: 0.98 }}
                transition={snap}
                className="flex min-h-12 w-full items-center gap-2 px-2 text-left"
              >
                <span className="meta text-[var(--ink-3)] uppercase">
                  Done · <span className="numeral">{done.length}</span>
                </span>
                <motion.span
                  aria-hidden
                  animate={{ rotate: showDone ? 90 : 0 }}
                  transition={snap}
                  className="inline-flex text-[var(--ink-3)]"
                >
                  <Icon name="chevron_right" size={18} />
                </motion.span>
              </motion.button>

              <AnimatePresence initial={false}>
                {showDone && (
                  <motion.div
                    key="done-list"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={settle}
                    className="mt-3 space-y-3"
                  >
                    {done.map((h, i) => (
                      <Row key={h.id} huddle={h} index={i} onOpen={onOpen} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  count,
  huddles,
  onOpen,
}: {
  label: string;
  count: number;
  huddles: Huddle[];
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="meta mb-3 px-2 text-[var(--ink-3)] uppercase">
        {label} · <span className="numeral">{count}</span>
      </h2>
      {huddles.length === 0 ? (
        <p className="editorial px-2 text-lg text-[var(--ink-3)]">Nothing ahead of us.</p>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {huddles.map((h, i) => (
              <Row key={h.id} huddle={h} index={i} onOpen={onOpen} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function Row({
  huddle,
  index,
  onOpen,
}: {
  huddle: Huddle;
  index: number;
  onOpen: (id: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ ...settle, delay: stagger(index), layout: settle }}
    >
      <HuddleStrip huddle={huddle} onOpen={() => onOpen(huddle.id)} />
    </motion.div>
  );
}
