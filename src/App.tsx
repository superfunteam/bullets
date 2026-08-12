import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { TabBar, type Tab } from './design/TabBar';
import { Toast } from './design/bits';
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
import { restoreIdentity } from './sync/auth';
import { startSync } from './sync/client';
import { useHuddles } from './data/store';
import { getActor } from './data/mutations';
import { seedIfEmpty } from './data/seed';
import { hasAnswered, type Person } from './data/types';

type Overlay =
  | { kind: 'none' }
  | { kind: 'zoom'; bulletId: string }
  | { kind: 'pull'; mode: 'weekly' | 'daily' }
  | { kind: 'huddle'; huddleId: string };

export function App() {
  const [person, setPerson] = useState<Person | null>(() => restoreIdentity());
  const [tab, setTab] = useState<Tab>('today');
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [capturing, setCapturing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
    void seedIfEmpty();
    startSync();
  }, [person]);

  // Deep links from the widget and from notification taps.
  useEffect(() => {
    const route = (path: string) => {
      if (path.startsWith('/capture')) setCapturing(true);
      else if (path.startsWith('/huddle/')) {
        setOverlay({ kind: 'huddle', huddleId: path.split('/')[2] });
      } else if (path.startsWith('/week')) setTab('week');
      else if (path.startsWith('/shelf')) setTab('shelf');
      else if (path.startsWith('/huddles')) setTab('huddles');
      else setTab('today');
    };

    route(window.location.pathname);

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
    };
  }, []);

  const closeOverlay = useCallback(() => setOverlay({ kind: 'none' }), []);
  const zoomTo = useCallback((bulletId: string) => setOverlay({ kind: 'zoom', bulletId }), []);
  const openHuddle = useCallback(
    (huddleId: string) => setOverlay({ kind: 'huddle', huddleId }),
    [],
  );

  if (!person) return <SignIn onDone={setPerson} />;

  return (
    <div className="min-h-dvh" style={{ paddingTop: 'var(--inset-top)' }}>
      {/* No AnimatePresence around the tabs on purpose. `mode="wait"` would
          hold the new view until the old one finished animating out, which
          reads as lag on every single tab press — the opposite of how a native
          tab bar behaves. The outgoing view unmounts immediately and the
          incoming one springs in. */}
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
              onZoom={zoomTo}
              onStartWeeklyPull={() => setOverlay({ kind: 'pull', mode: 'weekly' })}
            />
          )}
          {tab === 'huddles' && (
            <HuddlesView onOpen={openHuddle} onRequest={() => setRequesting(true)} />
          )}
      </motion.main>

      <TabBar
        tab={tab}
        onTab={setTab}
        onCapture={() => setCapturing(true)}
        huddleBadge={pendingHuddles}
      />

      <CaptureSheet open={capturing} onClose={() => setCapturing(false)} />

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
        {overlay.kind === 'huddle' && (
          <HuddleBoard key={overlay.huddleId} huddleId={overlay.huddleId} onClose={closeOverlay} />
        )}
      </AnimatePresence>

      <Toast message={toast} actionLabel="OK" onAction={() => setToast(null)} />
    </div>
  );
}
