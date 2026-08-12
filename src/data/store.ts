import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { clean, type Materialized } from './ops';
import { weekStart } from '../lib/dates';
import type { Bullet, Client, Huddle, HuddleItem, Shot } from './types';

const alive = <T extends { deletedAt?: number }>(rows: T[]) => rows.filter(r => !r.deletedAt);

const cleanAll = <T extends { deletedAt?: number }>(rows: Materialized[]) =>
  alive(rows).map(r => clean<never>(r)) as unknown as T[];

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
      if (bullet.state === 'dropped') return null;
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
  return (
    useLiveQuery(
      async () => joinShots(await db.shots.where('[scope+date]').equals(['day', date]).toArray()),
      [date],
      [],
    ) ?? []
  );
}

/** What we committed to this week, from the Weekly Pull. */
export function useWeekShots(day: string): ShotRow[] {
  const start = weekStart(day);
  return (
    useLiveQuery(
      async () => joinShots(await db.shots.where('[scope+date]').equals(['week', start]).toArray()),
      [start],
      [],
    ) ?? []
  );
}

export function useDayShotsInRange(days: string[]): Record<string, ShotRow[]> {
  const key = days.join(',');
  return (
    useLiveQuery(
      async () => {
        const out: Record<string, ShotRow[]> = {};
        for (const d of days) {
          out[d] = await joinShots(
            await db.shots.where('[scope+date]').equals(['day', d]).toArray(),
          );
        }
        return out;
      },
      [key],
      {},
    ) ?? {}
  );
}

export function useClients(): Client[] {
  return useLiveQuery(async () => cleanAll<Client>(await db.clients.toArray()), [], []) ?? [];
}

export function useBullets(): Bullet[] {
  return useLiveQuery(async () => cleanAll<Bullet>(await db.bullets.toArray()), [], []) ?? [];
}

/** The undecided pile you shop from during the Weekly Pull. */
export function useShelf(): Bullet[] {
  return (
    useLiveQuery(async () => {
      const all = cleanAll<Bullet>(await db.bullets.toArray());
      return all.filter(
        b => b.state === 'open' && !b.parentId && (b.horizon === 'shelf' || b.horizon === 'later'),
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
