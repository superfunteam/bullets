import { liveQuery, type Observable } from 'dexie';
import { useLiveQuery, useObservable } from 'dexie-react-hooks';
import { db } from './db';
import { clean, stampOf, type FieldStamp, type Materialized } from './ops';
import { weekStart } from '../lib/dates';
import type { Bullet, Client, Huddle, HuddleItem, Shot } from './types';
import { normalizeHorizon } from './types';

const alive = <T extends { deletedAt?: number }>(rows: T[]) => rows.filter(r => !r.deletedAt);

const cleanAll = <T extends { deletedAt?: number }>(rows: Materialized[]) =>
  alive(rows).map(r => clean<never>(r)) as unknown as T[];


/**
 * Live queries that survive their own component.
 *
 * Every list view unmounts on a tab change, and `liveQuery` schedules its first
 * read with `setTimeout(doQuery, 0)` (dexie.mjs) — so a freshly mounted view
 * always renders the empty default first and the real rows a tick later. On
 * Today that meant the *empty state* painted on every single tab press:
 * "Nothing on today, and nothing in the week" for a frame, then a hard pop as
 * the content arrived un-animated. That pop is what read as jank; on the phone,
 * where an IndexedDB round-trip is far slower than on a laptop, it is several
 * frames long.
 *
 * `liveQuery` keeps `hasValue`/`currentValue` in its OUTER closure and hangs
 * `hasValue()`/`getValue()` off the observable, and the Observable is cold — so
 * holding the instance past unsubscribe is safe, and re-subscribing re-runs the
 * querier cleanly. `useObservable` probes those synchronously during render, so
 * the incoming tab paints populated on its first frame.
 *
 * The key MUST contain every dependency the querier closes over, or you serve
 * one day's rows for another. Bounded LRU, because date-keyed entries otherwise
 * accumulate forever across midnight.
 */
const OBSERVABLES = new Map<string, Observable<unknown>>();
const MAX_CACHED = 64;

function cachedQuery<T>(key: string, querier: () => Promise<T>): Observable<T> {
  const hit = OBSERVABLES.get(key);
  if (hit) {
    // Re-insert so the LRU eviction below drops genuinely cold keys.
    OBSERVABLES.delete(key);
    OBSERVABLES.set(key, hit);
    return hit as Observable<T>;
  }
  const made = liveQuery(querier);
  OBSERVABLES.set(key, made as Observable<unknown>);
  if (OBSERVABLES.size > MAX_CACHED) {
    const oldest = OBSERVABLES.keys().next().value;
    if (oldest !== undefined) OBSERVABLES.delete(oldest);
  }
  return made;
}

/** Drop the cache. Tests only — a stale observable across tests is a lie. */
export function __resetQueryCache(): void {
  OBSERVABLES.clear();
}

function useCached<T>(key: string, querier: () => Promise<T>, fallback: T): T {
  // `key` is the whole dep set by construction — it must contain every value
  // the querier closes over, or you serve one day's rows for another.
  return useObservable(() => cachedQuery(key, querier), [key]) ?? fallback;
}

/** Frozen identities: a fresh [] as a fallback re-runs every downstream memo. */
const EMPTY_ROWS: ShotRow[] = [];
const EMPTY_CLIENTS: Client[] = [];
const EMPTY_BULLETS: Bullet[] = [];
const EMPTY_RANGE: Record<string, ShotRow[]> = {};

export type ShotRow = {
  shot: Shot;
  bullet: Bullet;
  client?: Client;
  /** Set when this row stands for a folded group; a stable render key. */
  groupId?: string;
};

/**
 * One card per (bullet, date, state) — for EVERY bullet, not just counted.
 *
 * The data layer deliberately holds PER-WRITER rows: each claim and each
 * recorded chunk of work stays on the row that wrote it, because field-level
 * LWW cannot merge rows without a concurrent writer silently erasing one
 * (that shipped, twice). And rows genuinely duplicate across devices with no
 * bug anywhere: rollForwardNow runs on EVERY device, each retiring the stale
 * shot and minting its own replacement — two phones rolling the same NOW
 * bullet forward inside the sync gap is two open rows, every morning. So the
 * row set is allowed to grow, and the CARD is the unit the user sees.
 *
 * Representative choice is load-bearing:
 * - open  → oldest by sortKey, a stable identity for layoutId and the zoom.
 * - done  → NEWEST by ts, so tapping the struck card un-hits the most recent
 *   work first — undoing a swipe restores exactly what the swipe recorded.
 */

/** Fold raw shots for display lists (the zoom's Lined up, the deck). */
export function groupShotsForDisplay(shots: Shot[], counted: boolean): Shot[] {
  const byKey = new Map<string, Shot[]>();
  for (const s of shots) {
    const key = `${s.scope}|${s.date}|${s.state}`;
    const list = byKey.get(key);
    if (list) list.push(s);
    else byKey.set(key, [s]);
  }
  return [...byKey.values()].map(list => {
    if (list.length === 1) return list[0];
    const rep = [...list].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))[0];
    if (!counted) return rep;
    const sum = list.reduce((n, s) => n + (s.amount ?? 1), 0);
    return { ...rep, amount: sum };
  });
}

export function groupCountedDayRows(rows: ShotRow[]): ShotRow[] {
  const out: ShotRow[] = [];
  const groups = new Map<string, ShotRow[]>();

  for (const row of rows) {
    if (row.shot.scope !== 'day') {
      out.push(row);
      continue;
    }
    const key = `${row.bullet.id}|${row.shot.date}|${row.shot.state}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const done = list[0].shot.state === 'done';
    const rep = [...list].sort((a, b) =>
      done
        ? (b.shot.updatedAt ?? 0) - (a.shot.updatedAt ?? 0)
        : a.shot.sortKey < b.shot.sortKey
          ? -1
          : 1,
    )[0];
    const groupId = `${rep.bullet.id}|${rep.shot.date}|${rep.shot.state}`;
    if (list[0].bullet.count) {
      const sum = list.reduce((n, r) => n + (r.shot.amount ?? 1), 0);
      // A display clone — the stored rows keep their own amounts. The card is
      // keyed by the GROUP, so the representative changing when a peer row
      // syncs in updates a mounted component instead of remounting the card.
      out.push({ ...rep, groupId, shot: { ...rep.shot, amount: sum } });
    } else {
      // A simple bullet's duplicates carry no amounts; the card is just one.
      out.push({ ...rep, groupId });
    }
  }

  return out;
}


async function joinShots(rows: Materialized[]): Promise<ShotRow[]> {
  return groupCountedDayRows(await joinShotsRaw(rows));
}

async function joinShotsRaw(rows: Materialized[]): Promise<ShotRow[]> {
  const shots = cleanAll<Shot>(rows);
  const bullets = await db.bullets.bulkGet(shots.map(s => s.bulletId));
  const clientIds = [
    ...new Set(
      bullets.flatMap(b => (b ? [(clean<Bullet>(b)).clientId] : [])).filter(Boolean) as string[],
    ),
  ];
  const clients = await db.clients.bulkGet(clientIds);
  const clientById = new Map(
    clients.filter(Boolean).map(c => {
      const cc = clean<Client>(c!);
      return [cc.id, cc];
    }),
  );

  return shots
    .map((shot, i) => {
      const raw = bullets[i];
      if (!raw || raw.deletedAt) return null;
      const bullet = clean<Bullet>(raw);
      return {
        shot,
        bullet,
        client: bullet.clientId ? clientById.get(bullet.clientId) : undefined,
      };
    })
    .filter(Boolean) as ShotRow[];
}

/** Today's shots, with their bullet and client already joined. */
export function useShotsOn(date: string): ShotRow[] {
  return useCached(
    `day:${date}`,
    async () => joinShots(await db.shots.where('[scope+date]').equals(['day', date]).toArray()),
    EMPTY_ROWS,
  );
}

/** What we committed to this week, from the Weekly Pull. */
export function useWeekShots(day: string): ShotRow[] {
  const start = weekStart(day);
  return useCached(
    `week:${start}`,
    async () => joinShots(await db.shots.where('[scope+date]').equals(['week', start]).toArray()),
    EMPTY_ROWS,
  );
}

export function useDayShotsInRange(days: string[]): Record<string, ShotRow[]> {
  const key = days.join(',');
  return useCached(
    `days:${key}`,
    async () => {
      // Parallel. These seven have no dependency on each other, and the await
      // inside the old for-loop made each one its own transaction and its own
      // main-thread task hop.
      const pairs = await Promise.all(
        days.map(async d => [d, await joinShots(
          await db.shots.where('[scope+date]').equals(['day', d]).toArray(),
        )] as const),
      );
      return Object.fromEntries(pairs) as Record<string, ShotRow[]>;
    },
    EMPTY_RANGE,
  );
}

export function useClients(): Client[] {
  return useCached('clients', async () => cleanAll<Client>(await db.clients.toArray()), EMPTY_CLIENTS);
}

export function useBullets(): Bullet[] {
  return useCached('bullets', async () => cleanAll<Bullet>(await db.bullets.toArray()), EMPTY_BULLETS);
}

/** The undecided pile you shop from during the Weekly Pull. */
export function useShelf(): Bullet[] {
  return (
    useLiveQuery(async () => {
      const all = cleanAll<Bullet>(await db.bullets.toArray());
      return all.filter(
        // A complement, via the normalizer, not an allowlist. An allowlist here is
    // how a retired value gets no Shelf surface and no deck route at once —
    // invisible on the only tab that would have caught it.
    b => b.state === 'open' && !b.parentId && normalizeHorizon(b.horizon) === 'shelf',
      );
    }, [], []) ?? []
  );
}

export function useBullet(id?: string): Bullet | undefined {
  return useLiveQuery(async () => {
    if (!id) return undefined;
    const rec = await db.bullets.get(id);
    return rec ? clean<Bullet>(rec) : undefined;
  }, [id]);
}

export function useChildren(parentId?: string): Bullet[] {
  return (
    useLiveQuery(
      async () => {
        if (!parentId) return [];
        return cleanAll<Bullet>(await db.bullets.where('parentId').equals(parentId).toArray());
      },
      [parentId],
      [],
    ) ?? []
  );
}

export function useShotsFor(bulletId?: string): Shot[] {
  return (
    useLiveQuery(
      async () => {
        if (!bulletId) return [];
        return cleanAll<Shot>(await db.shots.where('bulletId').equals(bulletId).toArray());
      },
      [bulletId],
      [],
    ) ?? []
  );
}

/**
 * Every live shot, whatever its scope or date.
 *
 * Tension is a question about a bullet, not about a day: a bullet whose only
 * commitment is an open week shot has genuinely been aimed at, and a screen
 * that only loads today's shots cannot see that. Two people and a handful of
 * shots a week means the table is small enough that one scan beats keeping
 * several date-scoped queries in step.
 */
export function useAllShots(): Shot[] {
  return useLiveQuery(async () => cleanAll<Shot>(await db.shots.toArray()), [], []) ?? [];
}

export function useHuddles(): Huddle[] {
  return (
    useLiveQuery(async () => {
      const all = cleanAll<Huddle>(await db.huddles.toArray());
      return all.sort((a, b) => a.startsAt - b.startsAt);
    }, [], []) ?? []
  );
}

export function useHuddle(id?: string): Huddle | undefined {
  return useLiveQuery(async () => {
    if (!id) return undefined;
    const rec = await db.huddles.get(id);
    return rec ? clean<Huddle>(rec) : undefined;
  }, [id]);
}

export function useHuddleItems(huddleId?: string): HuddleItem[] {
  return (
    useLiveQuery(
      async () => {
        if (!huddleId) return [];
        const rows = cleanAll<HuddleItem>(
          await db.huddleItems.where('huddleId').equals(huddleId).toArray(),
        );
        return rows.sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
      },
      [huddleId],
      [],
    ) ?? []
  );
}

/** Huddles happening on a given day, for inline placement in Today and Week. */
export function useHuddlesOn(date: string): Huddle[] {
  const all = useHuddles();
  return all.filter(h => {
    if (h.status === 'cancelled') return false;
    const d = new Date(h.startsAt);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    return iso === date;
  });
}

// --------------------------------------------------------------- completed

export type CompletedRow = {
  bullet: Bullet;
  client?: Client;
  /** When it was finished and by whom, from the op that set state. */
  finished?: FieldStamp;
  /** Every day work actually landed on, newest first. The real log. */
  log: { date: string; amount?: number }[];
  /** Pieces, for a parent. */
  children: Bullet[];
};

/**
 * Finished work, newest first.
 *
 * Kept because "done" should not mean "gone". The days it was worked come from
 * its completed shots — a record of what actually happened rather than a
 * separate audit trail — and the attribution comes from the op that set
 * `state`, which the materialised record already carries.
 */
export function useCompleted(limit = 60): CompletedRow[] {
  return (
    useLiveQuery(async () => {
      const raw = (await db.bullets.toArray()).filter(
        b => !b.deletedAt && (b as unknown as Bullet).state === 'done',
      );

      const rows: CompletedRow[] = [];
      for (const rec of raw) {
        const bullet = clean<Bullet>(rec);
        // Pieces are shown inside their parent, not as separate entries.
        if (bullet.parentId) continue;

        /**
         * Day-scope records only, one chip per date. A flipped week ledger is
         * bookkeeping, not work — it rendered a phantom chip on the week's
         * Monday — and per-writer twins are one day's work, not two chips.
         */
        const byDate = new Map<string, { date: string; amount?: number }>();
        for (const s of alive(await db.shots.where('bulletId').equals(bullet.id).toArray())
          .map(x => clean<Shot>(x))
          .filter(x => x.state === 'done' && x.scope === 'day')) {
          const prior = byDate.get(s.date);
          if (!prior) byDate.set(s.date, { date: s.date, amount: s.amount });
          else if (s.amount !== undefined) {
            prior.amount = (prior.amount ?? 0) + s.amount;
          }
        }
        const shots = [...byDate.values()].sort((a, b) => (a.date > b.date ? -1 : 1));

        const kids = alive(await db.bullets.where('parentId').equals(bullet.id).toArray()).map(k =>
          clean<Bullet>(k),
        );

        const client = bullet.clientId
          ? ((await db.clients.get(bullet.clientId)) as Materialized | undefined)
          : undefined;

        rows.push({
          bullet,
          client: client && !client.deletedAt ? clean<Client>(client) : undefined,
          finished: stampOf(rec, 'state'),
          log: shots,
          children: kids,
        });
      }

      return rows
        .sort((a, b) => (b.finished?.at ?? b.bullet.updatedAt) - (a.finished?.at ?? a.bullet.updatedAt))
        .slice(0, limit);
    }, [limit], []) ?? []
  );
}
