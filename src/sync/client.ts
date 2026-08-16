import { db } from '../data/db';
import { applyLocal, onChange, settleFromOps } from '../data/mutations';
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
export const PAGE_SIZE = 2000;

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
let releaseListeners: (() => void) | null = null;

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
  if (!started) return;
  if (next === 'live') void syncOnce().catch(() => {});
  schedule();
}

async function cursor(): Promise<number> {
  return ((await db.meta.get('cursor'))?.value as number | undefined) ?? 0;
}

/**
 * The newest seq THIS TAB has applied, as opposed to the shared cursor.
 *
 * Two web tabs share one IndexedDB and one meta.cursor. The front tab applies
 * a peer's completion and advances the cursor; a frozen background tab never
 * sees Dexie's invalidation, and on waking it asks for seq > sharedCursor,
 * gets nothing, and its module-scope cached observables keep serving the
 * pre-completion snapshot indefinitely — a completed task rendering as open,
 * unboundedly stale. Pulling from min(appliedThrough, cursor) makes a woken
 * tab re-fetch the span a sibling already applied; applyLocal is idempotent,
 * and running it HERE fires this tab's Dexie events and re-renders.
 */
let appliedThrough = 0;
let rerunAfterFlight = false;
/** The current pass, so a test can wait for one it did not start. */
let settled: Promise<void> | null = null;

/**
 * Tests only: return this module to its boot state and WAIT for it.
 *
 * Two things outlive a test here. appliedThrough is a floor that lives as long
 * as the tab — right in the app, poison in a suite, where each test inherited
 * the previous one's cursor. Worse, the post-flight rerun is a floating
 * promise: it is deliberately not awaited, so it ran on into the NEXT test,
 * held inFlight, and made that test's syncOnce return at the door having done
 * nothing. That is why different tests failed on different runs.
 *
 * Awaiting is the whole point — clearing the flags without draining the
 * in-flight pass would just move the race.
 */
export async function __resetSyncForTests(): Promise<void> {
  // First, so nothing can schedule another rerun behind us.
  stopSync();
  rerunAfterFlight = false;
  /**
   * A rerun can chain one more pass; drain until the module is genuinely idle.
   * Bounded, because an unsettled pass here is already broken and blocking
   * forever would turn one bad test into a whole file of timeouts — the exact
   * cascade this reset exists to prevent. stopSync() above means nothing new
   * can start, so in practice this resolves in microtasks.
   */
  for (let i = 0; settled && i < 50; i++) {
    await Promise.race([settled, new Promise(r => setTimeout(r, 20))]).catch(() => {});
  }
  appliedThrough = 0;
  settled = null;
  inFlight = false;
}

export function syncOnce(): Promise<void> {
  if (inFlight) {
    // A wake or a local write landed mid-request. Dropping it silently means
    // the change waits a full poll interval; run one extra pass instead.
    rerunAfterFlight = true;
    return Promise.resolve();
  }
  const run = pass();
  // Tracked separately from what we hand back: callers must keep seeing a
  // rejection, while the drain hook must never become an unhandled one.
  const tracked: Promise<void> = run.catch(() => {}).finally(() => {
    if (settled === tracked) settled = null;
  });
  settled = tracked;
  return run;
}

/** One pass: mint if needed, push the outbox, then page the pull to the end. */
async function pass(): Promise<void> {
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
      const sinceSent = Math.min(appliedThrough, await cursor());
      const res = await fetch(apiUrl('/api/sync'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          since: sinceSent,
          ops: sentOutbox ? [] : outgoing,
          context,
        }),
        // A dead socket must reject, not hang: inFlight never clears while a
        // request is pending, so a hung fetch silently wedges every future
        // wake, nudge and pull-to-refresh until the app restarts.
        signal: AbortSignal.timeout(15_000),
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

      if (body.ops?.length) {
        await applyLocal(body.ops);
        // Completion is derived, and the peer that wrote these could not see
        // our half of the work. Re-derive for anything they touched, or a
        // counted bullet finished across both phones stays open forever.
        await settleFromOps(body.ops);
      }
      /**
       * Monotonic, and floored by what this tab has now applied. The server's
       * watermark can return a seq BELOW rows it just delivered (young rows
       * re-deliver until their commit window passes); regressing the shared
       * cursor for that would make every device re-pull the whole span.
       */
      const persisted = await cursor();
      if (body.seq > persisted) await db.meta.put({ key: 'cursor', value: body.seq });
      appliedThrough = Math.max(appliedThrough, body.seq);
      present = body.presence ?? [];

      if (!body.ops || body.ops.length < PAGE_SIZE) break;
      // No forward progress means the watermark is holding the cursor over
      // young rows — stop paging rather than spinning on the same span.
      if (body.seq <= sinceSent) break;
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
    if (rerunAfterFlight && started) {
      rerunAfterFlight = false;
      void syncOnce().catch(() => {});
    }
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
  if (!started) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await syncOnce();
    } catch {
      /* offline is a normal state; the outbox holds */
    }
    // stopSync() can run while a request is in flight. Do not resurrect the
    // polling loop after it has explicitly been stopped.
    if (started) schedule();
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
  if (!started) return;
  if (nudge) clearTimeout(nudge);
  nudge = setTimeout(() => {
    void syncOnce().catch(() => {});
  }, 250);
}

export function startSync(): void {
  if (started) return;
  started = true;

  // Seed the per-tab floor from the persisted cursor: a FRESH tab's queries
  // read current IndexedDB, so it owes no re-pull. Left at zero, every app
  // start would re-fetch the entire log. The floor only lags the shared
  // cursor when a SIBLING tab advances it while this one is alive.
  void (async () => {
    appliedThrough = Math.max(appliedThrough, await cursor());
    await syncOnce().catch(() => {});
  })();
  schedule();
  const unsubscribeChanges = onChange(pushSoon);

  const wake = () => void syncOnce().catch(() => {});
  const wakeOnVisibility = () => {
    if (!document.hidden) wake();
  };
  addEventListener('focus', wake);
  addEventListener('online', wake);
  document.addEventListener('visibilitychange', wakeOnVisibility);
  releaseListeners = () => {
    unsubscribeChanges();
    removeEventListener('focus', wake);
    removeEventListener('online', wake);
    document.removeEventListener('visibilitychange', wakeOnVisibility);
  };
}

export function stopSync(): void {
  if (timer) clearTimeout(timer);
  if (nudge) clearTimeout(nudge);
  timer = null;
  nudge = null;
  releaseListeners?.();
  releaseListeners = null;
  started = false;
}
