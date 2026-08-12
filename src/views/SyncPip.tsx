import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { onSyncState, syncOnce, type SyncState } from '../sync/client';
import { settle } from '../design/springs';

/**
 * Says out loud when sync is not working.
 *
 * The APK went a full day never syncing once and nothing anywhere indicated it:
 * every failure was caught and discarded, so the app looked perfectly healthy
 * while writes piled up locally. A tool you trust with your work has to be
 * honest about not having saved it.
 *
 * Silent when healthy — a permanent "synced" badge is noise nobody reads.
 */
export function SyncPip() {
  const [state, setState] = useState<SyncState | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => onSyncState(setState), []);

  // Only complain once it has actually been broken for a bit, so a single
  // dropped request on a lift ride doesn't shout.
  useEffect(() => {
    if (!state || state.status === 'ok') {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(t);
  }, [state]);

  const broken = Boolean(state && state.status !== 'ok' && slow);
  if (!broken || !state) return null;

  const offline = state.status === 'offline';

  return (
    <AnimatePresence>
      <motion.button
        type="button"
        onClick={() => void syncOnce().catch(() => {})}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={settle}
        className="mx-auto mb-4 flex w-full items-center gap-3 rounded-[var(--r-md)]
                   border px-5 py-3.5 text-left"
        style={{
          background: offline ? 'var(--surface-2)' : 'var(--incoming-soft)',
          borderColor: offline ? 'var(--line)' : 'var(--incoming)',
        }}
      >
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: offline ? 'var(--ink-3)' : 'var(--incoming)' }}
        />
        <span className="min-w-0 flex-1">
          <span
            className="meta block uppercase"
            style={{ color: offline ? 'var(--ink-2)' : 'var(--incoming)' }}
          >
            {offline ? 'Offline' : 'Not syncing'}
          </span>
          <span className="meta block text-[var(--ink-2)]">
            {state.queued > 0
              ? `${state.queued} change${state.queued === 1 ? '' : 's'} waiting on this device`
              : 'Changes are saved here but not shared yet'}
          </span>
        </span>
        <span className="meta shrink-0 text-[var(--ink-3)] uppercase">Retry</span>
      </motion.button>
    </AnimatePresence>
  );
}
