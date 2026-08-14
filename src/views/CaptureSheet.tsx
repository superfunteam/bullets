import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Sheet } from '../design/Sheet';
import { BigButton, ClientPill, HorizonChip } from '../design/bits';
import { Icon } from '../design/icons';
import { snap } from '../design/springs';
import { createBullet } from '../data/mutations';
import { db } from '../data/db';
import { useClients } from '../data/store';
import { addDays, today as todayFn } from '../lib/dates';
import { HORIZONS, type Horizon } from '../data/types';

/**
 * Capture. Title, client, horizon, and optionally a target and a count.
 * That is the entire vocabulary of a bullet, and it should stay that way —
 * every field we resist here is a field neither of us has to maintain later.
 */
export function CaptureSheet({
  open,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (info: { title: string; horizon: Horizon }) => void;
  onError?: (message: string) => void;
}) {
  const clients = useClients();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState('');
  const [horizon, setHorizon] = useState<Horizon>('shelf');
  const [clientId, setClientId] = useState<string | undefined>();
  const [pickingClient, setPickingClient] = useState(false);
  const [deadline, setDeadline] = useState<string | undefined>();
  const [total, setTotal] = useState<number | undefined>();
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);

  const chosenClient = clients.find(c => c.id === clientId);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setHorizon('shelf');
    setClientId(defaultClientId(clients));
    setPickingClient(false);
    setDeadline(undefined);
    setTotal(undefined);
    setUnit('');
    setSaving(false);
    const t = setTimeout(() => inputRef.current?.focus(), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset is per open
  }, [open]);

  /**
   * Clients come from a live query, so on a cold start the sheet can open a tick
   * before they exist and the reset above has nothing to default to. Fill it in
   * once they land — but only while the field is still untouched, so this can
   * never overwrite a choice already made.
   */
  const touchedClient = useRef(false);
  useEffect(() => {
    if (!open || touchedClient.current || clientId) return;
    const fallback = defaultClientId(clients);
    if (fallback) setClientId(fallback);
  }, [open, clients, clientId]);

  const save = async () => {
    const t = title.trim();
    // createBullet awaits a Dexie transaction, so a double tap on a slow
    // device got through twice and created two bullets.
    if (!t || saving) return;
    setSaving(true);
    try {
      await createBullet({
        title: t,
        horizon,
        clientId,
        deadline,
        count: total && total > 1 ? { total, unit: unit.trim() || 'parts' } : undefined,
      });
      onSaved?.({ title: t, horizon });
      onClose();
    } catch (err) {
      /**
       * A rejected save must not eat the capture. iPhone Safari closes the
       * IndexedDB connection when a tab backgrounds and the next transaction
       * throws DatabaseClosedError; before this, that wedged the button
       * forever, showed nothing, and closing the sheet wiped the draft — a
       * task the user firmly believes they saved. The sheet stays open, the
       * draft stays typed, and one reopen attempt covers the Safari case.
       */
      try {
        await db.open();
      } catch {
        /* stays closed — the retry below will surface it again */
      }
      onError?.(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const today = todayFn();
  const targets: { label: string; day?: string }[] = [
    { label: 'No deadline', day: undefined },
    { label: 'Today', day: today },
    { label: 'Tomorrow', day: addDays(today, 1) },
    { label: 'This Friday', day: nextFriday(today) },
    { label: 'Next week', day: addDays(today, 7) },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="New bullet">
      <div className="space-y-7 px-6 pt-5">
        <textarea
          ref={inputRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          rows={2}
          placeholder="What is it?"
          className="display w-full resize-none text-3xl leading-tight
                     text-[var(--ink)] placeholder:text-[var(--ink-3)]"
        />

        <Field label="When will you do it?">
          <div className="flex flex-wrap gap-2">
            {HORIZONS.map(h => (
              <motion.button
                key={h}
                type="button"
                whileTap={{ scale: 0.94 }}
                transition={snap}
                onClick={() => setHorizon(h)}
              >
                <HorizonChip horizon={h} size="lg" active={horizon === h} />
              </motion.button>
            ))}
          </div>
        </Field>

        {clients.length > 0 && (
          <Field label="Client">
            {/* One row, not every client at once. With five of them the pills
                were the tallest thing in the sheet and pushed the deadline and
                count fields below the fold on a phone. */}
            <motion.button
              type="button"
              onClick={() => setPickingClient(true)}
              whileTap={{ scale: 0.98 }}
              transition={snap}
              className="flex min-h-[var(--tap)] w-full items-center justify-between gap-3
                         rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-2)]
                         px-4 py-3 text-left"
            >
              {chosenClient ? (
                <ClientPill hue={chosenClient.hue} name={chosenClient.name} />
              ) : (
                <span className="text-[var(--ink-3)]">No client</span>
              )}
              <Icon name="chevron_right" size={18} className="text-[var(--ink-3)]" />
            </motion.button>
          </Field>
        )}

        {/* Renamed and demoted on purpose. Sitting under the horizon row and
            labelled "Target", the "Today" chip read as *schedule it for today*
            — so a bullet picked up a hard deadline nobody meant to set, and
            then a countdown nobody asked for. Horizon is when you will do it;
            this is only for a date someone else is holding you to. */}
        <Field label="Hard deadline — only if a client set one">
          <div className="flex flex-wrap gap-2">
            {targets.map(t => (
              <Pill key={t.label} active={deadline === t.day} onClick={() => setDeadline(t.day)}>
                {t.label}
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="How many">
          {/* Wraps like every other field row. Without this the count pills run
              off the right edge at large system font sizes. */}
          <div className="flex flex-wrap items-center gap-2">
            <Pill active={!total} onClick={() => setTotal(undefined)}>
              Just one
            </Pill>
            {[5, 10, 20].map(n => (
              <Pill key={n} active={total === n} onClick={() => setTotal(n)}>
                {n}
              </Pill>
            ))}
            {total && (
              <input
                value={unit}
                onChange={e => setUnit(e.target.value)}
                placeholder="posts"
                className="meta min-h-11 w-full min-w-[6rem] flex-1 rounded-[var(--r-sm)]
                           bg-[var(--surface-2)] px-3 py-2.5 text-[var(--ink)]
                           placeholder:text-[var(--ink-3)]"
              />
            )}
          </div>
        </Field>

        <BigButton onClick={save} disabled={!title.trim() || saving}>
          Add bullet
        </BigButton>
      </div>

      {/* layer="over" portals this to <body>: nested inside the capture sheet's
          scrolling body it would share a gesture surface with its drag. */}
      <Sheet
        open={pickingClient}
        onClose={() => setPickingClient(false)}
        title="Client"
        layer="over"
      >
        <ul className="px-5 pt-1 pb-2">
          {[undefined, ...clients.filter(c => !c.archived).map(c => c.id)].map(id => {
            const c = clients.find(x => x.id === id);
            const active = clientId === id;
            return (
              <li key={id ?? 'none'}>
                <motion.button
                  type="button"
                  onClick={() => {
                    touchedClient.current = true;
                    setClientId(id);
                    setPickingClient(false);
                  }}
                  whileTap={{ scale: 0.99 }}
                  transition={snap}
                  className="flex min-h-[var(--tap)] w-full items-center justify-between gap-3
                             border-b border-[var(--line)] py-3.5 text-left last:border-b-0"
                >
                  {c ? (
                    <ClientPill hue={c.hue} name={c.name} />
                  ) : (
                    <span className="text-[var(--ink-2)]">No client</span>
                  )}
                  {active && (
                    <Icon name="check" size={20} className="text-[var(--hit)]" />
                  )}
                </motion.button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </Sheet>
  );
}

/**
 * Fun is the default because most of what these two capture is their own work,
 * not a client's — so the common case should cost no taps. Matched by name
 * rather than id: the clients are seeded per device, so the ids differ between
 * Clark's phone and Angie's while the names do not.
 */
function defaultClientId(clients: { id: string; name: string; archived?: boolean }[]) {
  return clients.find(c => !c.archived && c.name.trim().toLowerCase() === 'fun')?.id;
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
  hue,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  hue?: number;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      transition={snap}
      onClick={onClick}
      className="min-h-11 rounded-full px-4 py-2.5"
      style={{
        background:
          active && hue !== undefined
            ? `oklch(60% 0.15 ${hue} / 0.18)`
            : active
              ? 'var(--ink)'
              : 'var(--surface-2)',
        color:
          active && hue !== undefined
            ? `oklch(45% 0.16 ${hue})`
            : active
              ? 'var(--bg)'
              : 'var(--ink-2)',
        fontVariationSettings: "'wght' 640",
      }}
    >
      {children}
    </motion.button>
  );
}

function nextFriday(from: string): string {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(from, i);
    if (new Date(`${d}T00:00:00`).getDay() === 5) return d;
  }
  return addDays(from, 7);
}
