import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { ShotCard } from './ShotCard';
import { HuddleStrip } from './HuddleStrip';
import { Empty, TensionBadge } from '../design/bits';
import { Slab } from '../design/Slab';
import { settle } from '../design/springs';
import { useBullets, useHuddlesOn, useShotsOn, useWeekShots } from '../data/store';
import { tensionOf } from '../data/selectors';
import { relativeDay, shortDate, today as todayFn, weekdayName } from '../lib/dates';
import type { Bullet } from '../data/types';

/**
 * The default screen. One column, giant cards, huddles inline at their time.
 * The Incoming banner appears only when it has something to say — a banner
 * that is always there stops being read within a week.
 */
export function TodayView({
  onZoom,
  onOpenHuddle,
  onStartDailyPull,
}: {
  onZoom: (id: string) => void;
  onOpenHuddle: (id: string) => void;
  onStartDailyPull: () => void;
}) {
  const today = todayFn();
  const rows = useShotsOn(today);
  const huddles = useHuddlesOn(today);
  const weekRows = useWeekShots(today);
  const allBullets = useBullets();

  const open = rows.filter(r => r.shot.state === 'open');
  const hit = rows.filter(r => r.shot.state === 'done');

  // Anything with a target closing in that we have not actually aimed at.
  const incoming = useMemo(() => {
    const shotsByBullet = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = shotsByBullet.get(r.bullet.id) ?? [];
      list.push(r);
      shotsByBullet.set(r.bullet.id, list);
    }
    return allBullets
      .filter(b => b.state === 'open' && b.deadline)
      .map(b => ({
        bullet: b,
        tension: tensionOf(b, (shotsByBullet.get(b.id) ?? []).map(r => r.shot), today),
      }))
      .filter(t => t.tension.level !== 'calm')
      .sort((a, b) => (a.bullet.deadline! < b.bullet.deadline! ? -1 : 1));
  }, [allBullets, rows, today]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-40">
      <header className="px-2 pt-6 pb-5">
        <p className="meta text-[var(--ink-3)] uppercase">
          {weekdayName(today)} · {shortDate(today)}
        </p>
        <h1 className="display mt-1 text-5xl text-[var(--ink)]">Today</h1>
      </header>

      {incoming.length > 0 && (
        <IncomingBanner items={incoming} onZoom={onZoom} />
      )}

      {huddles.length > 0 && (
        <div className="mb-4 space-y-3">
          {huddles.map(h => (
            <HuddleStrip key={h.id} huddle={h} onOpen={() => onOpenHuddle(h.id)} />
          ))}
        </div>
      )}

      {open.length === 0 && hit.length === 0 ? (
        <Empty
          line={
            weekRows.length > 0
              ? 'Nothing pulled in yet.'
              : 'Nothing on today, and nothing in the week.'
          }
          sub={
            weekRows.length > 0
              ? 'Run the Daily Pull to pick from this week.'
              : 'Start with the Weekly Pull from the Shelf.'
          }
        />
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {open.map((row, i) => (
              <ShotCard key={row.shot.id} row={row} today={today} onZoom={onZoom} index={i} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {hit.length > 0 && (
        <section className="mt-9">
          <h2 className="meta mb-3 px-2 text-[var(--ink-3)] uppercase">
            Hit · <span className="numeral">{hit.length}</span>
          </h2>
          <div className="space-y-3">
            <AnimatePresence mode="popLayout" initial={false}>
              {hit.map((row, i) => (
                <ShotCard key={row.shot.id} row={row} today={today} index={i} />
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      {weekRows.length > 0 && open.length === 0 && (
        <motion.button
          type="button"
          onClick={onStartDailyPull}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={settle}
          className="mt-8 w-full"
        >
          <Slab tone="sunken" className="px-6 py-7 text-center" interactive>
            <p className="display text-2xl text-[var(--ink)]">Run the Daily Pull</p>
            <p className="meta mt-2 text-[var(--ink-3)]">
              <span className="numeral">{weekRows.length}</span> waiting in this week
            </p>
          </Slab>
        </motion.button>
      )}
    </div>
  );
}

function IncomingBanner({
  items,
  onZoom,
}: {
  items: { bullet: Bullet; tension: ReturnType<typeof tensionOf> }[];
  onZoom: (id: string) => void;
}) {
  const anyWide = items.some(i => i.tension.level === 'wide');
  const anyIncoming = items.some(i => i.tension.level === 'incoming');
  const worst = anyWide ? 'wide' : 'incoming';
  // The heading has to describe what's actually in the list. Saying "targets
  // have passed" over a set that is mostly merely close is the kind of small
  // dishonesty that trains you to stop reading the banner.
  const heading = anyWide && anyIncoming
    ? 'Needs aiming'
    : anyWide
      ? 'Targets have passed'
      : 'Incoming';
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={settle}
      className="mb-4 overflow-hidden rounded-[var(--r-lg)] border"
      style={{
        background: worst === 'wide' ? 'var(--wide-soft)' : 'var(--incoming-soft)',
        borderColor: worst === 'wide' ? 'var(--wide)' : 'var(--incoming)',
      }}
    >
      <div className="px-5 py-4">
        <p
          className="meta uppercase"
          style={{ color: worst === 'wide' ? 'var(--wide)' : 'var(--incoming)' }}
        >
          {heading}
        </p>
        <div className="mt-3 space-y-2.5">
          {items.slice(0, 4).map(({ bullet, tension }) => (
            <button
              key={bullet.id}
              type="button"
              onClick={() => onZoom(bullet.id)}
              className="flex w-full items-center justify-between gap-4 text-left"
            >
              <span
                className="flex-1 truncate text-[var(--ink)]"
                style={{ fontVariationSettings: "'wght' 620" }}
              >
                {bullet.title}
              </span>
              <span className="shrink-0">
                <TensionBadge level={tension.level} daysLeft={tension.daysLeft} />
              </span>
            </button>
          ))}
          {items.length > 4 && (
            <p className="meta text-[var(--ink-2)]">
              and <span className="numeral">{items.length - 4}</span> more
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export { relativeDay };
