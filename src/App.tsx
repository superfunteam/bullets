import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TabBar, type Tab } from './design/TabBar';
import { Toast } from './design/bits';
import { RefreshGesture } from './design/RefreshGesture';
import { settle } from './design/springs';
import { CaptureSheet } from './views/CaptureSheet';
import { TodayView } from './views/TodayView';
import { WeekView } from './views/WeekView';
import { ShelfView } from './views/ShelfView';
import { HuddlesView } from './views/HuddlesView';
import { HuddleBoard } from './views/HuddleBoard';
import { RequestHuddleSheet } from './views/RequestHuddleSheet';
import { BulletZoom } from './views/BulletZoom';
import { PullDeck } from './views/PullDeck';
import { SignIn } from './views/SignIn';
import { Onboarding } from './views/Onboarding';
import { BulkSheet } from './views/BulkSheet';
import { HistoryView } from './views/HistoryView';
import { useSelection } from './views/selection';
import { restoreIdentity } from './sync/auth';
import { onSyncState, startSync } from './sync/client';
import { useHuddles } from './data/store';
import { getActor, healPoisonedClocks, initClock } from './data/mutations';
import { seedIfEmpty } from './data/seed';
import { rollForwardNow } from './data/mutations';
import { HORIZON_META, hasAnswered, type Person } from './data/types';

type Overlay =
  | { kind: 'none' }
  | { kind: 'zoom'; bulletId: string }
  | { kind: 'pull'; mode: 'weekly' | 'daily' }
  | { kind: 'huddle'; huddleId: string }
  | { kind: 'history' };

const ONBOARDED_KEY = 'bullets.onboarded';

export function App() {
  const [person, setPerson] = useState<Person | null>(() => restoreIdentity());
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem(ONBOARDED_KEY) === '1',
  );
  const [tab, setTab] = useState<Tab>('today');
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [capturing, setCapturing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // A carried handler, so a bulk action's UNDO can hang off the same toast the
  // rest of the app uses instead of growing a second notification surface.
  const [toastAction, setToastAction] = useState<{ label: string; run: () => void } | null>(null);

  const huddles = useHuddles();
  const me = getActor();

  // A huddle the other person called that I have not actually answered yet.
  // Keyed on hasAnswered rather than the response value: every huddle starts
  // auto-confirmed as 'in', so testing for 'in' meant tapping In left the
  // predicate true and the badge could never be cleared.
  const pendingHuddles = huddles.filter(
    h =>
      h.status === 'scheduled' &&
      h.startsAt > Date.now() &&
      h.calledBy !== me &&
      !hasAnswered(h, me),
  ).length;

  useEffect(() => {
    if (!person) return;
    void (async () => {
      // The clock seeds BEFORE anything writes: rollForwardNow mutates
      // immediately, and a write stamped below an observed peer timestamp
      // silently loses every comparison it enters.
      await initClock();
      await seedIfEmpty();
      // BEFORE rollForwardNow: a stuck bullet must be re-derived while its
      // shots are still all done, or roll-forward mints a fresh open one and
      // the task reappears open every morning.
      await healPoisonedClocks();
      // NOW means today, so opening the app is enough to slot it in — including
      // anything committed yesterday and never done.
      await rollForwardNow();
      startSync();

      /**
       * And again once the first sync has landed. On a fresh device — or any
       * launch where the pull brings work down after boot — the boot-time
       * roll-forward ran against an empty database and did nothing, leaving
       * yesterday's NOW cards stranded on yesterday until the next launch.
       * Found in the live data: open shots dated two days back.
       */
      const settleOnce = onSyncState(s => {
        if (s.status !== 'ok') return;
        settleOnce();
        // Peer rows arrive after boot, and a poisoned one among them needs the
        // same heal — again before the roll-forward that would mask it.
        void (async () => {
          await healPoisonedClocks();
          await rollForwardNow();
        })();
      });
    })();

    // Native-only. Both are no-ops on web.
    void (async () => {
      try {
        const notify = await import('./native/notify');
        // Exact alarms are a separate grant from notifications, and on Android
        // 14+ a fresh install does NOT have it. Without it every reminder is
        // batched by Doze and can land after the huddle has already started —
        // silently, since scheduling still resolves fine.
        await notify.ensureExactAlarms(true);
        notify.onNotificationTap(route => {
          if (route.startsWith('/huddle/')) {
            setOverlay({ kind: 'huddle', huddleId: route.split('/')[2] });
          }
        });
      } catch {
        /* web build */
      }
    })();
  }, [person]);

  // The exact-alarm grant can be revoked while we're backgrounded, which makes
  // Android drop the alarms it already accepted. Re-check on resume.
  // The day rolls over while the app sits open overnight.
  useEffect(() => {
    const onWake = () => {
      if (!document.hidden) void rollForwardNow();
    };
    document.addEventListener('visibilitychange', onWake);
    const t = setInterval(onWake, 10 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const onResume = () => {
      if (document.hidden) return;
      void import('./native/notify')
        .then(n => n.revalidateReminders())
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onResume);
    return () => document.removeEventListener('visibilitychange', onResume);
  }, []);

  // Deep links from the widget and from notification taps.
  useEffect(() => {
    const route = (path: string) => {
      if (path.startsWith('/capture')) setCapturing(true);
      else if (path.startsWith('/huddle/')) {
        setOverlay({ kind: 'huddle', huddleId: path.split('/')[2] });
      } else if (path.startsWith('/history')) setOverlay({ kind: 'history' });
      else if (path.startsWith('/week')) setTab('week');
      else if (path.startsWith('/shelf')) setTab('shelf');
      else if (path.startsWith('/huddles')) setTab('huddles');
      else setTab('today');
    };

    route(window.location.pathname);

    const removeDesktopRoute = window.bulletsDesktop?.onRoute(route);

    let cancelled = false;
    void (async () => {
      // Only present inside the Capacitor APK; the web build skips it entirely.
      try {
        const { App: CapApp } = await import('@capacitor/app');
        const handle = await CapApp.addListener('appUrlOpen', event => {
          if (cancelled) return;
          route(new URL(event.url).pathname || '/');
        });
        return () => void handle.remove();
      } catch {
        /* web build — nothing to do */
      }
    })();

    return () => {
      cancelled = true;
      removeDesktopRoute?.();
    };
  }, []);

  const closeOverlay = useCallback(() => setOverlay({ kind: 'none' }), []);

  const selection = useSelection();

  /**
   * Zooming drops the selection. One bullet in front of you is a different job
   * from a batch, and it stops the non-modal bulk sheet stranding behind a
   * full-screen overlay that has claimed the same layoutId.
   */
  const zoomTo = useCallback(
    (bulletId: string) => {
      selection.clear();
      setOverlay({ kind: 'zoom', bulletId });
    },
    [selection],
  );

  /**
   * Remember where each tab was scrolled to.
   *
   * Every view unmounts on a tab change, so without this you scroll halfway
   * down the Shelf, glance at Week, come back, and you are at the top again —
   * which on a long list is the difference between checking something and
   * losing your place.
   *
   * This only became possible once the live queries were cached: the incoming
   * view used to render empty on its first frame, so the document had no height
   * yet and any scroll we restored was immediately clamped to 0. Now the rows
   * are already there in the same commit, so a layout effect can put the offset
   * back before the browser paints.
   *
   * Deliberately not persisted, and deliberately per-session: the offsets are
   * meaningless once the underlying lists have changed.
   */
  const scrollByTab = useRef<Partial<Record<Tab, number>>>({});
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useLayoutEffect(() => {
    // Layout, not passive: this has to land before paint or the new tab shows
    // its top for a frame and then jumps.
    window.scrollTo(0, scrollByTab.current[tab] ?? 0);
  }, [tab]);

  // A selection belongs to the screen it was made on, so leaving cancels it.
  const goTab = useCallback(
    (next: Tab) => {
      // Read from the ref so this callback stays stable across tab changes.
      scrollByTab.current[tabRef.current] = window.scrollY;
      selection.clear();
      setTab(next);
    },
    [selection],
  );
  const openHuddle = useCallback(
    (huddleId: string) => setOverlay({ kind: 'huddle', huddleId }),
    [],
  );

  // Onboarding first, then identity. Explaining what the thing is before asking
  // who you are is the right order, and it means Angie sees it on her own
  // device too rather than only whoever installed first.
  if (!onboarded) {
    return (
      <Onboarding
        onDone={() => {
          localStorage.setItem(ONBOARDED_KEY, '1');
          setOnboarded(true);
        }}
      />
    );
  }

  if (!person) return <SignIn onDone={setPerson} />;

  return (
    <div className="min-h-dvh" style={{ paddingTop: 'var(--inset-top)' }}>
      {/* No AnimatePresence around the tabs on purpose. `mode="wait"` would
          hold the new view until the old one finished animating out, which
          reads as lag on every single tab press — the opposite of how a native
          tab bar behaves. The outgoing view unmounts immediately and the
          incoming one springs in. */}
      {/* Wraps motion.main ONLY. On the root div a transform would become the
          containing block for TabBar, Toast and every fixed overlay, and the
          tab bar would slide down with the pull. */}
      <RefreshGesture
        disabled={overlay.kind !== 'none' || capturing || requesting}
        resetKey={tab}
      >
      <motion.main
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={settle}
        >
          {tab === 'today' && (
            <TodayView
              onZoom={zoomTo}
              onOpenHuddle={openHuddle}
              onStartDailyPull={() => setOverlay({ kind: 'pull', mode: 'daily' })}
            />
          )}
          {tab === 'week' && (
            <WeekView
              onZoom={zoomTo}
              onOpenHuddle={openHuddle}
              onStartWeeklyPull={() => setOverlay({ kind: 'pull', mode: 'weekly' })}
            />
          )}
          {tab === 'shelf' && (
            <ShelfView
              onOpenHistory={() => setOverlay({ kind: 'history' })}
              onZoom={zoomTo}
              onStartWeeklyPull={() => setOverlay({ kind: 'pull', mode: 'weekly' })}
            />
          )}
          {tab === 'huddles' && (
            <HuddlesView onOpen={openHuddle} onRequest={() => setRequesting(true)} />
          )}
      </motion.main>
      </RefreshGesture>

      <TabBar
        tab={tab}
        onTab={goTab}
        onCapture={() => setCapturing(true)}
        huddleBadge={pendingHuddles}
      />

      <CaptureSheet
        open={capturing}
        onClose={() => setCapturing(false)}
        onError={message => {
          setToast(`Not saved — ${message}. Try again.`);
          setToastAction(null);
        }}
        onSaved={({ horizon }) => {
          setToast(
            horizon === 'shelf'
              ? 'Saved to the Shelf'
              : `Saved to ${HORIZON_META[horizon].label}`,
          );
          setToastAction(horizon === 'shelf' ? { label: 'Show', run: () => setTab('shelf') } : null);
        }}
      />

      <RequestHuddleSheet
        open={requesting}
        onClose={() => setRequesting(false)}
        onCreated={id => {
          setRequesting(false);
          setToast('Huddle is on both calendars.');
          openHuddle(id);
        }}
      />

      <AnimatePresence>
        {overlay.kind === 'zoom' && (
          <BulletZoom
            key={overlay.bulletId}
            bulletId={overlay.bulletId}
            onClose={closeOverlay}
            onZoom={zoomTo}
          />
        )}
        {overlay.kind === 'pull' && (
          <PullDeck key={`pull-${overlay.mode}`} mode={overlay.mode} onDone={closeOverlay} />
        )}
        {overlay.kind === 'history' && <HistoryView key="history" onClose={closeOverlay} />}
        {overlay.kind === 'huddle' && (
          <HuddleBoard key={overlay.huddleId} huddleId={overlay.huddleId} onClose={closeOverlay} />
        )}
      </AnimatePresence>

      {/* No "OK" action. A toast that has to be acknowledged is a dialog
          wearing a toast's clothes — and since dismissing was the only code
          path that cleared it, one left unacknowledged sat there permanently.
          It times itself out now; "Show" survives because going to the Shelf
          is a real thing you might want, not an acknowledgement. */}
      {/* Root-mounted, non-modal: it stands while you keep ticking rows. */}
      <BulkSheet
        onToast={(message, undo) => {
          setToast(message);
          setToastAction(undo ? { label: undo.label, run: () => void undo.run() } : null);
        }}
      />

      <Toast
        message={toast}
        actionLabel={toastAction?.label}
        onAction={() => {
          toastAction?.run();
          setToast(null);
          setToastAction(null);
        }}
        onDismiss={() => {
          setToast(null);
          setToastAction(null);
        }}
      />
    </div>
  );
}
