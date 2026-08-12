import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Slab } from '../design/Slab';
import { ClientDot, HorizonChip } from '../design/bits';
import { settle, snap, stagger } from '../design/springs';
import { reopenBullet } from '../data/mutations';
import { useCompleted, type CompletedRow } from '../data/store';
import { personName } from '../data/types';
import { relativeDay, shortDate, timeOfDay, today as todayFn } from '../lib/dates';

/**
 * Finished work, at the foot of the Shelf.
 *
 * Done should not mean gone. Bullet journalling treats the record of what you
 * actually did as worth keeping — and in a two-person space most of the value
 * is attribution and dates: who finished it, when, and which days the work
 * actually landed on.
 *
 * Collapsed by default so it never competes with the live pile.
 */
export function CompletedSection({ onZoom }: { onZoom: (id: string) => void }) {
  const rows = useCompleted();
  const [open, setOpen] = useState(false);

  if (rows.length === 0) return null;

  return (
    <section className="mt-12">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex min-h-[var(--tap)] w-full items-center justify-between px-2"
      >
        <span className="meta text-[var(--ink-3)] uppercase">
          Done · <span className="numeral">{rows.length}</span>
        </span>
        <span className="meta text-[var(--ink-3)] uppercase">{open ? 'Hide' : 'Show'}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={settle}
            className="mt-3 space-y-2.5"
          >
            {rows.map((row, i) => (
              <CompletedCard key={row.bullet.id} row={row} index={i} onZoom={onZoom} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function CompletedCard({
  row,
  index,
  onZoom,
}: {
  row: CompletedRow;
  index: number;
  onZoom: (id: string) => void;
}) {
  const today = todayFn();
  const { bullet, client, finished, log, children } = row;
  const [confirmBack, setConfirmBack] = useState(false);

  const doneCount = log.reduce((n, entry) => n + (entry.amount ?? 1), 0);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...settle, delay: stagger(index) }}
    >
      <Slab hue={client?.hue} tone="quiet">
        <div className="px-6 py-5 pl-8">
          <button type="button" onClick={() => onZoom(bullet.id)} className="w-full text-left">
            <h3
              className="display text-xl text-[var(--ink)]"
              style={{ color: 'var(--ink-2)', textDecoration: 'line-through' }}
            >
              {bullet.title}
            </h3>
          </button>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            {client && <ClientDot hue={client.hue} name={client.name} />}
            <HorizonChip horizon={bullet.horizon} size="sm" />
            {bullet.count && (
              <span className="meta text-[var(--ink-2)]">
                <span className="numeral">{Math.min(doneCount, bullet.count.total)}</span> of{' '}
                {bullet.count.total} {bullet.count.unit}
              </span>
            )}
            {bullet.deadline && (
              <span className="meta text-[var(--ink-3)]">
                Deadline was {shortDate(bullet.deadline)}
              </span>
            )}
          </div>

          {/* Who and when. In a two-person space this is most of the point. */}
          {finished && (
            <p className="meta mt-3 text-[var(--ink-2)]">
              {/* Anything finished before attribution existed still has a date
                  worth showing; only the name is missing. */}
              {finished.by ? `Finished by ${personName(finished.by)} · ` : 'Finished '}
              {relativeDay(isoDay(finished.at), today)} at {timeOfDay(finished.at)}
            </p>
          )}

          {/* The work log is the completed shots — what actually happened, not
              a separate audit trail that could disagree with them. */}
          {log.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {log.map((entry, i) => (
                <span
                  key={`${entry.date}-${i}`}
                  className="meta rounded-full bg-[var(--surface-3)] px-2.5 py-1 text-[var(--ink-2)]"
                >
                  {relativeDay(entry.date, today)}
                  {entry.amount !== undefined && (
                    <>
                      {' '}
                      · <span className="numeral">{entry.amount}</span>
                    </>
                  )}
                </span>
              ))}
            </div>
          )}

          {children.length > 0 && (
            <p className="meta mt-3 text-[var(--ink-3)]">
              <span className="numeral">{children.filter(c => c.state === 'done').length}</span> of{' '}
              <span className="numeral">{children.length}</span> pieces done
            </p>
          )}

          <div className="mt-4">
            {confirmBack ? (
              <div className="flex flex-wrap gap-2">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  transition={snap}
                  onClick={() => {
                    void reopenBullet(bullet.id);
                    setConfirmBack(false);
                  }}
                  className="meta min-h-11 rounded-full bg-[var(--ink)] px-4 text-[var(--bg)] uppercase"
                >
                  Yes, reopen it
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  transition={snap}
                  onClick={() => setConfirmBack(false)}
                  className="meta min-h-11 rounded-full bg-[var(--surface-3)] px-4 text-[var(--ink-2)] uppercase"
                >
                  Leave it
                </motion.button>
              </div>
            ) : (
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                transition={snap}
                onClick={() => setConfirmBack(true)}
                className="meta min-h-11 rounded-full bg-[var(--surface-3)] px-4 text-[var(--ink-2)] uppercase"
              >
                Bring it back
              </motion.button>
            )}
          </div>
        </div>
      </Slab>
    </motion.div>
  );
}

/** Epoch ms → 'YYYY-MM-DD' in local time, matching how days are stored. */
function isoDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
