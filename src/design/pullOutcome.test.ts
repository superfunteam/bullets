import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEADLINE, localTruth, resolvePull, type Deps } from './pullOutcome';
import type { SyncState } from '../sync/client';

/**
 * These exist because the obvious implementation is a lie.
 *
 * `syncOnce()` returns Promise<void> and opens with `if (inFlight) return;`, so
 * awaiting it proves nothing: with a 1.5s poll, a pull very often lands
 * mid-flight and resolves in ~0ms having done nothing at all. Anyone who
 * "simplifies" this by awaiting the promise makes the indicator claim success
 * for work that never happened, and the first test below is what stops them.
 */

const state = (over: Partial<SyncState> = {}): SyncState => ({
  status: 'ok',
  lastOkAt: 1_000,
  queued: 0,
  error: null,
  ...over,
});

/** A controllable stand-in for the sync client. */
function harness(initial: SyncState, opts: { cursor?: number[] } = {}) {
  let current = initial;
  const listeners = new Set<(s: SyncState) => void>();
  const cursors = opts.cursor ?? [10, 10];
  let reads = 0;

  const deps: Deps = {
    syncState: () => current,
    // Mirrors the real client: fires synchronously on subscribe.
    onSyncState: fn => {
      listeners.add(fn);
      fn(current);
      return () => listeners.delete(fn);
    },
    syncOnce: vi.fn(async () => {}),
    readCursor: async () => cursors[Math.min(reads++, cursors.length - 1)],
  };

  return {
    deps,
    emit(next: Partial<SyncState>) {
      current = { ...current, ...next };
      listeners.forEach(fn => fn(current));
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('resolvePull', () => {
  it('does not claim success when sync did nothing at all', async () => {
    vi.useFakeTimers();
    // The inFlight guard: resolves instantly, emits nothing.
    const h = harness(state());
    const p = resolvePull(h.deps);
    await vi.advanceTimersByTimeAsync(DEADLINE + 10);
    const out = await p;

    expect(out.l1).toBe('Still syncing');
    expect(out.l2).toBe('No answer yet — still trying');
    // The thing that must never happen.
    expect(out.l1).not.toBe('Synced');
  });

  it('ignores the synchronous replay of the state it started in', async () => {
    // Pull while already erroring: the replay must not resolve it instantly.
    const h = harness(state({ status: 'error', error: 'Network down', lastOkAt: 1_000 }));
    const p = resolvePull(h.deps);
    h.emit({ status: 'ok', lastOkAt: 2_000 });
    const out = await p;
    expect(out.l1).toBe('Synced');
  });

  it('does not throw when the subscriber fires synchronously', async () => {
    // Direct guard on a ReferenceError that would hit the common path.
    const h = harness(state());
    const p = resolvePull(h.deps);
    h.emit({ lastOkAt: 2_000 });
    await expect(p).resolves.toBeTruthy();
  });

  it('treats a 401 as signing back in, not as a failure', async () => {
    const h = harness(state());
    const p = resolvePull(h.deps);
    h.emit({ status: 'error', error: 'Signed out, retrying' });
    const out = await p;

    expect(out.l1).toBe('Signing back in');
    expect(out.l2).toBe('This fixes itself in a moment');
    expect(out.l1).not.toBe('Not syncing');
  });

  it('reports a real failure plainly', async () => {
    const h = harness(state());
    const p = resolvePull(h.deps);
    h.emit({ status: 'error', error: 'sync failed: 500' });
    const out = await p;
    expect(out).toMatchObject({ l1: 'Not syncing', l2: "Couldn't reach the server" });
  });

  it('still attempts the sync when offline', async () => {
    const h = harness(state({ queued: 0 }));
    const p = resolvePull(h.deps);
    h.emit({ status: 'offline' });
    const out = await p;

    expect(h.deps.syncOnce).toHaveBeenCalled();
    expect(out).toMatchObject({
      l1: 'Offline',
      l2: 'Changes are saved here but not shared yet',
    });
  });

  it('does not call our own ops news', async () => {
    const h = harness(state({ queued: 3 }), { cursor: [10, 11] });
    const p = resolvePull(h.deps);
    h.emit({ lastOkAt: 2_000, queued: 0 });
    const out = await p;

    expect(out).toMatchObject({ l1: 'Synced', l2: 'Sent 3 changes' });
    expect(out.l2).not.toBe('New changes are in');
  });

  it('calls a peer op news', async () => {
    const h = harness(state({ queued: 0 }), { cursor: [10, 11] });
    const p = resolvePull(h.deps);
    h.emit({ lastOkAt: 2_000, queued: 0 });
    expect(await p).toMatchObject({ l1: 'Synced', l2: 'New changes are in' });
  });

  it('says up to date when nothing moved, which is the common case', async () => {
    const h = harness(state({ queued: 0 }), { cursor: [10, 10] });
    const p = resolvePull(h.deps);
    h.emit({ lastOkAt: 2_000, queued: 0 });
    expect(await p).toMatchObject({ l1: 'Synced', l2: 'Up to date' });
  });

  it('does not read as done when the round trip left our ops behind', async () => {
    const h = harness(state({ queued: 5 }));
    const p = resolvePull(h.deps);
    h.emit({ lastOkAt: 2_000, queued: 2 });
    const out = await p;

    expect(out).toMatchObject({ l1: 'Syncing', l2: '2 changes still waiting' });
    expect(out.l1).not.toBe('Synced');
  });

  it('gets the singulars right', async () => {
    const h = harness(state({ queued: 1 }));
    const p = resolvePull(h.deps);
    h.emit({ lastOkAt: 2_000, queued: 0 });
    expect((await p).l2).toBe('Sent 1 change');
  });
});

describe('localTruth', () => {
  const now = 1_000_000_000;
  const ago = (ms: number) => state({ lastOkAt: now - ms });

  it('reads the local answer without touching the network', () => {
    expect(localTruth(state({ lastOkAt: null }), now)).toBe('Never synced on this device');
    expect(localTruth(ago(5_000), now)).toBe('Last synced just now');
    expect(localTruth(ago(45_000), now)).toBe('Last synced under a minute ago');
    expect(localTruth(ago(90_000), now)).toBe('Last synced 1 minute ago');
    expect(localTruth(ago(14 * 60_000), now)).toBe('Last synced 14 minutes ago');
    expect(localTruth(ago(2 * 3_600_000), now)).toBe('Last synced 2 hours ago');
    expect(localTruth(ago(30 * 3_600_000), now)).toBe('Last synced yesterday');
    expect(localTruth(ago(4 * 86_400_000), now)).toBe('Last synced 4 days ago');
  });

  it('leads with unsent work, because that is the more useful truth', () => {
    expect(localTruth(state({ queued: 3, lastOkAt: now }), now)).toBe(
      '3 changes waiting on this device',
    );
    expect(localTruth(state({ queued: 1, lastOkAt: now }), now)).toBe(
      '1 change waiting on this device',
    );
  });
});
