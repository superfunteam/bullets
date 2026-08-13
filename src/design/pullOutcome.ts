import type { SyncState } from '../sync/client';

/**
 * What a pull actually found, in words.
 *
 * THE RULE: never treat `syncOnce()`'s promise as a signal. Verified in
 * sync/client.ts — it opens with `if (inFlight) return;`, so a pull that lands
 * during one of the 1.5s polls resolves on the next microtask having done
 * nothing, indistinguishable from a completed round trip. It also returns
 * Promise<void>, resolving identically on success, on a 401, and on no token.
 *
 * `lastOkAt` advances in exactly one place — after a 200 with a parsed body —
 * and is the only available proof that anything reached the server. So we fire
 * and observe, and never await.
 *
 * This app polls every 1.5-4s and pushes within 250ms of a write, so a pull
 * almost never finds news. "Up to date" is the honest common answer, and the
 * design leans on that rather than dressing it up.
 */

export const MIN_HOLD = 500;
export const DEADLINE = 6000;

export type Tone = 'ok' | 'wait' | 'off' | 'err';
export type Outcome = { l1: string; l2: string; tone: Tone };

export type Deps = {
  syncState: () => SyncState;
  onSyncState: (fn: (s: SyncState) => void) => () => void;
  syncOnce: () => Promise<void>;
  /** The sync cursor, so we can tell "the peer sent us something" from "we sent". */
  readCursor: () => Promise<number>;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The line the user reads on the way DOWN, computed from local state alone.
 *
 * This is what makes the gesture worth performing: it is free, it is true, and
 * it answers the actual question ("are we current?") before the network is even
 * touched. Frozen at engage so it cannot tick under the finger.
 */
export function localTruth(state: SyncState, now: number): string {
  if (state.queued > 0) {
    return `${state.queued} ${plural(state.queued, 'change', 'changes')} waiting on this device`;
  }
  if (state.lastOkAt === null) return 'Never synced on this device';

  const ms = Math.max(0, now - state.lastOkAt);
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);

  if (ms < 20_000) return 'Last synced just now';
  if (ms < 60_000) return 'Last synced under a minute ago';
  if (ms < 3_600_000) return `Last synced ${mins} ${plural(mins, 'minute', 'minutes')} ago`;
  if (ms < 86_400_000) return `Last synced ${hours} ${plural(hours, 'hour', 'hours')} ago`;
  if (ms < 172_800_000) return 'Last synced yesterday';
  return `Last synced ${Math.floor(ms / 86_400_000)} days ago`;
}

type Raw =
  | { kind: 'ok'; queuedAfter: number }
  | { kind: 'offline'; queued: number }
  | { kind: 'reauth' }
  | { kind: 'error' }
  | { kind: 'timeout' };

function phrase(raw: Raw, queuedBefore: number, cursorMoved: boolean): Outcome {
  switch (raw.kind) {
    case 'ok': {
      // A round trip that left our own ops behind has not finished the job, and
      // must not read as done.
      if (raw.queuedAfter > 0) {
        return {
          l1: 'Syncing',
          l2: `${raw.queuedAfter} ${plural(raw.queuedAfter, 'change', 'changes')} still waiting`,
          tone: 'wait',
        };
      }
      // Our own ops going up is not news arriving.
      if (queuedBefore > 0) {
        return {
          l1: 'Synced',
          l2: `Sent ${queuedBefore} ${plural(queuedBefore, 'change', 'changes')}`,
          tone: 'ok',
        };
      }
      if (cursorMoved) return { l1: 'Synced', l2: 'New changes are in', tone: 'ok' };
      return { l1: 'Synced', l2: 'Up to date', tone: 'ok' };
    }
    case 'offline':
      return {
        l1: 'Offline',
        l2:
          raw.queued > 0
            ? `${raw.queued} ${plural(raw.queued, 'change', 'changes')} waiting on this device`
            : 'Changes are saved here but not shared yet',
        tone: 'off',
      };
    case 'reauth':
      return { l1: 'Signing back in', l2: 'This fixes itself in a moment', tone: 'wait' };
    case 'error':
      return { l1: 'Not syncing', l2: "Couldn't reach the server", tone: 'err' };
    case 'timeout':
      return { l1: 'Still syncing', l2: 'No answer yet — still trying', tone: 'wait' };
  }
}

export async function resolvePull(deps: Deps): Promise<Outcome> {
  const before = deps.syncState();

  /**
   * Subscribe SYNCHRONOUSLY, on the calling tick, before anything is awaited.
   *
   * Reading the cursor first looks harmless and is not: it is an IndexedDB
   * round trip, and a sync that completes during it emits into the void. The
   * pull then sits there until the 6s deadline and reports "Still syncing" for
   * a sync that already succeeded.
   */
  const raw = new Promise<Raw>(resolve => {
    let settled = false;
    let first = true;
    // Declared BEFORE the callback that closes over it. Writing
    // `const off = onSyncState(cb)` throws a ReferenceError on the common path,
    // because onSyncState invokes cb synchronously during subscribe.
    let off: (() => void) | null = null;

    const finish = (r: Raw) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off?.();
      resolve(r);
    };

    const timer = setTimeout(() => finish({ kind: 'timeout' }), DEADLINE);

    const cb = (s: SyncState) => {
      // Skip the synchronous replay of the CURRENT state, or a pull made while
      // already in an error state resolves instantly on stale news.
      if (first) {
        first = false;
        return;
      }
      if (s.lastOkAt !== before.lastOkAt) finish({ kind: 'ok', queuedAfter: s.queued });
      else if (s.status === 'offline') finish({ kind: 'offline', queued: s.queued });
      else if (s.status === 'error') {
        finish({ kind: s.error === 'Signed out, retrying' ? 'reauth' : 'error' });
      }
    };

    const unsub = deps.onSyncState(cb);
    if (settled) unsub();
    else off = unsub;
  });

  const cursorBefore = await deps.readCursor();

  // Fired after the listener is live, never trusted, never awaited.
  void deps.syncOnce().catch(() => {});

  const settledRaw = await raw;
  const cursorAfter = await deps.readCursor();
  return phrase(settledRaw, before.queued, cursorAfter !== cursorBefore);
}
