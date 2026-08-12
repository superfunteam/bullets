import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Slab } from '../design/Slab';
import { Stepper } from '../design/Stepper';
import { BigButton, ClientDot, HorizonChip, KindGlyph, TensionBadge } from '../design/bits';
import { fling, prefersReducedMotion, settle, snap } from '../design/springs';
import { pullToDay, pullToWeek, setHorizon, shelve } from '../data/mutations';
import { byUrgency, tensionOf, unclaimedOf, type Tension } from '../data/selectors';
import { useBullets, useClients, useShelf, useShotsFor, useShotsOn, useWeekShots } from '../data/store';
import { HORIZON_META, type Bullet, type Client, type Horizon, type Shot } from '../data/types';
import { daysUntil, relativeDay, today as todayFn } from '../lib/dates';

/**
 * The Pull.
 *
 * Migration is the only part of bullet journalling that actually does the work:
 * periodically re-deciding what deserves attention, item by item, out loud. So
 * it gets the whole screen and exactly one thing at a time. A list would let you
 * skim it, and skimming is how a shelf turns into a graveyard.
 *
 * Right pulls it in, left pushes the horizon out, up shelves it. Thresholds are
 * distance *or* velocity, because a confident flick is a decision too.
 */

const THRESHOLD = 130;
const VELOCITY = 650;

/** How far ahead a target has to be before the Weekly Pull stops caring. */
const NEAR_TARGET_DAYS = 21;

/** One step further out. Shelf is the end of the line. */
const PUSHED_OUT: Record<Horizon, Horizon> = {
  now: 'next',
  next: 'soon',
  soon: 'later',
  later: 'shelf',
  shelf: 'shelf',
};

type Dir = 'right' | 'left' | 'up';

type DeckItem = { bullet: Bullet; client?: Client; tension: Tension };

type Flight = { item: DeckItem; dir: Dir; from: { x: number; y: number } };

/** A slice you'd actually finish rather than the whole heap. */
const defaultClaim = (unclaimed: number, weekly: boolean): number =>
  Math.max(1, Math.min(unclaimed, Math.ceil(unclaimed / (weekly ? 2 : 5))));

export function PullDeck({ mode, onDone }: { mode: 'weekly' | 'daily'; onDone: () => void }) {
  const today = todayFn();
  const weekly = mode === 'weekly';
  const reduced = useMemo(() => prefersReducedMotion(), []);

  const shelf = useShelf();
  const allBullets = useBullets();
  const clients = useClients();
  const weekRows = useWeekShots(today);
  const dayRows = useShotsOn(today);

  /** Decided in this session. Kept locally so a card leaves the instant you act,
   *  rather than whenever the write round-trips through Dexie. */
  const [decided, setDecided] = useState<string[]>([]);
  const [pulled, setPulled] = useState<{ id: string; title: string; amount?: number }[]>([]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [claim, setClaim] = useState<{ item: DeckItem; amount: number } | null>(null);

  // Live queries start empty, so hold the first beat rather than flashing the
  // summary at someone who does in fact have a full shelf.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWarm(true), 260);
    return () => clearTimeout(t);
  }, []);

  const shotsByBullet = useMemo(() => {
    const map = new Map<string, Shot[]>();
    for (const row of [...weekRows, ...dayRows]) {
      const list = map.get(row.bullet.id);
      if (list) list.push(row.shot);
      else map.set(row.bullet.id, [row.shot]);
    }
    return map;
  }, [weekRows, dayRows]);

  const clientById = useMemo(() => {
    const map = new Map<string, Client>();
    for (const c of clients) map.set(c.id, c);
    return map;
  }, [clients]);

  const candidates = useMemo<DeckItem[]>(() => {
    const pool = new Map<string, Bullet>();

    if (weekly) {
      for (const b of shelf) pool.set(b.id, b);
      for (const b of allBullets) {
        if (b.state !== 'open') continue;
        const near = b.deadline !== undefined && daysUntil(today, b.deadline) <= NEAR_TARGET_DAYS;
        if (b.horizon === 'soon' || near) pool.set(b.id, b);
      }
      // Anything already committed this week has been decided once already.
      for (const id of [...pool.keys()]) {
        if ((shotsByBullet.get(id) ?? []).some(s => s.state === 'open')) pool.delete(id);
      }
    } else {
      const alreadyToday = new Set(dayRows.map(r => r.bullet.id));
      for (const row of weekRows) {
        if (row.shot.state !== 'open' || row.bullet.state !== 'open') continue;
        if (alreadyToday.has(row.bullet.id)) continue;
        pool.set(row.bullet.id, row.bullet);
      }
    }

    return [...pool.values()]
      .map(bullet => ({
        bullet,
        tension: tensionOf(bullet, shotsByBullet.get(bullet.id) ?? [], today),
      }))
      .sort(byUrgency)
      .map(({ bullet, tension }) => ({
        bullet,
        tension,
        client: bullet.clientId ? clientById.get(bullet.clientId) : undefined,
      }));
  }, [weekly, shelf, allBullets, weekRows, dayRows, shotsByBullet, clientById, today]);

  const decidedSet = useMemo(() => new Set(decided), [decided]);
  const deck = useMemo(
    () => candidates.filter(item => !decidedSet.has(item.bullet.id)),
    [candidates, decidedSet],
  );

  const top = deck.length > 0 ? deck[0] : undefined;
  const topShots = useShotsFor(top?.bullet.id);
  const topUnclaimed = top?.bullet.count ? unclaimedOf(top.bullet, topShots) : 0;

  const pullIn = (id: string, amount?: number) =>
    weekly ? pullToWeek(id, today, amount) : pullToDay(id, today, amount);

  const commit = (dir: Dir, from: { x: number; y: number } = { x: 0, y: 0 }) => {
    if (!top || claim) return;
    const { bullet } = top;

    if (dir === 'right') {
      // A counted bullet is never committed whole by accident — you say how much.
      if (bullet.count && topUnclaimed > 1) {
        setClaim({ item: top, amount: defaultClaim(topUnclaimed, weekly) });
        return;
      }
      const amount = bullet.count ? Math.max(1, topUnclaimed) : undefined;
      void pullIn(bullet.id, amount);
      setPulled(p => [...p, { id: bullet.id, title: bullet.title, amount }]);
    } else if (dir === 'left') {
      // Daily left is "not today" — a skip, not a demotion.
      if (weekly && PUSHED_OUT[bullet.horizon] !== bullet.horizon) {
        void setHorizon(bullet.id, PUSHED_OUT[bullet.horizon]);
      }
    } else {
      void shelve(bullet.id);
    }

    setFlight({ item: top, dir, from });
    setDecided(d => [...d, bullet.id]);
  };

  const confirmClaim = () => {
    if (!claim) return;
    const { bullet } = claim.item;
    void pullIn(bullet.id, claim.amount);
    setPulled(p => [...p, { id: bullet.id, title: bullet.title, amount: claim.amount }]);
    setFlight({ item: claim.item, dir: 'right', from: { x: 0, y: 0 } });
    setDecided(d => [...d, bullet.id]);
    setClaim(null);
  };

  const atRisk = useMemo(() => {
    const pulledIds = new Set(pulled.map(p => p.id));
    return allBullets
      .filter(b => b.state === 'open' && b.deadline && !pulledIds.has(b.id))
      .map(b => ({ bullet: b, tension: tensionOf(b, shotsByBullet.get(b.id) ?? [], today) }))
      .filter(t => t.tension.level !== 'calm')
      .sort(byUrgency);
  }, [allBullets, pulled, shotsByBullet, today]);

  const loading = !warm && deck.length === 0 && decided.length === 0;
  const showSummary = !loading && deck.length === 0 && flight === null;
  const total = decided.length + deck.length;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--bg)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      style={{
        paddingTop: 'calc(var(--inset-top) + 1rem)',
        paddingBottom: 'calc(var(--inset-bottom) + 1rem)',
      }}
    >
      <header className="mx-auto flex w-full max-w-md items-start justify-between gap-4 px-5">
        <div className="min-w-0">
          <p className="meta text-[var(--ink-3)] uppercase">
            {weekly ? 'Weekly Pull' : 'Daily Pull'}
          </p>
          <h1 className="display mt-1 text-[1.9rem] text-[var(--ink)]">
            {weekly ? 'What gets the week?' : 'What gets today?'}
          </h1>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="meta -mr-2 min-h-[var(--tap)] shrink-0 px-2 text-[var(--ink-3)] uppercase"
          style={{ fontVariationSettings: "'wght' 700" }}
        >
          Later
        </button>
      </header>

      {!showSummary && (
        <div className="mx-auto mt-5 w-full max-w-md px-5">
          <div className="flex items-baseline justify-between">
            <span className="meta text-[var(--ink-3)] uppercase">
              <span className="numeral">{decided.length}</span> decided
            </span>
            <span className="meta text-[var(--ink-3)] uppercase">
              <span className="numeral">{deck.length}</span> left
            </span>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <motion.div
              className="h-full w-full origin-left rounded-full bg-[var(--ink-3)]"
              initial={false}
              animate={{ scaleX: total > 0 ? decided.length / total : 0 }}
              transition={settle}
            />
          </div>
        </div>
      )}

      <div className="relative mx-auto w-full max-w-md min-h-0 flex-1 px-5 py-5">
        {deck.slice(0, 3).map((item, depth) => (
          <PullCard
            key={item.bullet.id}
            item={item}
            depth={depth}
            today={today}
            weekly={weekly}
            reduced={reduced}
            unclaimed={depth === 0 && item.bullet.count ? topUnclaimed : undefined}
            onCommit={commit}
          />
        ))}

        {flight && (
          <motion.div
            key={`flight-${flight.item.bullet.id}`}
            aria-hidden
            className="pointer-events-none absolute inset-5 z-40"
            initial={{
              x: flight.from.x,
              y: flight.from.y,
              rotate: tiltOf(flight.from.x),
              opacity: 1,
            }}
            animate={{
              x: flight.dir === 'right' ? 640 : flight.dir === 'left' ? -640 : flight.from.x,
              y: flight.dir === 'up' ? -820 : flight.from.y + 30,
              rotate: flight.dir === 'right' ? 15 : flight.dir === 'left' ? -15 : 0,
              opacity: 0,
            }}
            transition={reduced ? { duration: 0.12 } : fling}
            onAnimationComplete={() => setFlight(null)}
          >
            <CardFace item={flight.item} today={today} />
          </motion.div>
        )}

        {loading && (
          <div className="flex h-full items-center justify-center">
            <p className="editorial text-2xl text-[var(--ink-3)]">Gathering the pile…</p>
          </div>
        )}

        {showSummary && (
          <Summary weekly={weekly} pulled={pulled} atRisk={atRisk} onDone={onDone} />
        )}
      </div>

      {!showSummary && !loading && (
        <div className="mx-auto flex w-full max-w-md gap-2.5 px-5">
          <DeckButton
            label={weekly ? 'Push out' : 'Not today'}
            sub={
              weekly && top && PUSHED_OUT[top.bullet.horizon] !== top.bullet.horizon
                ? `to ${HORIZON_META[PUSHED_OUT[top.bullet.horizon]].label}`
                : undefined
            }
            disabled={!top}
            onClick={() => commit('left')}
          />
          <DeckButton label="Shelve" disabled={!top} onClick={() => commit('up')} />
          <DeckButton label="Pull in" tone="hit" grow disabled={!top} onClick={() => commit('right')} />
        </div>
      )}

      <AnimatePresence>
        {claim && (
          <motion.div
            className="absolute inset-0 z-50 flex flex-col justify-end bg-[var(--ink)]/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setClaim(null)}
          >
            <motion.div
              className="rounded-t-[var(--r-xl)] border-t border-[var(--line)]
                         bg-[var(--surface)] px-6 pt-7 shadow-[var(--shadow-3)]"
              style={{ paddingBottom: 'calc(var(--inset-bottom) + 1.5rem)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={settle}
              onClick={e => e.stopPropagation()}
            >
              <p className="meta text-[var(--ink-3)] uppercase">{claim.item.bullet.title}</p>
              <h2 className="display mt-1.5 text-3xl text-[var(--ink)]">
                How many {weekly ? 'this week' : 'today'}?
              </h2>

              <div className="py-9">
                <Stepper
                  value={claim.amount}
                  min={1}
                  max={Math.max(1, topUnclaimed)}
                  unit={claim.item.bullet.count?.unit}
                  onChange={n => setClaim(c => (c ? { ...c, amount: n } : c))}
                />
              </div>

              <p className="meta mb-6 text-center text-[var(--ink-3)]">
                <span className="numeral">{topUnclaimed}</span> of{' '}
                <span className="numeral">{claim.item.bullet.count?.total}</span>{' '}
                {claim.item.bullet.count?.unit} still unclaimed
              </p>

              <div className="flex gap-3">
                <BigButton tone="quiet" onClick={() => setClaim(null)}>
                  Back
                </BigButton>
                <BigButton onClick={confirmClaim}>Pull in</BigButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Rotation follows the drag rather than being animated, so the fly-off inherits it. */
const tiltOf = (x: number): number => Math.max(-11, Math.min(11, (x / 280) * 11));

// ------------------------------------------------------------------- card

function PullCard({
  item,
  depth,
  today,
  weekly,
  reduced,
  unclaimed,
  onCommit,
}: {
  item: DeckItem;
  depth: number;
  today: string;
  weekly: boolean;
  reduced: boolean;
  unclaimed?: number;
  onCommit: (dir: Dir, from: { x: number; y: number }) => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-280, 0, 280], [-11, 0, 11]);

  // Tints and stamps are pure opacity, so the whole gesture stays on the compositor.
  const pullTint = useTransform(x, [20, THRESHOLD], [0, 0.85]);
  const pushTint = useTransform(x, [-20, -THRESHOLD], [0, 0.85]);
  const shelveTint = useTransform(y, [-20, -THRESHOLD], [0, 0.85]);
  const pullStamp = useTransform(x, [45, THRESHOLD], [0, 1]);
  const pushStamp = useTransform(x, [-45, -THRESHOLD], [0, 1]);
  const shelveStamp = useTransform(y, [-45, -THRESHOLD], [0, 1]);

  const isTop = depth === 0;

  return (
    <motion.div
      className="absolute inset-5"
      style={{ zIndex: 30 - depth }}
      initial={
        reduced
          ? { opacity: 1 }
          : { scale: 1 - (depth + 1) * 0.05, y: (depth + 1) * 16, opacity: 0 }
      }
      animate={{ scale: 1 - depth * 0.05, y: depth * 16, opacity: 1 }}
      transition={reduced ? { duration: 0.01 } : settle}
    >
      <motion.div
        className="h-full w-full touch-none"
        style={{ x, y, rotate }}
        drag={isTop}
        dragDirectionLock
        dragMomentum={false}
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={{ left: 1, right: 1, top: 1, bottom: 0.18 }}
        dragTransition={{ bounceStiffness: 340, bounceDamping: 32 }}
        onDragEnd={(_, info) => {
          if (!isTop) return;
          const from = { x: x.get(), y: y.get() };
          if (info.offset.x > THRESHOLD || info.velocity.x > VELOCITY) onCommit('right', from);
          else if (info.offset.x < -THRESHOLD || info.velocity.x < -VELOCITY) {
            onCommit('left', from);
          } else if (info.offset.y < -THRESHOLD || info.velocity.y < -VELOCITY) {
            onCommit('up', from);
          }
        }}
      >
        <CardFace
          item={item}
          today={today}
          unclaimed={unclaimed}
          tone={isTop ? 'raised' : 'default'}
          tints={
            isTop
              ? { pull: pullTint, push: pushTint, shelve: shelveTint }
              : undefined
          }
          stamps={
            isTop
              ? {
                  pull: pullStamp,
                  push: pushStamp,
                  shelve: shelveStamp,
                  pushLabel: weekly ? 'Push out' : 'Not today',
                }
              : undefined
          }
        />
      </motion.div>
    </motion.div>
  );
}

/**
 * The card itself, split out so the fly-off copy is pixel-identical to the card
 * it replaces — a fly-off that re-renders differently reads as a glitch.
 */
function CardFace({
  item,
  today,
  unclaimed,
  tone = 'raised',
  tints,
  stamps,
}: {
  item: DeckItem;
  today: string;
  unclaimed?: number;
  tone?: 'default' | 'raised';
  tints?: { pull: MotionValue<number>; push: MotionValue<number>; shelve: MotionValue<number> };
  stamps?: {
    pull: MotionValue<number>;
    push: MotionValue<number>;
    shelve: MotionValue<number>;
    pushLabel: string;
  };
}) {
  const { bullet, client, tension } = item;
  const left = bullet.deadline !== undefined ? daysUntil(today, bullet.deadline) : undefined;

  return (
    <Slab hue={client?.hue} tone={tone} className="h-full">
      {tints && (
        <>
          <motion.span
            aria-hidden
            className="absolute inset-0"
            style={{ opacity: tints.pull, background: 'var(--hit-soft)' }}
          />
          <motion.span
            aria-hidden
            className="absolute inset-0"
            style={{ opacity: tints.push, background: 'var(--surface-3)' }}
          />
          <motion.span
            aria-hidden
            className="absolute inset-0"
            style={{ opacity: tints.shelve, background: 'var(--surface-2)' }}
          />
        </>
      )}

      <div className="relative flex h-full flex-col px-7 py-8 pl-9">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xl leading-none">
            <KindGlyph kind={bullet.kind} />
          </span>
          <HorizonChip horizon={bullet.horizon} size="sm" active />
          <TensionBadge level={tension.level} daysLeft={tension.daysLeft} />
        </div>

        <div className="flex flex-1 items-center py-7">
          <div className="w-full">
            <h2 className="display text-[2.25rem] text-[var(--ink)]">{bullet.title}</h2>
            {bullet.note && (
              <p className="mt-3.5 line-clamp-3 text-[var(--ink-2)]">{bullet.note}</p>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          {client && <ClientDot hue={client.hue} name={client.name} />}
          {bullet.deadline && left !== undefined && (
            <p className="meta text-[var(--ink-2)]">
              Target · {relativeDay(bullet.deadline, today)}
              {left !== 0 && (
                <>
                  {' · '}
                  <span className="numeral">{Math.abs(left)}</span>
                  {left < 0 ? 'd past' : 'd out'}
                </>
              )}
            </p>
          )}
          {bullet.count && (
            <p className="meta text-[var(--ink-2)]">
              <span className="numeral">{unclaimed ?? bullet.count.total}</span> of{' '}
              <span className="numeral">{bullet.count.total}</span> {bullet.count.unit} unclaimed
            </p>
          )}
        </div>
      </div>

      {stamps && (
        <>
          <Stamp label="Pull in" color="var(--hit)" tilt={-6} opacity={stamps.pull} className="top-6 left-6" />
          <Stamp
            label={stamps.pushLabel}
            color="var(--ink-3)"
            tilt={6}
            opacity={stamps.push}
            className="top-6 right-6"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-7 flex justify-center">
            <Stamp label="Shelve" color="var(--ink-2)" tilt={0} opacity={stamps.shelve} />
          </div>
        </>
      )}
    </Slab>
  );
}

/** The stencilled direction stamp. Machined, not cute. */
function Stamp({
  label,
  color,
  tilt,
  opacity,
  className = '',
}: {
  label: string;
  color: string;
  tilt: number;
  opacity: MotionValue<number>;
  className?: string;
}) {
  return (
    <motion.span
      aria-hidden
      className={`meta pointer-events-none rounded-[var(--r-sm)] border-[3px] px-3.5 py-2
                  uppercase ${className ? `absolute ${className}` : ''}`}
      style={{
        opacity,
        rotate: tilt,
        color,
        borderColor: color,
        fontVariationSettings: "'wght' 800",
        letterSpacing: '0.14em',
      }}
    >
      {label}
    </motion.span>
  );
}

// ---------------------------------------------------------------- controls

function DeckButton({
  label,
  sub,
  tone = 'quiet',
  grow,
  disabled,
  onClick,
}: {
  label: string;
  sub?: string;
  tone?: 'quiet' | 'hit';
  grow?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={snap}
      className={`min-h-[var(--tap)] rounded-[var(--r-md)] px-3 py-3.5
                  disabled:opacity-35 ${grow ? 'flex-[1.5]' : 'flex-1'}`}
      style={{
        background: tone === 'hit' ? 'var(--hit-soft)' : 'var(--surface-2)',
        color: tone === 'hit' ? 'var(--hit)' : 'var(--ink-2)',
        fontVariationSettings: "'wght' 700",
        letterSpacing: '-0.01em',
      }}
    >
      <span className="block">{label}</span>
      {sub && <span className="meta mt-0.5 block text-[var(--ink-3)] uppercase">{sub}</span>}
    </motion.button>
  );
}

// ----------------------------------------------------------------- summary

function Summary({
  weekly,
  pulled,
  atRisk,
  onDone,
}: {
  weekly: boolean;
  pulled: { id: string; title: string; amount?: number }[];
  atRisk: { bullet: Bullet; tension: Tension }[];
  onDone: () => void;
}) {
  const when = weekly ? 'this week' : 'today';

  return (
    <motion.div
      className="hide-scrollbar flex h-full flex-col overflow-y-auto"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={settle}
    >
      <p className="editorial text-[2.5rem] leading-tight text-[var(--ink)]">
        {pulled.length === 0
          ? 'Nothing pulled in.'
          : weekly
            ? 'The week has a shape now.'
            : 'Today has a shape now.'}
      </p>

      <p className="mt-4 text-[var(--ink-2)]">
        {pulled.length === 0 ? (
          <>An empty pull is still a decision. Just make sure it was one.</>
        ) : (
          <>
            <span className="numeral">{pulled.length}</span>{' '}
            {pulled.length === 1 ? 'bullet is' : 'bullets are'} aimed at {when}. Everything else
            stays where you left it — nothing was called off.
          </>
        )}
      </p>

      {pulled.length > 0 && (
        <ul className="mt-6 space-y-2">
          {pulled.map(p => (
            <li key={p.id} className="flex items-baseline gap-3">
              <span className="text-[var(--hit)]">✓</span>
              <span className="flex-1 text-[var(--ink)]" style={{ fontVariationSettings: "'wght' 600" }}>
                {p.title}
              </span>
              {p.amount !== undefined && (
                <span className="numeral shrink-0 text-[var(--ink-3)]">×{p.amount}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {atRisk.length > 0 && (
        <section className="mt-10">
          <p className="meta text-[var(--ink-3)] uppercase">Still unaimed</p>
          <p className="editorial mt-2 text-xl leading-snug text-[var(--ink-2)]">
            These targets are close and nothing is pointed at them.
          </p>
          <div className="mt-4 space-y-2.5">
            {atRisk.slice(0, 6).map(({ bullet, tension }) => (
              <Slab key={bullet.id} tone="quiet" className="px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <span
                    className="min-w-0 flex-1 truncate text-[var(--ink)]"
                    style={{ fontVariationSettings: "'wght' 600" }}
                  >
                    {bullet.title}
                  </span>
                  <span className="shrink-0">
                    <TensionBadge level={tension.level} daysLeft={tension.daysLeft} />
                  </span>
                </div>
              </Slab>
            ))}
            {atRisk.length > 6 && (
              <p className="meta pt-1 text-[var(--ink-3)]">
                and <span className="numeral">{atRisk.length - 6}</span> more
              </p>
            )}
          </div>
        </section>
      )}

      <div className="mt-auto pt-10">
        <BigButton onClick={onDone}>{weekly ? 'Lock the week' : 'Start the day'}</BigButton>
      </div>
    </motion.div>
  );
}
