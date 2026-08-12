import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Slab } from '../design/Slab';
import { BigButton, Empty, HorizonChip, KindGlyph, TensionBadge } from '../design/bits';
import { settle, snap, stagger } from '../design/springs';
import { byUrgency, tensionOf } from '../data/selectors';
import { useAllShots, useClients, useShelf } from '../data/store';
import { shortDate, today as todayFn } from '../lib/dates';
import type { Bullet, Shot } from '../data/types';

/**
 * Everything we have not decided on yet, filed by client and shut by default.
 *
 * The shelf is the one place in Bullets that is allowed to be long, which is
 * exactly why it opens closed: a wall of undecided work is the thing that makes
 * people stop opening an app. You come here to run the Weekly Pull, or to open
 * one client and look it in the eye. Both of those start with a shut drawer.
 */

const OPEN_KEY = 'bullets.shelfOpen';
const NO_CLIENT = '~none';

/** One identity for "no shots", so the grouping memo isn't churned by a literal. */
const NO_SHOTS: Shot[] = [];

type Tension = ReturnType<typeof tensionOf>;
type Row = { bullet: Bullet; tension: Tension };
type Group = { key: string; name: string; hue?: number; rows: Row[] };

function readOpen(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [],
    );
  } catch {
    // Unreadable or unavailable storage just means everything starts shut.
    return new Set();
  }
}

export function ShelfView({
  onZoom,
  onStartWeeklyPull,
}: {
  onZoom: (id: string) => void;
  onStartWeeklyPull: () => void;
}) {
  const today = todayFn();
  const shelf = useShelf();
  const clients = useClients();

  /**
   * Live shots, bucketed by bullet.
   *
   * Rows used to hand tensionOf an empty list, which badged a 'later' bullet
   * Incoming even when it already had a commitment on a calendar — the app
   * shouting about work that has in fact been aimed at.
   */
  const allShots = useAllShots();
  const shotsByBullet = useMemo(() => {
    const map = new Map<string, Shot[]>();
    for (const shot of allShots) {
      const list = map.get(shot.bulletId);
      if (list) list.push(shot);
      else map.set(shot.bulletId, [shot]);
    }
    return map;
  }, [allShots]);

  const [open, setOpen] = useState<Set<string>>(readOpen);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
    } catch {
      // Forgetting which drawers were open is survivable.
    }
  }, [open]);

  const toggle = (key: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groups = useMemo<Group[]>(() => {
    const clientById = new Map(clients.map(c => [c.id, c] as const));
    const buckets = new Map<string, Group>();

    for (const bullet of shelf) {
      const client = bullet.clientId ? clientById.get(bullet.clientId) : undefined;
      const key = bullet.clientId ?? NO_CLIENT;
      let group = buckets.get(key);
      if (!group) {
        group = {
          key,
          name: key === NO_CLIENT ? 'No client' : (client?.name ?? 'Client'),
          hue: client?.hue,
          rows: [],
        };
        buckets.set(key, group);
      }
      group.rows.push({
        bullet,
        tension: tensionOf(bullet, shotsByBullet.get(bullet.id) ?? NO_SHOTS, today),
      });
    }

    const list = [...buckets.values()];
    for (const group of list) group.rows.sort(byUrgency);
    return list.sort((a, b) => {
      if (a.key === NO_CLIENT) return 1;
      if (b.key === NO_CLIENT) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [shelf, clients, shotsByBullet, today]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-40">
      <header className="px-2 pt-6 pb-5">
        <p className="meta text-[var(--ink-3)] uppercase">To be decided on</p>
        <h1 className="display mt-1 text-5xl text-[var(--ink)]">Shelf</h1>
      </header>

      {shelf.length === 0 ? (
        <Empty
          line="Nothing on the shelf."
          sub="Whatever you capture lands here, waiting to be decided on."
        />
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={settle}
            className="mb-8"
          >
            <BigButton onClick={onStartWeeklyPull}>
              <span className="flex items-center justify-center gap-3">
                Run the Weekly Pull
                <span className="numeral rounded-full bg-[var(--bg)]/20 px-2.5 py-0.5 text-base">
                  {shelf.length}
                </span>
              </span>
            </BigButton>
          </motion.div>

          <div className="space-y-3">
            {groups.map((group, i) => (
              <ClientDrawer
                key={group.key}
                group={group}
                index={i}
                open={open.has(group.key)}
                onToggle={() => toggle(group.key)}
                onZoom={onZoom}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ClientDrawer({
  group,
  index,
  open,
  onToggle,
  onZoom,
}: {
  group: Group;
  index: number;
  open: boolean;
  onToggle: () => void;
  onZoom: (id: string) => void;
}) {
  return (
    <motion.section
      // Position, never size. A plain `layout` animates the drawer's own height
      // as a scale, and everything inside it — the client name, the count —
      // rides that scale and visibly stretches on every open and close. The
      // drawer's height is allowed to snap; what has to be smooth is the
      // drawers below it sliding down, which is a position change.
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      // The stagger belongs to the first reveal only. Left on the layout
      // animation it delays the drawers below a toggle, so the stack answers
      // the tap late.
      transition={{ ...settle, delay: stagger(index), layout: settle }}
    >
      <motion.button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        whileTap={{ scale: 0.985 }}
        transition={snap}
        className="w-full"
      >
        <Slab hue={group.hue} tone={open ? 'default' : 'quiet'} interactive>
          <div className="flex min-h-[var(--tap)] items-center gap-3.5 px-5 py-4 pl-7">
            <motion.span
              aria-hidden
              animate={{ rotate: open ? 90 : 0 }}
              transition={snap}
              className="shrink-0 text-[var(--ink-3)]"
            >
              ▸
            </motion.span>
            {group.hue !== undefined ? (
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: `oklch(60% 0.16 ${group.hue})` }}
              />
            ) : (
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--line-strong)]"
              />
            )}
            <span className="display min-w-0 flex-1 truncate text-left text-2xl text-[var(--ink)]">
              {group.name}
            </span>
            <span className="numeral shrink-0 text-xl text-[var(--ink-3)]">
              {group.rows.length}
            </span>
          </div>
        </Slab>
      </motion.button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rows"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={settle}
            className="mt-2.5 space-y-2.5 pl-3"
          >
            {group.rows.map(row => (
              <ShelfRow key={row.bullet.id} row={row} hue={group.hue} onZoom={onZoom} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function ShelfRow({
  row,
  hue,
  onZoom,
}: {
  row: Row;
  hue?: number;
  onZoom: (id: string) => void;
}) {
  const { bullet, tension } = row;

  return (
    <Slab hue={hue} onClick={() => onZoom(bullet.id)}>
      <div className="flex min-h-[var(--tap)] items-start gap-3 px-5 py-4 pl-7">
        <span className="mt-0.5 text-lg">
          <KindGlyph kind={bullet.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="display text-xl text-[var(--ink)]">{bullet.title}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <HorizonChip horizon={bullet.horizon} size="sm" />
            {bullet.count && (
              <span className="meta text-[var(--ink-2)]">
                <span className="numeral">{bullet.count.total}</span> {bullet.count.unit}
              </span>
            )}
            {tension.level === 'calm' && bullet.deadline ? (
              <span className="meta text-[var(--ink-3)]">Target {shortDate(bullet.deadline)}</span>
            ) : (
              <TensionBadge level={tension.level} daysLeft={tension.daysLeft} />
            )}
          </div>
        </div>
      </div>
    </Slab>
  );
}
