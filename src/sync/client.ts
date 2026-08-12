import { db } from '../data/db';
import { applyLocal } from '../data/mutations';
import { ack, pending } from '../data/outbox';
import { getToken } from './auth';
import type { Op } from '../data/ops';

/**
 * Adaptive polling.
 *
 * Netlify Functions can't hold WebSockets and their streaming responses cap at
 * 60 seconds, so SSE would mean constant reconnect churn. For two users,
 * polling at the right cadence is simpler and indistinguishable from realtime.
 *
 * Crucially, your OWN edits never wait on any of this — they apply to local
 * state instantly. The pace only governs how fast you see the other person's
 * changes, and 1.5s on a shared board reads as live.
 */
export type Pace = 'live' | 'idle';

const INTERVAL: Record<Pace, number> = {
  live: 1_500,
  idle: 15_000,
};

let pace: Pace = 'idle';
let context: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let present: string[] = [];
let online = true;

type StatusListener = (s: { online: boolean; queued: number }) => void;
const statusListeners = new Set<StatusListener>();

export const onStatus = (fn: StatusListener): (() => void) => {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
};

async function emitStatus() {
  const queued = await db.outbox.count();
  statusListeners.forEach(fn => fn({ online, queued }));
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
  const token = getToken();
  if (!token || inFlight) return;
  inFlight = true;

  try {
    const outgoing = await pending();
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ since: await cursor(), ops: outgoing, context }),
    });
    if (!res.ok) throw new Error(`sync failed: ${res.status}`);

    const body = (await res.json()) as { seq: number; ops: Op[]; presence?: string[] };

    if (body.ops?.length) await applyLocal(body.ops);
    await db.meta.put({ key: 'cursor', value: body.seq });

    // Ack by explicit id so anything enqueued mid-flight survives.
    if (outgoing.length) await ack(outgoing.map(o => o.opId));

    present = body.presence ?? [];
    online = true;

    // Keep the home screen widget and the scheduled huddle reminders current.
    // Both are no-ops on web.
    void afterSync();
  } catch (err) {
    online = false;
    throw err;
  } finally {
    inFlight = false;
    void emitStatus();
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
    // Offline is a normal state, not an error. The outbox holds and drains later.
    try {
      await syncOnce();
    } catch {
      /* keep polling */
    }
    schedule();
  }, currentInterval());
}

export function startSync(): void {
  void syncOnce().catch(() => {});
  schedule();

  const wake = () => void syncOnce().catch(() => {});
  addEventListener('focus', wake);
  addEventListener('online', wake);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake();
  });
}

export function stopSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
