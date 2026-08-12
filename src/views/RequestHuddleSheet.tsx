import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Sheet } from '../design/Sheet';
import { BigButton, ClientDot, KindGlyph } from '../design/bits';
import { Slab } from '../design/Slab';
import { snap } from '../design/springs';
import { addHuddleItem, callHuddle } from '../data/mutations';
import { useBullets, useClients } from '../data/store';
import { addDays, fromDay, relativeDay, timeOfDay, toDay, today as todayFn, type Day } from '../lib/dates';
import type { Bullet, Client } from '../data/types';

/**
 * Calling a huddle.
 *
 * The whole screen is built around the fact that there is no approval step.
 * Clark's problem was never the meeting, it was being ambushed by one, so the
 * job here is to make picking a time *fast enough that it always gets picked
 * in advance*. Giant presets do that; a date picker does not.
 */

const DURATIONS = [15, 30, 60];

const QUARTER = 15 * 60_000;

/** Round to the next quarter hour. "In an hour" should land on a real time. */
const roundUp = (ms: number): number => Math.ceil(ms / QUARTER) * QUARTER;

function atTime(day: Day, hour: number): number {
  const d = fromDay(day);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** The upcoming Monday, never today — "Monday" reads as the start of next week. */
function nextMonday(from: Day): Day {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(from, i);
    if (fromDay(d).getDay() === 1) return d;
  }
  return addDays(from, 7);
}

const toLocalInput = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
};

/** 'today at 2pm' / 'Wed Aug 19 at 10am'. Used wherever a time is confirmed back. */
function whenPhrase(ms: number): string {
  const rel = relativeDay(toDay(new Date(ms)));
  const t = timeOfDay(ms);
  if (rel === 'Today') return `today at ${t}`;
  if (rel === 'Tomorrow') return `tomorrow at ${t}`;
  return `${rel} at ${t}`;
}

export function RequestHuddleSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const bullets = useBullets();
  const clients = useClients();

  const [startsAt, setStartsAt] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState(30);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Presets are computed once per opening. Recomputing every render would make
  // "In an hour" creep forward while you are still deciding.
  const presets = useMemo(() => {
    if (!open) return [];
    const now = Date.now();
    const t = todayFn();
    const all = [
      { key: 'hour', label: 'In an hour', at: roundUp(now + 60 * 60_000) },
      { key: 'afternoon', label: 'This afternoon', at: atTime(t, 14) },
      { key: 'tmw-am', label: 'Tomorrow', at: atTime(addDays(t, 1), 10) },
      { key: 'tmw-pm', label: 'Tomorrow', at: atTime(addDays(t, 1), 14) },
      { key: 'monday', label: 'Monday', at: atTime(nextMonday(t), 10) },
    ];
    return all.filter(p => p.at > now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStartsAt(null);
    setDurationMin(30);
    setTitle('');
    setQuery('');
    setChosen([]);
    setSaving(false);
  }, [open]);

  const clientById = useMemo(() => {
    const m = new Map<string, Client>();
    for (const c of clients) m.set(c.id, c);
    return m;
  }, [clients]);

  const chosenBullets = useMemo(
    () => chosen.map(id => bullets.find(b => b.id === id)).filter(Boolean) as Bullet[],
    [chosen, bullets],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const openBullets = bullets.filter(b => b.state === 'open' && !chosen.includes(b.id));
    const matched = q
      ? openBullets.filter(b => {
          const client = b.clientId ? clientById.get(b.clientId) : undefined;
          return (
            b.title.toLowerCase().includes(q) ||
            (client?.name.toLowerCase().includes(q) ?? false)
          );
        })
      : openBullets;
    return [...matched].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, q ? 12 : 6);
  }, [bullets, chosen, clientById, query]);

  const save = async () => {
    if (!startsAt || saving) return;
    setSaving(true);
    try {
      const id = await callHuddle({
        startsAt,
        durationMin,
        title: title.trim() || undefined,
      });
      for (const bulletId of chosen) await addHuddleItem(id, { bulletId });
      onCreated(id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Call a huddle">
      <div className="space-y-8 px-6 pt-4">
        <p className="editorial text-xl leading-snug text-[var(--ink-2)]">
          Pick a time. No one has to say yes.
        </p>

        <Field label="When">
          <div className="grid grid-cols-2 gap-3">
            {presets.map((p, i) => {
              const active = startsAt === p.at;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setStartsAt(p.at)}
                  className={`text-left ${i === 0 ? 'col-span-2' : ''}`}
                >
                  <Slab
                    tone={active ? 'raised' : 'sunken'}
                    interactive
                    className={active ? 'ring-2 ring-[var(--ink)]' : ''}
                  >
                    <div
                      className={
                        i === 0
                          ? 'flex min-h-[96px] flex-row items-center justify-between gap-4 px-5 py-5'
                          : 'flex min-h-[96px] flex-col justify-between px-5 py-5'
                      }
                    >
                      <p className="display text-xl text-[var(--ink)]">{p.label}</p>
                      <p
                        className={i === 0 ? 'numeral text-3xl' : 'numeral mt-3 text-2xl'}
                        style={{ color: active ? 'var(--ink)' : 'var(--ink-2)' }}
                      >
                        {timeOfDay(p.at)}
                      </p>
                    </div>
                  </Slab>
                </button>
              );
            })}
          </div>

          {/* The fallback, deliberately quiet. If this is where you spend your
              time, the presets above are wrong and should be fixed instead. */}
          <div className="mt-4 flex items-center gap-3 rounded-[var(--r-md)] bg-[var(--surface-2)] px-4 py-3">
            <span className="meta shrink-0 text-[var(--ink-3)] uppercase">Or</span>
            <input
              type="datetime-local"
              value={startsAt ? toLocalInput(startsAt) : ''}
              onChange={e => {
                const ms = new Date(e.target.value).getTime();
                setStartsAt(Number.isNaN(ms) ? null : ms);
              }}
              className="min-h-11 min-w-0 flex-1 text-[var(--ink)]"
              style={{ fontVariationSettings: "'wght' 560" }}
            />
          </div>
        </Field>

        <Field label="How long">
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map(d => (
              <Pill key={d} active={durationMin === d} onClick={() => setDurationMin(d)}>
                <span className="numeral">{d}</span> min
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="About">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Optional — what's it about?"
            className="display w-full text-2xl leading-tight text-[var(--ink)]
                       placeholder:text-[var(--ink-3)]"
            style={{ fontVariationSettings: "'wght' 620, 'wdth' 92" }}
          />
        </Field>

        <Field label="Bring to the table">
          {chosenBullets.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {chosenBullets.map(b => {
                const client = b.clientId ? clientById.get(b.clientId) : undefined;
                return (
                  <motion.button
                    key={b.id}
                    type="button"
                    layout
                    transition={snap}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => setChosen(prev => prev.filter(id => id !== b.id))}
                    className="flex min-h-11 max-w-full items-center gap-2 rounded-full
                               bg-[var(--surface-2)] py-2.5 pr-3 pl-4"
                  >
                    {client && (
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: `oklch(60% 0.16 ${client.hue})` }}
                      />
                    )}
                    <span
                      className="min-w-0 truncate text-[var(--ink)]"
                      style={{ fontVariationSettings: "'wght' 620" }}
                    >
                      {b.title}
                    </span>
                    <span aria-hidden className="shrink-0 text-lg text-[var(--ink-3)]">
                      ×
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}

          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search open bullets"
            className="min-h-12 w-full rounded-[var(--r-md)] bg-[var(--surface-2)] px-4 py-3
                       text-[var(--ink)] placeholder:text-[var(--ink-3)]"
            style={{ fontVariationSettings: "'wght' 560" }}
          />

          <div className="mt-2 space-y-1.5">
            {results.map(b => {
              const client = b.clientId ? clientById.get(b.clientId) : undefined;
              return (
                <motion.button
                  key={b.id}
                  type="button"
                  whileTap={{ scale: 0.985 }}
                  transition={snap}
                  onClick={() => {
                    setChosen(prev => [...prev, b.id]);
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  className="flex min-h-[var(--tap)] w-full items-center gap-3 rounded-[var(--r-md)]
                             px-4 py-3 text-left"
                >
                  <span className="text-lg">
                    <KindGlyph kind={b.kind} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[var(--ink)]"
                      style={{ fontVariationSettings: "'wght' 600" }}
                    >
                      {b.title}
                    </span>
                    {client && (
                      <span className="mt-0.5 block">
                        <ClientDot hue={client.hue} name={client.name} />
                      </span>
                    )}
                  </span>
                  <span aria-hidden className="shrink-0 text-xl text-[var(--ink-3)]">
                    +
                  </span>
                </motion.button>
              );
            })}
            {query.trim() && results.length === 0 && (
              <p className="meta px-4 py-3 text-[var(--ink-3)]">Nothing open by that name.</p>
            )}
          </div>
        </Field>

        <div>
          <BigButton onClick={save} disabled={!startsAt || saving}>
            {startsAt ? `Put it on both calendars` : 'Pick a time'}
          </BigButton>
          <p className="meta mt-3 text-center text-[var(--ink-3)]">
            {startsAt
              ? `This goes straight on both calendars — ${whenPhrase(startsAt)}, ${durationMin} minutes.`
              : 'This goes straight on both calendars. There is no request to approve.'}
          </p>
        </div>
      </div>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="meta mb-2.5 text-[var(--ink-3)] uppercase">{label}</p>
      {children}
    </div>
  );
}

function Pill({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      transition={snap}
      onClick={onClick}
      className="min-h-12 rounded-full px-5 py-2.5"
      style={{
        background: active ? 'var(--ink)' : 'var(--surface-2)',
        color: active ? 'var(--bg)' : 'var(--ink-2)',
        fontVariationSettings: "'wght' 640",
      }}
    >
      {children}
    </motion.button>
  );
}
