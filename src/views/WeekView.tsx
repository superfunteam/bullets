import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { ShotCard } from './ShotCard';
import { HuddleStrip } from './HuddleStrip';
import { Slab } from '../design/Slab';
import { ClientDot, KindGlyph, TensionBadge } from '../design/bits';
import { settle, snap, stagger } from '../design/springs';
import { useDayShotsInRange, useHuddles, useWeekShots, type ShotRow } from '../data/store';
import { tensionOf, unclaimedOf } from '../data/selectors';
import { shortDate, toDay, today as todayFn, weekDays, weekdayName } from '../lib/dates';
import type { Huddle, Shot } from '../data/types';

/**
 * Seven days, Monday first. On a phone this is one column you thumb through;
 * on a desk it can become a seven-wide board for bulk editing — but only if
 * you ask for it. A width breakpoint quietly rearranging the week under you is
 * how you lose your place, so the switch is a control you press, and it sticks.
 */

const LAYOUT_KEY = 'bullets.weekLayout';
type Layout = 'column' | 'grid';

/** A week commitment with work left, plus how much of it for a counted bullet. */
type PoolEntry = { row: ShotRow; outstanding?: number };

function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'column';
  } catch {
    // Storage can be unavailable (private mode, WebView policy). Column is fine.
    return 'column';
  }
}

export function WeekView({
  onZoom,
  onOpenHuddle,
  onStartWeeklyPull,
}: {
  onZoom: (id: string) => void;
  onOpenHuddle: (id: string) => void;
  onStartWeeklyPull: () => void;
}) {
  const today = todayFn();
  const days = useMemo(() => weekDays(today), [today]);
  const byDay = useDayShotsInRange(days);
  const weekRows = useWeekShots(today);
  const huddles = useHuddles();

  const [layout, setLayout] = useState<Layout>(readLayout);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // Not being able to remember the choice is not worth an error.
    }
  }, [layout]);

  const huddlesByDay = useMemo(() => {
    const map: Record<string, Huddle[]> = {};
    for (const h of huddles) {
      if (h.status === 'cancelled') continue;
      const day = toDay(new Date(h.startsAt));
      (map[day] ??= []).push(h);
    }
    return map;
  }, [huddles]);

  /**
   * Week commitments that still owe work nobody has pulled onto a day.
   *
   * "Has a day shot" is only the right test for an uncounted bullet, where one
   * day shot means the whole thing is handled. A counted one is drawn *out of*
   * its week claim a slice at a time: twenty posts committed with four pulled
   * onto Monday still owes sixteen. Dropping it the moment the first slice left
   * made the Week screen read as an empty week — and took the Weekly Pull
   * prompt with it — while the Daily Pull was still offering the bullet.
   */
  const pool = useMemo<PoolEntry[]>(() => {
    /** Everything already drawn onto a day of this week, done or not. */
    const drawn = new Map<string, number>();
    for (const day of days) {
      for (const row of byDay[day] ?? []) {
        drawn.set(row.bullet.id, (drawn.get(row.bullet.id) ?? 0) + (row.shot.amount ?? 1));
      }
    }

    // A bullet can hold more than one week shot. Group them so the claim is
    // summed once and the bullet shows up as a single line.
    const openWeekShots = new Map<string, Shot[]>();
    for (const r of weekRows) {
      if (r.shot.state !== 'open') continue;
      const list = openWeekShots.get(r.bullet.id);
      if (list) list.push(r.shot);
      else openWeekShots.set(r.bullet.id, [r.shot]);
    }

    const seen = new Set<string>();
    const out: PoolEntry[] = [];
    for (const row of weekRows) {
      const { bullet } = row;
      if (row.shot.state !== 'open' || seen.has(bullet.id)) continue;
      seen.add(bullet.id);

      if (!bullet.count) {
        if (!drawn.has(bullet.id)) out.push({ row });
        continue;
      }

      // What the week actually claimed, i.e. the total less whatever stayed
      // uncommitted at week scope — then less the slices already on a day.
      const shots = openWeekShots.get(bullet.id) ?? [];
      const claimed = bullet.count.total - unclaimedOf(bullet, shots, 'week');
      const outstanding = claimed - (drawn.get(bullet.id) ?? 0);
      if (outstanding > 0) out.push({ row, outstanding });
    }
    return out;
  }, [weekRows, byDay, days]);

  /**
   * ShotCard defaults its layoutId to the bullet's global id, and a counted
   * bullet can be pulled onto two days in the same week — five posts Monday,
   * five Thursday — or twice onto the same day. Two live cards claiming one
   * layoutId makes motion's projection pick a lead at random, so exactly one
   * card per bullet keeps the plain `bullet-<id>` that BulletZoom grows out of
   * and every later one gets an id of its own.
   */
  const sharedZoomShots = useMemo(() => {
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const day of days) {
      for (const row of byDay[day] ?? []) {
        if (seen.has(row.bullet.id)) continue;
        seen.add(row.bullet.id);
        ids.add(row.shot.id);
      }
    }
    return ids;
  }, [days, byDay]);

  const grid = layout === 'grid';
  const needsPull = pool.length > 0 && (byDay[today] ?? []).length === 0;

  return (
    <div
      className={`mx-auto w-full px-4 pb-40 ${grid ? 'max-w-2xl md:max-w-[104rem]' : 'max-w-2xl'}`}
    >
      <header className="flex items-end justify-between gap-4 px-2 pt-6 pb-5">
        <div>
          <p className="meta text-[var(--ink-3)] uppercase">
            {shortDate(days[0])} – {shortDate(days[6])}
          </p>
          <h1 className="display mt-1 text-5xl text-[var(--ink)]">Week</h1>
        </div>
        <LayoutToggle layout={layout} onLayout={setLayout} />
      </header>

      {pool.length > 0 && (
        <section className="mb-7">
          <h2 className="meta mb-3 px-2 text-[var(--ink-3)] uppercase">
            This week · <span className="numeral">{pool.length}</span>
          </h2>
          <div className="space-y-2.5">
            {pool.map((entry, i) => (
              <PoolRow
                key={entry.row.shot.id}
                row={entry.row}
                outstanding={entry.outstanding}
                today={today}
                index={i}
                onZoom={onZoom}
              />
            ))}
          </div>
        </section>
      )}

      {needsPull && (
        <motion.button
          type="button"
          onClick={onStartWeeklyPull}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={settle}
          className="mb-7 w-full"
        >
          <Slab tone="sunken" className="px-6 py-6 text-center" interactive>
            <p className="display text-2xl text-[var(--ink)]">Run the Weekly Pull</p>
            <p className="meta mt-2 text-[var(--ink-3)]">
              <span className="numeral">{pool.length}</span> waiting in the week · nothing on
              today yet
            </p>
          </Slab>
        </motion.button>
      )}

      <div className={`grid gap-4 ${grid ? 'md:grid-cols-7 md:items-start md:gap-3' : ''}`}>
        {days.map((day, i) => (
          <DayBlock
            key={day}
            day={day}
            today={today}
            index={i}
            rows={byDay[day] ?? []}
            huddles={huddlesByDay[day] ?? []}
            sharedZoomShots={sharedZoomShots}
            onZoom={onZoom}
            onOpenHuddle={onOpenHuddle}
          />
        ))}
      </div>
    </div>
  );
}

/** One day. Today gets walls; days already spent step back rather than shout. */
function DayBlock({
  day,
  today,
  index,
  rows,
  huddles,
  sharedZoomShots,
  onZoom,
  onOpenHuddle,
}: {
  day: string;
  today: string;
  index: number;
  rows: ShotRow[];
  huddles: Huddle[];
  /** The one shot per bullet that owns the shared `bullet-<id>`. See WeekView. */
  sharedZoomShots: Set<string>;
  onZoom: (id: string) => void;
  onOpenHuddle: (id: string) => void;
}) {
  const isToday = day === today;
  const past = day < today;
  // Open work first, hit work settled underneath it.
  const ordered = useMemo(
    () => [...rows.filter(r => r.shot.state === 'open'), ...rows.filter(r => r.shot.state === 'done')],
    [rows],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: past && !isToday ? 0.5 : 1, y: 0 }}
      transition={{ ...settle, delay: stagger(index) }}
      className={`min-w-0 rounded-[var(--r-xl)] border p-2 ${
        isToday
          ? 'border-[var(--line-strong)] bg-[var(--surface-2)]'
          : 'border-transparent bg-transparent'
      }`}
    >
      <header className="flex items-baseline justify-between gap-3 px-3 pt-2 pb-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="display text-xl text-[var(--ink)]">{weekdayName(day)}</h2>
          <span className="numeral truncate text-[var(--ink-3)]">{shortDate(day)}</span>
        </div>
        {isToday ? (
          <span
            className="meta shrink-0 rounded-full bg-[var(--ink)] px-2.5 py-1 text-[var(--bg)] uppercase"
            style={{ fontVariationSettings: "'wght' 750" }}
          >
            Today
          </span>
        ) : rows.length > 0 ? (
          <span className="numeral shrink-0 text-[var(--ink-3)]">{rows.length}</span>
        ) : null}
      </header>

      {huddles.length > 0 && (
        <div className="mb-2.5 space-y-2.5">
          {huddles.map(h => (
            <HuddleStrip key={h.id} huddle={h} onOpen={() => onOpenHuddle(h.id)} />
          ))}
        </div>
      )}

      {ordered.length === 0 ? (
        huddles.length === 0 && <p className="meta px-3 pb-3 text-[var(--ink-3)]">Clear</p>
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence mode="popLayout" initial={false}>
            {ordered.map((row, i) => (
              <ShotCard
                key={row.shot.id}
                row={row}
                today={today}
                onZoom={onZoom}
                index={i}
                zoomId={sharedZoomShots.has(row.shot.id) ? undefined : `shot-${row.shot.id}`}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.section>
  );
}

/** A week commitment with no day yet. Deliberately lighter than a ShotCard. */
function PoolRow({
  row,
  outstanding,
  today,
  index,
  onZoom,
}: {
  row: ShotRow;
  /** Counted bullets only — what the week still owes after the day pulls. */
  outstanding?: number;
  today: string;
  index: number;
  onZoom: (id: string) => void;
}) {
  const { bullet, client, shot } = row;
  const tension = tensionOf(bullet, [shot], today);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...settle, delay: stagger(index) }}
    >
      <Slab hue={client?.hue} tone="sunken" onClick={() => onZoom(bullet.id)}>
        <div className="flex min-h-[var(--tap)] items-center gap-3 px-5 py-4 pl-7">
          <span className="text-lg">
            <KindGlyph kind={bullet.kind} />
          </span>
          <p className="display min-w-0 flex-1 truncate text-lg text-[var(--ink)]">
            {bullet.title}
          </p>
          {outstanding !== undefined && bullet.count && (
            <span className="meta shrink-0 text-[var(--ink-2)]">
              <span className="numeral">{outstanding}</span> of{' '}
              <span className="numeral">{bullet.count.total}</span> {bullet.count.unit} left
            </span>
          )}
          {client && (
            <span className="hidden shrink-0 sm:inline-flex">
              <ClientDot hue={client.hue} name={client.name} />
            </span>
          )}
          <TensionBadge level={tension.level} daysLeft={tension.daysLeft} />
        </div>
      </Slab>
    </motion.div>
  );
}

/** Desk-only. Nothing about the phone layout is negotiable, so it never shows there. */
function LayoutToggle({
  layout,
  onLayout,
}: {
  layout: Layout;
  onLayout: (l: Layout) => void;
}) {
  const options: { id: Layout; label: string }[] = [
    { id: 'column', label: 'Column' },
    { id: 'grid', label: 'Grid' },
  ];

  return (
    <div
      role="group"
      aria-label="Week layout"
      className="hidden shrink-0 items-center gap-1 rounded-full bg-[var(--surface-2)] p-1 md:flex"
    >
      {options.map(o => {
        const active = o.id === layout;
        return (
          <motion.button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onLayout(o.id)}
            whileTap={{ scale: 0.94 }}
            transition={snap}
            className="relative flex min-h-11 items-center rounded-full px-4"
          >
            {active && (
              <motion.span
                layoutId="week-layout-pill"
                transition={snap}
                className="absolute inset-0 rounded-full bg-[var(--surface)] shadow-[var(--shadow-1)]"
              />
            )}
            <span
              className="meta relative uppercase"
              style={{ color: active ? 'var(--ink)' : 'var(--ink-3)' }}
            >
              {o.label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
