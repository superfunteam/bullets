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

export type ShotRow = { shot: Shot; bullet: Bullet; client?: Client };

async function joinShots(rows: Materialized[]): Promise<ShotRow[]> {
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

        const shots = alive(await db.shots.where('bulletId').equals(bullet.id).toArray())
          .map(s => clean<Shot>(s))
          .filter(s => s.state === 'done')
          .sort((a, b) => (a.date > b.date ? -1 : 1));

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
          log: shots.map(s => ({ date: s.date, amount: s.amount })),
          children: kids,
        });
      }

      return rows
        .sort((a, b) => (b.finished?.at ?? b.bullet.updatedAt) - (a.finished?.at ?? a.bullet.updatedAt))
        .slice(0, limit);
    }, [limit], []) ?? []
  );
}
