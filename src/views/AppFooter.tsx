import { useState } from 'react';
import { checkForUpdate, currentVersion, downloadUpdate } from '../native/update';

/**
 * Version, and a way to check for a new build on demand.
 *
 * Both exist because "which version am I actually running?" had no answer
 * inside the app — the only way to find out was Android's app settings, and the
 * APK reported a stale hardcoded number there anyway.
 *
 * The automatic check is throttled to every six hours; this ignores that.
 */
export function AppFooter() {
  const [state, setState] = useState<'idle' | 'checking' | 'current' | 'found'>('idle');
  const [found, setFound] = useState<{ version: string } | null>(null);

  const check = async () => {
    setState('checking');
    const update = await checkForUpdate(true);
    if (update) {
      setFound({ version: update.version });
      setState('found');
      await downloadUpdate(update);
    } else {
      setState('current');
      setTimeout(() => setState('idle'), 4000);
    }
  };

  return (
    <div className="mt-12 flex flex-col items-center gap-2 pb-4">
      <p className="meta text-[var(--ink-3)]">
        Bullets v<span className="numeral">{currentVersion()}</span>
      </p>
      <button
        type="button"
        onClick={() => void check()}
        disabled={state === 'checking'}
        className="meta min-h-11 px-3 text-[var(--ink-3)] uppercase disabled:opacity-50"
      >
        {state === 'checking'
          ? 'Checking…'
          : state === 'current'
            ? 'Up to date'
            : state === 'found'
              ? `Getting ${found?.version}…`
              : 'Check for updates'}
      </button>
    </div>
  );
}
