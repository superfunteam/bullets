import { motion } from 'motion/react';
import { useMemo } from 'react';
import { Slab } from '../design/Slab';
import { BigButton, Empty, HorizonChip, SelectionMark, TensionBadge } from '../design/bits';
import { settle, stagger } from '../design/springs';
import { Icon } from '../design/icons';
import { byUrgency, tensionOf } from '../data/selectors';
import { useAllShots, useClients, useShelf } from '../data/store';
import { shortDate, today as todayFn } from '../lib/dates';
import type { Bullet, Shot } from '../data/types';
import { CompletedSection } from './CompletedSection';
import { useSelection } from './selection';

/**
 * Everything we have not decided on yet, filed by client and shut by default.
 *
 * The shelf is the one place in Bullets that is allowed to be long, which is
 * exactly why it opens closed: a wall of undecided work is the thing that makes
 * people stop opening an app. You come here to run the Weekly Pull, or to open
 * one client and look it in the eye. Both of those start with a shut drawer.
 */

const NO_CLIENT = '~none';

/** One identity for "no shots", so the grouping memo isn't churned by a literal. */
const NO_SHOTS: Shot[] = [];

type Tension = ReturnType<typeof tensionOf>;
type Row = { bullet: Bullet; tension: Tension };
type Group = { key: string; name: string; hue?: number; rows: Row[] };


export function ShelfView({
  onOpenHistory,
  onZoom,
  onStartWeeklyPull,
}: {
  onOpenHistory?: () => void;
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
    <div className="mx-auto w-full max-w-2xl px-4 pb-[calc(10rem+var(--bulk-sheet-h,0px))]">
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

          <div className="space-y-8">
            {groups.map((group, i) => (
              <ClientGroup key={group.key} group={group} index={i} onZoom={onZoom} />
            ))}
          </div>
        </>
      )}
      <CompletedSection onZoom={onZoom} />
    
      {onOpenHistory && (
        <button
          type="button"
          onClick={onOpenHistory}
          className="meta mt-10 flex min-h-[var(--tap)] w-full items-center justify-center gap-1
                     text-[var(--ink-3)] uppercase"
        >
          History
          <Icon name="chevron_right" size={16} />
        </button>
      )}
</div>
  );
}

/**
 * A client, as a heading over its bullets.
 *
 * This used to be a collapsible drawer: a full Slab button with a chevron, and
 * the rows hidden behind it and indented. That meant the Shelf — the screen
 * whose entire job is showing you what you have not decided on — opened
 * showing you nothing but client names, and every bullet cost a tap to reach.
 *
 * The client is a label for the rows beneath it, so it is typeset as one:
 * quiet, small, and out of the way. The rows sit at full width, at the same
 * text origin as every other list in the app.
 */
function ClientGroup({
  group,
  index,
  onZoom,
}: {
  group: Group;
  index: number;
  onZoom: (id: string) => void;
}) {
  return (
    <motion.section
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...settle, delay: stagger(index), layout: settle }}
    >
      <div className="mb-2.5 flex items-center gap-2.5 px-1">
        {group.hue !== undefined ? (
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: `oklch(60% 0.16 ${group.hue})` }}
          />
        ) : (
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full border border-[var(--line-strong)]"
          />
        )}
        <h2 className="meta min-w-0 flex-1 truncate uppercase text-[var(--ink-3)]">
          {group.name}
        </h2>
        <span className="meta numeral shrink-0 text-[var(--ink-3)]">{group.rows.length}</span>
      </div>

      {/* No indent. The rows share the leading edge with Today and Week, so the
          selection marks line up down the whole app. */}
      <div className="space-y-2.5">
        {group.rows.map(row => (
          <ShelfRow key={row.bullet.id} row={row} onZoom={onZoom} />
        ))}
      </div>
    </motion.section>
  );
}

function ShelfRow({
  row,
  onZoom,
}: {
  row: Row;
  onZoom: (id: string) => void;
}) {
  const sel = useSelection();
  const { bullet, tension } = row;

  return (
    <Slab onClick={() => onZoom(bullet.id)}>
      <div className="grid min-h-[var(--tap)] grid-cols-[auto_1fr] gap-x-3.5 px-5 py-4">
        <SelectionMark
          kind={bullet.kind}
          selected={sel.has(bullet.id)}
          title={bullet.title}
          onToggle={() => sel.toggle('shelf', bullet.id)}
        />
        <div className="min-w-0">
          {/* No client pill here: repeating one client name down its own drawer
              is noise. The drawer header carries it instead. */}
          <p className="display text-xl leading-[1.2] text-balance text-[var(--ink)]">
            {bullet.title}
          </p>
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
