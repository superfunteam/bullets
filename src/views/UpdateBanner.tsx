import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Slab } from '../design/Slab';
import { BigButton } from '../design/bits';
import { settle } from '../design/springs';
import { App as CapacitorApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { checkForUpdate, downloadUpdate, skipVersion, type UpdateInfo } from '../native/update';

/**
 * Offers a newer APK when one has been published. Deliberately a quiet slab at
 * the bottom of Today rather than a modal — an update is never more important
 * than what you opened the app to do.
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Check on mount AND on every resume.
   *
   * Android resumes the WebView rather than remounting React, so a mount-only
   * effect fires once per cold start and then never again — you could leave the
   * app open for a week and it would never notice a release. That, plus the old
   * six-hour throttle, is why a new build never announced itself.
   *
   * Only a positive result is written to state: a throttled check returns null,
   * and treating that as "no update" would tear down a banner already on screen.
   */
  useEffect(() => {
    let cancelled = false;
    const run = () =>
      void checkForUpdate().then(found => {
        if (!cancelled && found) setInfo(found);
      });

    run();

    const onVisible = () => {
      if (!document.hidden) run();
    };
    document.addEventListener('visibilitychange', onVisible);

    // The Capacitor event is the reliable one on Android; visibilitychange is
    // the fallback that also covers the web app and the Electron window.
    let handle: PluginListenerHandle | undefined;
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) run();
    })
      .then(h => {
        if (cancelled) void h.remove();
        else handle = h;
      })
      .catch(() => {
        /* plugin absent on web — visibilitychange already covers it */
      });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void handle?.remove();
    };
  }, []);

  if (!info) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={settle}
        className="mt-8"
      >
        <Slab tone="sunken">
          <div className="px-6 py-6">
            <p className="meta text-[var(--ink-3)] uppercase">New build</p>
            <p className="display mt-1.5 text-2xl text-[var(--ink)]">
              Bullets <span className="numeral">{info.version}</span> is out
            </p>
            <p className="meta mt-2 text-[var(--ink-2)]">
              You're on <span className="numeral">{info.current}</span>. Android will ask you
              to confirm the install.
            </p>

            <div className="mt-5 flex gap-2.5">
              <BigButton
                onClick={() => {
                  setBusy(true);
                  void downloadUpdate(info).finally(() => setBusy(false));
                }}
                disabled={busy}
              >
                {busy ? 'Opening…' : 'Get it'}
              </BigButton>
              <BigButton
                tone="quiet"
                onClick={() => {
                  skipVersion(info.version);
                  setInfo(null);
                }}
                className="max-w-[9rem]"
              >
                Not now
              </BigButton>
            </div>
          </div>
        </Slab>
      </motion.div>
    </AnimatePresence>
  );
}
