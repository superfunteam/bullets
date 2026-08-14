import { db } from './db';
import { apiUrl } from '../sync/api';
import { ensureToken } from '../sync/auth';
import { recordOps } from './historyLog';
import type { Op } from './ops';

/**
 * Pull the server's op log into the local history table.
 *
 * The audit trail already exists and always has: compact.mts states outright
 * that the ops table is never truncated, and the sync wire has always carried
 * `actor`. The client simply threw it away. So history is RECOVERABLE, not
 * merely capturable from today — which matters, because a log that starts the
 * day you shipped it answers none of the questions you actually have.
 *
 * Two properties this must not violate:
 *
 * 1. It must never touch `meta.cursor`. That cursor drives entity sync; walking
 *    it here would make the app skip ops it has not materialised and the two
 *    devices would silently diverge. This keeps its OWN cursor.
 * 2. It must never enqueue. It reads; it does not write anything the server has
 *    not already seen.
 */

const MARK = 'history.backfilledThrough';
const PAGE_GUARD = 200;

type Wire = { seq: number; ops: Op[] };

const readMark = async (): Promise<number> =>
  Number((await db.meta.get(MARK))?.value ?? 0);

const writeMark = (seq: number) => db.meta.put({ key: MARK, value: seq });

/**
 * @returns how many ops were newly recorded, or null when it could not run.
 * Never throws: an offline device shows the history it already has.
 */
export async function backfillHistory(): Promise<number | null> {
  const token = await ensureToken();
  if (!token) return null;

  let since = await readMark();
  let added = 0;

  try {
    for (let page = 0; page < PAGE_GUARD; page++) {
      const res = await fetch(apiUrl('/api/sync'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        // No ops: this is a read. Sending any would push them a second time.
        body: JSON.stringify({ since, ops: [] }),
      });
      if (!res.ok) return added;

      const body = (await res.json()) as Wire;
      const ops = body.ops ?? [];
      if (!ops.length) {
        await writeMark(body.seq ?? since);
        return added;
      }

      // recordOps is keyed on opId, so re-recording is a no-op rather than a
      // duplicate — which is what makes this safe to run on every open.
      await recordOps(ops);
      added += ops.length;

      const next = body.seq ?? since;
      if (next <= since) {
        // No forward progress: stop rather than spin.
        await writeMark(next);
        return added;
      }
      since = next;
      await writeMark(since);
    }
  } catch {
    // Offline or rate limited. The local trail is still whatever it was.
    return added;
  }
  return added;
}
