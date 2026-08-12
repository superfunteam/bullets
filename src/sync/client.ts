import { db } from '../data/db';
import { applyLocal, onChange } from '../data/mutations';
import { ack, pending } from '../data/outbox';
import { clearToken, ensureToken, getPerson } from './auth';
import { apiUrl } from './api';
import type { Op } from '../data/ops';

/**
 * Adaptive polling.
 *
 * Netlify Functions can't hold WebSockets and cap streaming responses at 60
 * seconds, so SSE would mean constant reconnect churn. For two users, polling
 * at the right cadence is simpler and indistinguishable from realtime.
 *
 * Your OWN edits never wait on any of this — they apply to local state
 * instantly. The pace only governs how fast you see the other person's changes.
 */
export type Pace = 'live' | 'idle';

const INTERVAL: Record<Pace, number> = {
  live: 1_500,
  // Two people watching each other work: "a few seconds" is the product
  // requirement, so this is not a background chore interval.
  idle: 4_000,
};

/** Matches MAX_OPS_PER_PULL in netlify/functions/sync.mts. */
const PAGE_SIZE = 2000;

export type SyncState = {
  /** 'syncing' only shows after a beat, so a healthy sync never flickers. */
  status: 'ok' | 'syncing' | 'offline' | 'error';
  lastOkAt: number | null;
  queued: number;
  error: string | null;
};

let pace: Pace = 'idle';
let context: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let nudge: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let present: string[] = [];
let started = false;

let state: SyncState = { status: 'ok', lastOkAt: null, queued: 0, error: null };

const listeners = new Set<(s: SyncState) => void>();

export const syncState = (): SyncState => state;

export function onSyncState(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => {
    listeners.delete(fn);
  };
}

async function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch, queued: await db.outbox.count() };
  listeners.forEach(fn => fn(state));
}

export const currentInterval = (): number => INTERVAL[pace];
export const presence = (): string[] => present;

/** Views call this on mount/unmount. A live huddle board sets 'live'. */
export function setPace(next: Pace, ctx: string | null = null): void {
  pace = next;
  context = ctx;
  if (next === 'live') void syncOnce().catch(() => {});
  schedule();
}

async function cursor(): Promise<number> {
  return ((await db.meta.get('cursor'))?.value as number | undefined) ?? 0;
}

export async function syncOnce(): Promise<void> {
  if (inFlight) return;

  // A device that signed in offline has an identity but no token. Retrying here
  // rather than giving up is what stops sync from silently never running.
  const token = await ensureToken();
  if (!token) {
    if (getPerson()) await setState({ status: 'offline', error: 'No token yet' });
    return;
  }

  inFlight = true;
  try {
    const outgoing = await pending();
    let sentOutbox = false;
    let pages = 0;

    for (;;) {
      const res = await fetch(apiUrl('/api/sync'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          since: await cursor(),
          ops: sentOutbox ? [] : outgoing,
          context,
        }),
      });

      // A rotated BULLETS_SECRET invalidates tokens. Re-mint once rather than
      // wedging forever.
      if (res.status === 401) {
        clearToken();
        await setState({ status: 'error', error: 'Signed out, retrying' });
        return;
      }
      if (!res.ok) throw new Error(`sync failed: ${res.status}`);

      const body = (await res.json()) as { seq: number; ops: Op[]; presence?: string[] };

      if (!sentOutbox) {
        sentOutbox = true;
        if (outgoing.length) await ack(outgoing.map(o => o.opId));
      }

      if (body.ops?.length) await applyLocal(body.ops);
      await db.meta.put({ key: 'cursor', value: body.seq });
      present = body.presence ?? [];

      if (!body.ops || body.ops.length < PAGE_SIZE) break;
      if (++pages > 50) break;
    }

    await setState({ status: 'ok', lastOkAt: Date.now(), error: null });
    void afterSync();
  } catch (err) {
    await setState({
      status: navigator.onLine === false ? 'offline' : 'error',
      error: err instanceof Error ? err.message : 'Sync failed',
    });
    throw err;
  } finally {
    inFlight = false;
  }
}

/**
 * Native side effects of a successful sync. Imported lazily so the web bundle
 * never pulls in the Capacitor plugins.
 */
async function afterSync(): Promise<void> {
  try {
    const [{ publishWidget }, { scheduleHuddleReminders }, { clean }] = await Promise.all([
      import('../native/widget'),
      import('../native/notify'),
      import('../data/ops'),
    ]);
    await publishWidget();
    const huddles = (await db.huddles.toArray())
      .filter(h => !h.deletedAt)
      .map(h => clean<never>(h));
    await scheduleHuddleReminders(huddles as never);
  } catch {
    /* web build, or the user declined notifications */
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await syncOnce();
    } catch {
      /* offline is a normal state; the outbox holds */
    }
    schedule();
  }, currentInterval());
}

/**
 * Push straight after a local write.
 *
 * Waiting up to a full poll interval to send something the user just typed is
 * the difference between "instant" and "eventually". Debounced so a burst of
 * edits is one request.
 */
function pushSoon() {
  if (nudge) clearTimeout(nudge);
  nudge = setTimeout(() => {
    void syncOnce().catch(() => {});
  }, 250);
}

export function startSync(): void {
  if (started) return;
  started = true;

  void syncOnce().catch(() => {});
  schedule();
  onChange(pushSoon);

  const wake = () => void syncOnce().catch(() => {});
  addEventListener('focus', wake);
  addEventListener('online', wake);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake();
  });
}

export function stopSync(): void {
  if (timer) clearTimeout(timer);
  if (nudge) clearTimeout(nudge);
  timer = null;
  started = false;
}
