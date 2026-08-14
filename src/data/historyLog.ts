import { db, type HistoryRow } from './db';
import type { Op } from './ops';
import type { Bullet, Person, Shot } from './types';

/**
 * Write every op into the local audit trail.
 *
 * Called at the TAIL of applyLocal — the single function both write paths pass
 * through (mutate for local writes, the sync client for peer ops). Hooking
 * enqueue would catch only local; hooking the client only remote.
 *
 * At the tail, not the head: subject resolution reads post-fold rows, so a shot
 * created in this very batch already has its bulletId and a child already has
 * its parentId.
 *
 * Double-recording is solved by the PRIMARY KEY, not by bookkeeping. The server
 * re-delivers everything written in the last 30 seconds, so every op you push
 * comes back and every peer op arrives two or three times across consecutive
 * polls. All of it collapses into an identical put. Do not add a seen-guard.
 *
 * Losing writes are recorded too. applyOp discards a field write that loses
 * last-write-wins, but somebody really did tap it, and recording it is a pure
 * function of the op set so both devices reach the same table. History is the
 * only surface that can show an edit that was overwritten.
 */

const ANCESTOR_DEPTH = 12;

/** Bullet id → parent id, memoised per call. Keeps the walk off the hot path. */
type Parents = Map<string, string | undefined>;

async function parentOf(id: string, seen: Parents): Promise<string | undefined> {
  if (seen.has(id)) return seen.get(id);
  const row = (await db.bullets.get(id)) as unknown as Bullet | undefined;
  const parent = row?.parentId;
  seen.set(id, parent);
  return parent;
}

/** The bullet an op is really about. A shot is about its bullet, not itself. */
async function subjectOf(op: Op): Promise<string | undefined> {
  if (op.entity === 'bullet') return op.entityId;
  if (op.entity === 'shot') {
    const shot = (await db.shots.get(op.entityId)) as unknown as Shot | undefined;
    return shot?.bulletId;
  }
  return undefined;
}

async function ancestry(subjectId: string | undefined, seen: Parents): Promise<string[]> {
  if (!subjectId) return [];
  const chain = [subjectId];
  let cursor: string | undefined = subjectId;
  // Bounded: a cycle from a corrupted parentId must not spin forever.
  for (let i = 0; i < ANCESTOR_DEPTH; i++) {
    cursor = await parentOf(cursor, seen);
    if (!cursor || chain.includes(cursor)) break;
    chain.push(cursor);
  }
  return chain;
}

export async function recordOps(ops: Op[]): Promise<void> {
  if (!ops.length) return;
  const seen: Parents = new Map();

  const rows: HistoryRow[] = [];
  for (const op of ops) {
    const subjectId = await subjectOf(op);
    rows.push({
      opId: op.opId,
      actionId: op.opId.lastIndexOf(':') > 0 ? op.opId.slice(0, op.opId.lastIndexOf(':')) : '',
      ts: op.ts,
      actor: op.actor as Person,
      entity: op.entity,
      entityId: op.entityId,
      field: op.field,
      value: op.value,
      subjectId,
      about: await ancestry(subjectId, seen),
    });
  }

  await db.history.bulkPut(rows);
}

/** Everything, newest first. The view pages over this. */
export async function readHistory(limit = 400): Promise<HistoryRow[]> {
  return db.history.orderBy('ts').reverse().limit(limit).toArray();
}

/** Every row about one bullet, including its pieces. */
export async function readHistoryFor(bulletId: string): Promise<HistoryRow[]> {
  const rows = await db.history.where('about').equals(bulletId).toArray();
  return rows.sort((a, b) => b.ts - a.ts);
}

export const historyCount = (): Promise<number> => db.history.count();
