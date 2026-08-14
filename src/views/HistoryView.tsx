import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Slab } from '../design/Slab';
import { Empty } from '../design/bits';
import { Icon } from '../design/icons';
import { settle, snap, stagger } from '../design/springs';
import { db } from '../data/db';
import { entriesFrom, type Entry } from '../data/history';
import { backfillHistory } from '../data/backfill';
import { useClients } from '../data/store';
import { personName, type Person } from '../data/types';
import { weekdayName, shortDate } from '../lib/dates';

/**
 * Everything that has happened, by whom.
 *
 * The rows are field-level ops; the entries are actions. See data/history.ts —
 * one tap of "Mark done" on a parent writes a dozen ops across several
 * entities, and a raw field feed would be a wall of "state: done".
 *
 * Every entry expands to its raw ops. That is what makes grouping safe to
 * ship: if describe() guesses wrong about an action, the unambiguous truth is
 * one tap away rather than lost.
 */

const PAGE = 60;

export function HistoryView({ onClose }: { onClose: () => void }) {
  const [limit, setLimit] = useState(PAGE);
  const [who, setWho] = useState<Person | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);

  const clients = useClients();

  // Backfill once on open: the server log predates this table on every device.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setFilling(true);
      try {
        await backfillHistory();
      } finally {
        if (!cancelled) setFilling(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useLiveQuery(async () => db.history.orderBy('ts').reverse().limit(limit).toArray(), [
    limit,
  ]);

  // Titles need the WHOLE log, not the page, or a name written long ago is lost.
  const titleRows = useLiveQuery(
    async () => db.history.where('field').equals('title').toArray(),
    [],
  );

  const bullets = useLiveQuery(async () => db.bullets.toArray(), []);

  const entries = useMemo<Entry[]>(() => {
    if (!rows) return [];
    const titles = new Map<string, string>();
    for (const b of bullets ?? []) {
      const rec = b as unknown as { id: string; title?: { value?: string } | string };
      const t = typeof rec.title === 'string' ? rec.title : rec.title?.value;
      if (t) titles.set(rec.id, t);
    }
    return entriesFrom(rows, {
      names: buildFrom(titleRows ?? []),
      titles,
      clients: new Map(clients.map(c => [c.id, c.name])),
    });
  }, [rows, titleRows, bullets, clients]);

  const shown = who === 'all' ? entries : entries.filter(e => e.actor === who);

  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      style={{ paddingTop: 'var(--inset-top)' }}
    >
      <div className="mx-auto w-full max-w-2xl px-5 pb-24">
        <div className="flex items-center justify-between py-4">
          <button
            type="button"
            onClick={onClose}
            className="meta -ml-2 flex min-h-11 items-center gap-0.5 px-2 text-[var(--ink-2)] uppercase"
          >
            <Icon name="chevron_left" size={18} />
            Back
          </button>
          {filling && <span className="meta text-[var(--ink-3)]">Catching up…</span>}
        </div>

        <h1 className="display text-5xl text-[var(--ink)]">History</h1>
        <p className="meta mt-2 text-[var(--ink-3)]">Everything either of you has done.</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {(['all', 'clark', 'angie'] as const).map(k => (
            <motion.button
              key={k}
              type="button"
              onClick={() => setWho(k)}
              whileTap={{ scale: 0.96 }}
              transition={snap}
              className="meta min-h-11 rounded-full px-4 py-2 uppercase"
              style={{
                background: who === k ? 'var(--ink)' : 'var(--surface-2)',
                color: who === k ? 'var(--bg)' : 'var(--ink-2)',
                fontVariationSettings: "'wght' 700",
              }}
            >
              {k === 'all' ? 'Everyone' : personName(k)}
            </motion.button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="mt-10">
            <Empty
              line={filling ? 'Catching up on the log…' : 'Nothing here yet.'}
              sub="Every change either of you makes shows up here."
            />
          </div>
        ) : (
          <ul className="mt-7 space-y-2.5">
            {shown.map((e, i) => (
              <motion.li
                key={e.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...settle, delay: stagger(i, 0.02, 0.2), layout: settle }}
              >
                <Slab tone="quiet" onClick={() => setOpen(open === e.key ? null : e.key)}>
                  <div className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <Who actor={e.actor} />
                      <div className="min-w-0 flex-1">
                        <p className="leading-snug text-[var(--ink)]">{e.text}</p>
                        {e.detail.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5">
                            {e.detail.map(d => (
                              <li key={d} className="meta text-[var(--ink-3)]">
                                ↳ {d}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="meta mt-1.5 text-[var(--ink-3)]">{when(e.ts)}</p>
                      </div>
                    </div>

                    {/* The unambiguous truth, one tap away, in case the sentence
                        above guessed wrong about what the action was. */}
                    <AnimatePresence initial={false}>
                      {open === e.key && (
                        <motion.ul
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={settle}
                          className="mt-3 overflow-hidden border-t border-[var(--line)] pt-3"
                        >
                          {e.rows.map(r => (
                            <li key={r.opId} className="meta text-[var(--ink-3)]">
                              {r.entity} · {r.field} → {preview(r.value)} · {r.actor}
                            </li>
                          ))}
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </div>
                </Slab>
              </motion.li>
            ))}
          </ul>
        )}

        {rows && rows.length >= limit && (
          <button
            type="button"
            onClick={() => setLimit(l => l + PAGE)}
            className="meta mt-6 min-h-11 w-full text-[var(--ink-2)] uppercase"
          >
            Show more
          </button>
        )}
      </div>
    </motion.div>
  );
}

function Who({ actor }: { actor: Person | null }) {
  // No initial for a machine write: naming a person there would credit the
  // wrong one, because completion is derived on whichever device pulled first.
  if (!actor) {
    return (
      <span
        aria-hidden
        className="mt-0.5 h-6 w-6 shrink-0 rounded-full"
        style={{ background: 'var(--surface-3)' }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="meta mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full uppercase"
      style={{
        background: actor === 'clark' ? 'var(--incoming-soft)' : 'var(--hit-soft)',
        color: actor === 'clark' ? 'var(--incoming)' : 'var(--hit)',
        fontVariationSettings: "'wght' 800",
      }}
    >
      {personName(actor)[0]}
    </span>
  );
}

function when(ts: number): string {
  const d = new Date(ts);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  return isToday ? `Today at ${time}` : `${weekdayName(day)} ${shortDate(day)} at ${time}`;
}

function preview(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'cleared';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  return String(v).slice(0, 60);
}

/** Local mirror of buildNames, kept here so the view owns its own memoisation. */
function buildFrom(rows: { entityId: string; ts: number; value: unknown; field: string }[]) {
  const out = new Map<string, { ts: number; value: string }[]>();
  for (const r of rows) {
    if (typeof r.value !== 'string') continue;
    const list = out.get(r.entityId) ?? [];
    list.push({ ts: r.ts, value: r.value });
    out.set(r.entityId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.ts - b.ts);
  return out;
}
