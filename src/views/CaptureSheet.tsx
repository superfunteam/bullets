import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Sheet } from '../design/Sheet';
import { BigButton, HorizonChip } from '../design/bits';
import { snap } from '../design/springs';
import { createBullet } from '../data/mutations';
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
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (info: { title: string; horizon: Horizon }) => void;
}) {
  const clients = useClients();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState('');
  const [horizon, setHorizon] = useState<Horizon>('shelf');
  const [clientId, setClientId] = useState<string | undefined>();
  const [deadline, setDeadline] = useState<string | undefined>();
  const [total, setTotal] = useState<number | undefined>();
  const [unit, setUnit] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setHorizon('shelf');
    setClientId(undefined);
    setDeadline(undefined);
    setTotal(undefined);
    setUnit('');
    const t = setTimeout(() => inputRef.current?.focus(), 220);
    return () => clearTimeout(t);
  }, [open]);

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    await createBullet({
      title: t,
      horizon,
      clientId,
      deadline,
      count: total && total > 1 ? { total, unit: unit.trim() || 'parts' } : undefined,
    });
    // A bullet captured with the default horizon lands on the Shelf, which is
    // collapsed by client — easy to save something and never see it again.
    onSaved?.({ title: t, horizon });
    onClose();
  };

  const today = todayFn();
  const targets: { label: string; day?: string }[] = [
    { label: 'None', day: undefined },
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

        <Field label="Horizon">
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
            <div className="flex flex-wrap gap-2">
              <Pill active={!clientId} onClick={() => setClientId(undefined)}>
                None
              </Pill>
              {clients
                .filter(c => !c.archived)
                .map(c => (
                  <Pill
                    key={c.id}
                    active={clientId === c.id}
                    hue={c.hue}
                    onClick={() => setClientId(c.id)}
                  >
                    {c.name}
                  </Pill>
                ))}
            </div>
          </Field>
        )}

        <Field label="Target">
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

        <BigButton onClick={save} disabled={!title.trim()}>
          Add bullet
        </BigButton>
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
