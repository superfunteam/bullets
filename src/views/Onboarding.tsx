import {
  AnimatePresence,
  LayoutGroup,
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
  type Transition,
} from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Slab } from '../design/Slab';
import {
  BigButton,
  ClientPill,
  HorizonChip,
  KindGlyph,
  SelectionMark,
  TensionBadge,
} from '../design/bits';
import { fling, prefersReducedMotion, settle, snap, stagger } from '../design/springs';
import { HORIZONS, HORIZON_META, type Horizon } from '../data/types';
import { Logo } from '../design/Logo';

/**
 * Onboarding.
 *
 * Eight cards, one fact each. It used to be five, and each of those five sold
 * the idea before teaching it — the first card opened by arguing with other
 * trackers, which is a pitch aimed at someone still deciding. Clark and Angie
 * built this thing. They are not the audience for a pitch.
 *
 * So: no card argues, no card carries a second sentence for rhythm, and every
 * noun on screen is a word the running app actually prints. That last rule is
 * why "shots" and "hits" are absent — the app stopped saying them (Today heads
 * its finished section "Done · N"), and a tutorial that teaches vocabulary the
 * next screen doesn't use is just debt with a friendly face.
 *
 * More cards, fewer words. Reading load is words per screen, not screen count,
 * and Angie's system font is large enough that the old 40-word opener filled
 * one.
 *
 * Everything here is static example data on purpose — no store, no Dexie, no
 * writes. Nothing you touch on the way in should end up in the shelf.
 */

const SWIPE_RATIO = 0.24;
const SWIPE_MAX = 96;
const SWIPE_VELOCITY = 480;

/**
 * Client hues for the demo cards. These used to feed the Slab spine; the spine
 * is gone and ClientPill carries client identity now, so the tutorial shows the
 * control the app actually has. A tutorial teaching a control that no longer
 * exists is worse than no tutorial.
 */
const HUE_HALCYON = 250;
const HUE_SUPERFUN = 25;

/**
 * Two days, not nine.
 *
 * The old idea card rendered `level="incoming" daysLeft={9}`, which the engine
 * cannot produce: tensionOf only returns incoming inside INCOMING_WINDOW, which
 * is 3. The one card carrying the whole premise was demonstrating an impossible
 * state. At two days the badge is real, and — because moveToHorizon aims a
 * bullet the moment it lands on NOW or NEXT — it genuinely goes dark for those
 * two and stays lit for the other three. Card 3 leans on exactly that.
 */
const DEMO_DAYS = 2;
const DEMO_TARGET = 'Fri 14 Aug';
const AIMED: Horizon[] = ['now', 'next'];

type CardProps = { active: boolean; reduced: boolean };

const CARDS: { id: string; label: string; render: (p: CardProps) => ReactNode }[] = [
  { id: 'capture', label: 'Add a bullet', render: p => <CaptureCard {...p} /> },
  { id: 'target', label: 'Targets', render: p => <TargetCard {...p} /> },
  { id: 'horizons', label: 'When will you do it', render: p => <HorizonsCard {...p} /> },
  { id: 'weekly', label: 'The Weekly Pull', render: p => <WeeklyCard {...p} /> },
  { id: 'daily', label: 'The Daily Pull', render: p => <DailyCard {...p} /> },
  { id: 'finish', label: 'Finishing', render: p => <FinishCard {...p} /> },
  { id: 'counts', label: 'Counts', render: p => <CountsCard {...p} /> },
  { id: 'huddles', label: 'Huddles', render: p => <HuddlesCard {...p} /> },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const [index, setIndex] = useState(0);

  /**
   * The track is paged in pixels rather than percentages, because drag writes
   * pixels into the same motion value and a value that mixes the two units
   * cannot be interpolated. So: measure once, and again whenever the viewport
   * changes under us (rotation, keyboard, split screen).
   */
  const trackRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const x = useMotionValue(0);

  const indexRef = useRef(index);
  indexRef.current = index;

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setPage(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-anchor on resize only. Keyed off a ref so a page change doesn't stomp
  // the spring that a tap or a swipe just started.
  useEffect(() => {
    x.jump(-indexRef.current * page);
  }, [page, x]);

  const last = index === CARDS.length - 1;

  /**
   * One place decides where the track rests, and it runs on release as well as
   * on tap — a drag that doesn't clear the threshold still has to be put back,
   * and `animate` on the prop wouldn't fire for an index that never changed.
   */
  const goTo = (to: number, velocity = 0) => {
    const next = Math.max(0, Math.min(CARDS.length - 1, to));
    const moving = next !== indexRef.current;
    setIndex(next);
    const target = -next * page;
    if (reduced) {
      x.jump(target);
      return;
    }
    /**
     * Velocity is carried only when the deck actually changes page. A flick
     * that doesn't clear the threshold — or one thrown past either end — is
     * going back where it came from, and handing `fling` an outward velocity
     * for that swings the whole deck wide before it returns.
     */
    animate(x, target, moving && velocity !== 0 ? { ...fling, velocity } : settle);
  };

  const goRef = useRef(goTo);
  goRef.current = goTo;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goRef.current(indexRef.current + 1);
      else if (e.key === 'ArrowLeft') goRef.current(indexRef.current - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const threshold = Math.min(SWIPE_MAX, Math.max(44, page * SWIPE_RATIO));

  return (
    <motion.div
      className="fixed inset-0 flex flex-col overflow-hidden bg-[var(--bg)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0.01 } : { duration: 0.2 }}
      style={{
        paddingTop: 'calc(var(--inset-top) + 0.5rem)',
        paddingBottom: 'calc(var(--inset-bottom) + 1.35rem)',
      }}
    >
      <header className="mx-auto flex w-full max-w-md shrink-0 items-center justify-between px-6">
        <span className="flex items-center gap-2 text-[var(--ink-3)]">
          <Logo size={14} />
          <span className="meta uppercase" style={{ letterSpacing: '0.14em' }}>
            Bullets
          </span>
        </span>
        <motion.button
          type="button"
          onClick={onDone}
          whileTap={{ scale: 0.94 }}
          transition={snap}
          className="meta -mr-3 flex min-h-[var(--tap)] items-center px-3 text-[var(--ink-3)] uppercase"
          style={{ fontVariationSettings: "'wght' 700" }}
        >
          Skip
        </motion.button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <motion.div
          ref={trackRef}
          className="flex h-full touch-pan-y"
          style={{ x }}
          drag="x"
          dragDirectionLock
          dragMomentum={false}
          dragConstraints={{ left: -(CARDS.length - 1) * page, right: 0 }}
          dragElastic={0.14}
          onDragEnd={(_, info) => {
            const far = info.offset.x;
            const v = info.velocity.x;
            // Distance *or* velocity, same as the Pull: a confident flick is a
            // decision even when the finger barely travelled.
            const next =
              far < -threshold || v < -SWIPE_VELOCITY
                ? index + 1
                : far > threshold || v > SWIPE_VELOCITY
                  ? index - 1
                  : index;
            goTo(next, v);
          }}
        >
          {CARDS.map((card, i) => (
            <Page key={card.id} hidden={i !== index}>
              {card.render({ active: i === index, reduced })}
            </Page>
          ))}
        </motion.div>
      </div>

      <footer className="mx-auto w-full max-w-md shrink-0 px-6">
        <nav className="mb-1 flex items-center justify-center" aria-label="Onboarding">
          {CARDS.map((card, i) => (
            <button
              key={card.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={card.label}
              aria-current={i === index ? 'step' : undefined}
              // Eight dots now, so the hit target sheds the fixed 2.25rem width
              // and shares the row instead — still a full --tap tall.
              className="flex h-[var(--tap)] flex-1 max-w-9 items-center justify-center"
            >
              <span className="relative flex h-2 w-2 items-center justify-center">
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{ background: 'var(--line-strong)' }}
                />
                {i === index && (
                  <motion.span
                    aria-hidden
                    layoutId="onboarding-dot"
                    className="absolute -inset-[3px] rounded-full"
                    style={{ background: 'var(--ink)' }}
                    transition={reduced ? { duration: 0.01 } : snap}
                  />
                )}
              </span>
            </button>
          ))}
        </nav>

        {/* "Start", not "Take the first shot". That construction is the one
            Clark rejected by name, it flavours a verb rather than a noun, and
            it promised work on a button that actually opens sign-in. */}
        <BigButton onClick={() => (last ? onDone() : goTo(index + 1))}>
          {last ? 'Start' : 'Next'}
        </BigButton>
      </footer>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ scaffold */

function Page({ children, hidden }: { children: ReactNode; hidden: boolean }) {
  return (
    <div
      className="hide-scrollbar h-full w-full shrink-0 overflow-y-auto px-6"
      // Off-screen pages stay mounted so their layout is already measured when
      // they arrive, but they should not be read out where they aren't.
      aria-hidden={hidden}
    >
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center py-3">
        {children}
      </div>
    </div>
  );
}

/**
 * Eyebrow, headline, one sentence. There used to be a fourth slot — `grace` —
 * holding an editorial line per card ("Twenty is a project. Three is a
 * Tuesday."). Every one of them was a copywriter's aphorism restating the
 * picture above it, so the slot is gone rather than emptied; an empty slot is
 * an invitation to refill it.
 */
function Head({ eyebrow, title, body }: { eyebrow: string; title: string; body: ReactNode }) {
  return (
    <div>
      <p className="meta text-[var(--ink-3)] uppercase" style={{ letterSpacing: '0.14em' }}>
        {eyebrow}
      </p>
      <h2 className="display mt-2.5 text-[2.15rem] leading-[1.08] text-[var(--ink)]">{title}</h2>
      <p className="mt-3.5 text-[1.0625rem] leading-relaxed text-[var(--ink-2)]">{body}</p>
    </div>
  );
}

/** The one-line caption that sits under an illustration. Never a second body. */
function Caption({ children }: { children: ReactNode }) {
  return <p className="meta mt-4 leading-snug text-[var(--ink-3)]">{children}</p>;
}

/* --------------------------------------------------------------- 1 · capture */

const DEMO_TITLE = 'Halcyon rebrand deck';

/**
 * How a bullet gets in — which the deck never showed. It opened on the concept
 * of two dates, for an object the reader had not yet watched anyone create.
 */
function CaptureCard({ active, reduced }: CardProps) {
  const [typed, setTyped] = useState(reduced ? DEMO_TITLE.length : 0);
  const tick = useRef<number>(undefined);

  useEffect(() => {
    if (!active) return;
    if (reduced) {
      setTyped(DEMO_TITLE.length);
      return;
    }
    setTyped(0);
    // A beat before it starts, so the placeholder is legible first — the point
    // of the card is that you type into an empty field.
    const start = window.setTimeout(() => {
      tick.current = window.setInterval(() => {
        setTyped(n => {
          if (n < DEMO_TITLE.length) return n + 1;
          window.clearInterval(tick.current);
          return n;
        });
      }, 42);
    }, 420);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(tick.current);
    };
  }, [active, reduced]);

  const done = typed >= DEMO_TITLE.length;

  return (
    <>
      <Head
        eyebrow="New bullet"
        title="Add a bullet."
        body="A new bullet waits on the Shelf until you decide when to do it."
      />

      <div className="mt-8">
        <Slab tone="raised">
          <div className="px-6 py-6">
            {/* The real capture sheet's own placeholder, so the first thing
                taught is a string the app will actually show. */}
            <p className="text-[1.35rem] leading-snug text-[var(--ink)]">
              {typed === 0 ? (
                <span className="text-[var(--ink-3)]">What is it?</span>
              ) : (
                DEMO_TITLE.slice(0, typed)
              )}
              {!done && !reduced && (
                <motion.span
                  aria-hidden
                  className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.15em] bg-[var(--ink)]"
                  animate={{ opacity: [1, 1, 0, 0] }}
                  transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
                />
              )}
            </p>
          </div>
        </Slab>

        {/* The exact toast App.tsx fires on a Shelf save. Inert here. */}
        <div className="mt-4 h-[var(--tap)]">
          <AnimatePresence>
            {done && (
              <motion.div
                className="flex items-center justify-between gap-3 rounded-[var(--r-md)] px-4 py-3"
                style={{ background: 'var(--ink)', color: 'var(--bg)' }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={reduced ? { duration: 0.01 } : settle}
              >
                <span style={{ fontVariationSettings: "'wght' 600" }}>Saved to the Shelf</span>
                <span className="meta uppercase opacity-60">Show</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- 2 · target */

/**
 * The example slab is deliberately NOT shared with card 3 via layoutId. Every
 * page stays mounted, so two live elements would carry the same layoutId at
 * once — the duplicate-layoutId trap already in AGENTS.md. Nothing is lost:
 * the pages translate past each other, so a cross-page layout tween would not
 * read anyway.
 */
function TargetCard({ active, reduced }: CardProps) {
  const t: Transition = reduced ? { duration: 0.01 } : settle;

  return (
    <>
      <Head
        eyebrow="Target"
        title="When it's due."
        body="A target is a real deadline — not when you plan to do it."
      />

      <div className="mt-8">
        <ExampleSlab
          horizon={null}
          badge
          active={active}
          reduced={reduced}
          badgeTransition={active && !reduced ? { ...snap, delay: 0.45 } : t}
        />
        <Caption>Bullets only counts down once the target is close.</Caption>
      </div>
    </>
  );
}

/**
 * The running example, shown the way a live list shows it: glyph, title, and
 * one inline meta line. The old card laid it out as a form with "Target" and
 * "Horizon" as dt labels — no screen in the app labels either field, and it
 * printed the same date twice, once as a value and once as "9d out".
 */
function ExampleSlab({
  horizon,
  badge,
  active,
  reduced,
  badgeTransition,
}: {
  horizon: Horizon | null;
  badge: boolean;
  active: boolean;
  reduced: boolean;
  badgeTransition?: Transition;
}) {
  return (
    <Slab tone="raised">
      <div className="px-6 py-6 pl-8">
        <div className="flex h-7 items-center gap-2.5">
          <SelectionMark kind="task" title={DEMO_TITLE} />
          {horizon && <HorizonChip horizon={horizon} size="sm" active />}
          <AnimatePresence mode="popLayout">
            {badge && (
              <motion.span
                key="badge"
                initial={{ opacity: 0, scale: 0.72 }}
                animate={active ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.72 }}
                exit={{ opacity: 0, scale: 0.72 }}
                transition={badgeTransition ?? (reduced ? { duration: 0.01 } : snap)}
              >
                <TensionBadge level="incoming" daysLeft={DEMO_DAYS} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <h3 className="display mt-3 text-[1.4rem] leading-tight text-[var(--ink)]">{DEMO_TITLE}</h3>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <ClientPill hue={HUE_HALCYON} name="Halcyon" />
          <span className="meta text-[var(--ink-2)]">Target · {DEMO_TARGET}</span>
        </div>
      </div>
    </Slab>
  );
}

/* -------------------------------------------------------------- 3 · horizons */

/**
 * The horizon, taught by consequence rather than by adjective.
 *
 * The old card listed five chips against five priority blurbs ("Super urgent",
 * "As soon as we can") while its body insisted horizons were *not* priority —
 * the card argued with itself. Now each chip states where the bullet lands, and
 * the example above reacts: NOW and NEXT aim it, so its target badge goes dark;
 * the other three leave it unaimed and lit. That is not a dramatisation, it is
 * what moveToHorizon and tensionOf actually do.
 *
 * One caption at a time, too. Five blurbs at once is five blurbs on Angie's
 * font size.
 */
function HorizonsCard({ active, reduced }: CardProps) {
  const [picked, setPicked] = useState<Horizon>('shelf');

  useEffect(() => {
    if (!active) setPicked('shelf');
  }, [active]);

  const aimed = AIMED.includes(picked);

  return (
    <>
      <Head
        eyebrow="When will you do it?"
        title="Three answers."
        body="Tap one to see where the bullet turns up."
      />

      <div className="mt-7">
        <div className="flex flex-wrap gap-2">
          {HORIZONS.map((h, i) => (
            <motion.button
              key={h}
              type="button"
              onClick={() => setPicked(h)}
              aria-pressed={picked === h}
              whileTap={{ scale: 0.94 }}
              initial={{ opacity: 0, y: 8 }}
              animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={
                reduced ? { duration: 0.01 } : { ...settle, delay: active ? stagger(i, 0.045) : 0 }
              }
            >
              <HorizonChip horizon={h} size="lg" active={picked === h} />
            </motion.button>
          ))}
        </div>

        {/* Fixed two lines: the Shelf caption wraps and the slab below must not
            hop a line when you tap across. */}
        <div className="mt-4 flex min-h-[2.9rem] items-start">
          <AnimatePresence mode="wait">
            <motion.p
              key={picked}
              className="text-[1.0625rem] leading-snug text-[var(--ink-2)]"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={reduced ? { duration: 0.01 } : snap}
            >
              {HORIZON_META[picked].blurb}
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="mt-4">
          <ExampleSlab horizon={picked} badge={!aimed} active={active} reduced={reduced} />
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- 4 · weekly pull */

const MINI_X = 74;
const MINI_Y = 62;

/**
 * The gesture, learned by doing.
 *
 * Nothing is written and nothing flies away — the card springs home so all
 * three directions can be tried in the ten seconds someone is willing to give
 * an onboarding screen. Nested drag needs no special handling: motion's drag
 * lock is global, and the inner card claims it before the deck sees the
 * pointer.
 *
 * The stamps now say what the live deck says. They used to read "Pull in" and
 * "Push out", words that appear on no screen in the app — you learned a
 * vocabulary and then met three different buttons. The hint row underneath is
 * gone with them: it printed the same three outcomes a second time, at rest,
 * where the stamps already print them under your thumb.
 */
// No `reduced` here: everything that moves on this card is the user's own
// finger, and the spring-back is direct-manipulation feedback rather than
// decoration.
function WeeklyCard({ active }: CardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-9, 0, 9]);

  const pullTint = useTransform(x, [14, MINI_X], [0, 0.85]);
  const pushTint = useTransform(x, [-14, -MINI_X], [0, 0.85]);
  const shelveTint = useTransform(y, [-14, -MINI_Y], [0, 0.85]);
  const pullStamp = useTransform(x, [30, MINI_X], [0, 1]);
  const pushStamp = useTransform(x, [-30, -MINI_X], [0, 1]);
  const shelveStamp = useTransform(y, [-30, -MINI_Y], [0, 1]);

  // Leaving the card mid-gesture shouldn't leave it parked off-centre.
  useEffect(() => {
    if (active) return;
    x.jump(0);
    y.jump(0);
  }, [active, x, y]);

  return (
    <>
      <Head
        eyebrow="Once a week"
        title="The Weekly Pull."
        // Not "off the Shelf": the weekly deck also draws anything
        // targeted inside three weeks, and anything open that has lost its
        // commitment — the safety net the whole state model rests on.
        body="It brings back everything you haven't committed to yet."
      />

      <div className="mt-7">
        <motion.div
          className="h-[150px] touch-none"
          style={{ x, y, rotate }}
          drag
          dragDirectionLock
          dragMomentum={false}
          dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
          dragElastic={{ left: 1, right: 1, top: 1, bottom: 0.18 }}
          dragTransition={{ bounceStiffness: 340, bounceDamping: 32 }}
        >
          <Slab tone="raised" className="h-full">
            <motion.span
              aria-hidden
              className="absolute inset-0"
              style={{ opacity: pullTint, background: 'var(--hit-soft)' }}
            />
            <motion.span
              aria-hidden
              className="absolute inset-0"
              style={{ opacity: pushTint, background: 'var(--surface-3)' }}
            />
            <motion.span
              aria-hidden
              className="absolute inset-0"
              style={{ opacity: shelveTint, background: 'var(--surface-2)' }}
            />

            <div className="relative flex h-full flex-col justify-between px-6 py-5 pl-8">
              <div className="flex items-center gap-2.5">
                <SelectionMark kind="task" title="Draft the Q4 pitch" />
                <HorizonChip horizon="shelf" size="sm" active />
              </div>
              <h3 className="display text-[1.5rem] leading-tight text-[var(--ink)]">
                Draft the Q4 pitch
              </h3>
              <ClientPill hue={HUE_SUPERFUN} name="Superfun" />
            </div>

            <MiniStamp
              label="This week"
              color="var(--hit)"
              tilt={-6}
              opacity={pullStamp}
              className="top-4 left-5"
            />
            <MiniStamp
              label="Later"
              color="var(--ink-3)"
              tilt={6}
              opacity={pushStamp}
              className="top-4 right-5"
            />
            <MiniStamp
              label="Shelve"
              color="var(--ink-2)"
              tilt={0}
              opacity={shelveStamp}
              className="right-5 bottom-4"
            />
          </Slab>
        </motion.div>

        <Caption>Drag the card.</Caption>
      </div>
    </>
  );
}

function MiniStamp({
  label,
  color,
  tilt,
  opacity,
  className,
}: {
  label: string;
  color: string;
  tilt: number;
  opacity: MotionValue<number>;
  className: string;
}) {
  return (
    <motion.span
      aria-hidden
      className={`meta pointer-events-none absolute rounded-[var(--r-sm)] border-2 px-2.5 py-1.5
                  text-[0.6875rem] uppercase ${className}`}
      style={{
        opacity,
        rotate: tilt,
        color,
        borderColor: color,
        fontVariationSettings: "'wght' 800",
        letterSpacing: '0.14em',
      }}
    >
      {label}
    </motion.span>
  );
}

/* ------------------------------------------------------------ 5 · daily pull */

/**
 * Deliberately still. The gesture was learned one card ago; this card's two
 * facts are that the daily deck says different words, and that every swipe is
 * also a button you can just press.
 */
function DailyCard({ active, reduced }: CardProps) {
  return (
    <>
      <Head
        eyebrow="Every morning"
        title="The Daily Pull."
        body="It only offers what's already in this week."
      />

      <div className="mt-7">
        <Slab tone="raised">
          <div className="flex h-[122px] flex-col justify-between px-6 py-5 pl-8">
            <div className="flex items-center gap-2.5">
              <SelectionMark kind="task" title="Draft the Q4 pitch" />
              <HorizonChip horizon="next" size="sm" active />
            </div>
            <h3 className="display text-[1.5rem] leading-tight text-[var(--ink)]">
              Draft the Q4 pitch
            </h3>
          </div>
        </Slab>

        <div className="mt-2.5 flex gap-2.5">
          {[
            { label: 'Not today', tone: 'quiet' as const, grow: false },
            { label: 'Shelve', tone: 'quiet' as const, grow: false },
            { label: 'Do today', tone: 'hit' as const, grow: true },
          ].map((b, i) => (
            <motion.div
              key={b.label}
              className={`min-h-[var(--tap)] rounded-[var(--r-md)] px-3 py-3.5 text-center
                          ${b.grow ? 'flex-[1.5]' : 'flex-1'}`}
              style={{
                background: b.tone === 'hit' ? 'var(--hit-soft)' : 'var(--surface-2)',
                color: b.tone === 'hit' ? 'var(--hit)' : 'var(--ink-2)',
                fontVariationSettings: "'wght' 700",
                letterSpacing: '-0.01em',
              }}
              initial={{ opacity: 0, y: 10 }}
              animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
              transition={
                reduced ? { duration: 0.01 } : { ...settle, delay: active ? stagger(i, 0.06) : 0 }
              }
            >
              {b.label}
            </motion.div>
          ))}
        </div>

        {/* The one fact no animation can show: daily-left calls no mutation at
            all. The card just leaves the deck. */}
        <Caption>Not today just skips it. It stays in the week.</Caption>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- 6 · finish */

/** ShotCard's own numbers, so the gesture taught here has the real weight. */
const FINISH_X = 130;
const FINISH_VELOCITY = 650;

/**
 * Swiping a card right to finish it is the single most-used gesture in the app,
 * performed every day, and the deck never mentioned it — it taught the Pull's
 * swipe, used twice a week, and left this one to be discovered by accident.
 */
function FinishCard({ active, reduced }: CardProps) {
  const [done, setDone] = useState(false);
  const x = useMotionValue(0);
  const flood = useTransform(x, [0, FINISH_X], [0, 1]);
  const floodOpacity = useTransform(x, [0, 40, FINISH_X], [0, 0.35, 1]);
  const tick = useTransform(x, [FINISH_X * 0.75, FINISH_X], [0, 1]);

  useEffect(() => {
    if (active) return;
    setDone(false);
    x.jump(0);
  }, [active, x]);

  return (
    <>
      <Head
        eyebrow="Today"
        title="Swipe right to finish."
        body="Tap a finished card to put it back."
      />

      <div className="mt-7">
        <AnimatePresence mode="wait">
          {!done ? (
            <motion.div
              key="open"
              className="touch-pan-y"
              style={{ x }}
              drag="x"
              dragDirectionLock
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.02, right: 0.7 }}
              onDragEnd={(_, info) => {
                // Distance or velocity, exactly as ShotCard decides it — a
                // confident flick counts even when the finger barely travelled.
                if (info.offset.x > FINISH_X || info.velocity.x > FINISH_VELOCITY) setDone(true);
              }}
              exit={{ opacity: 0 }}
              transition={reduced ? { duration: 0.01 } : settle}
            >
              <Slab tone="raised">
                <motion.span
                  aria-hidden
                  className="absolute inset-0 origin-left"
                  style={{ scaleX: flood, opacity: floodOpacity, background: 'var(--hit-soft)' }}
                />
                <div className="relative flex items-center gap-3 px-6 py-5">
                  <SelectionMark kind="task" title="Draft the Q4 pitch" />
                  <h3 className="display flex-1 text-[1.35rem] leading-tight text-[var(--ink)]">
                    Draft the Q4 pitch
                  </h3>
                  <motion.span
                    aria-hidden
                    className="text-[1.4rem]"
                    style={{ opacity: tick, color: 'var(--hit)' }}
                  >
                    ✓
                  </motion.span>
                </div>
              </Slab>
            </motion.div>
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduced ? { duration: 0.01 } : settle}
            >
              {/* The same heading TodayView renders, so the body's "finished
                  card" has somewhere on screen to point at. */}
              <h3 className="meta mb-2.5 px-1 text-[var(--ink-3)] uppercase">
                Done · <span className="numeral">1</span>
              </h3>
              {/* Reset x as well as state: the card exited mid-drag, and
                  without this it re-enters parked at the throw distance. */}
              <Slab
                tone="quiet"
                onClick={() => {
                  x.jump(0);
                  setDone(false);
                }}
              >
                <div className="flex items-center gap-3 px-6 py-5">
                  <SelectionMark kind="task" done title="Draft the Q4 pitch" />
                  <h3
                    className="display flex-1 text-[1.35rem] leading-tight text-[var(--ink-3)]"
                    style={{ textDecoration: 'line-through' }}
                  >
                    Draft the Q4 pitch
                  </h3>
                </div>
              </Slab>
            </motion.div>
          )}
        </AnimatePresence>

        <Caption>{done ? 'Tap it.' : 'Drag the card right.'}</Caption>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- 7 · counts */

const SHOT_TOTAL = 20;
const SHOT_DONE = 3;
const SHOT_LINED = 5;

function CountsCard({ active, reduced }: CardProps) {
  return (
    <>
      <Head
        eyebrow="How many"
        title="Twenty posts is one bullet."
        body="The Pull asks how many you want this week."
      />

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <p className="meta text-[var(--ink-3)] uppercase">Halcyon TikTok posts</p>
          <p className="meta text-[var(--ink-2)]">
            <span className="numeral text-[var(--ink)]">{SHOT_DONE}</span> of{' '}
            <span className="numeral">{SHOT_TOTAL}</span>
          </p>
        </div>

        {/* Discrete blocks, never a percentage bar — a bar invites arguing with
            it. The fill is a separate layer that scales in, so no colour is
            interpolated on the compositor. */}
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {Array.from({ length: SHOT_TOTAL }, (_, i) => {
            const fill =
              i < SHOT_DONE
                ? 'var(--hit)'
                : i < SHOT_DONE + SHOT_LINED
                  ? // Not surface-3: against a surface-2 block it is a shade
                    // apart, and "committed" has to be visible across the grid.
                    'var(--line-strong)'
                  : null;
            return (
              <span
                key={i}
                className="h-7 w-7 rounded-[8px]"
                style={{ background: 'var(--surface-2)' }}
              >
                {fill && (
                  <motion.span
                    aria-hidden
                    className="block h-full w-full rounded-[8px]"
                    style={{ background: fill }}
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={active ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
                    transition={
                      reduced
                        ? { duration: 0.01 }
                        : { ...snap, delay: active ? stagger(i, 0.028, 0.36) : 0 }
                    }
                  />
                )}
              </span>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          <Swatch color="var(--hit)">
            <span className="numeral">{SHOT_DONE}</span> done
          </Swatch>
          <Swatch color="var(--line-strong)">
            <span className="numeral">{SHOT_LINED}</span> this week
          </Swatch>
        </div>
      </section>
    </>
  );
}

function Swatch({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="meta inline-flex items-center gap-2 text-[var(--ink-2)]">
      <span aria-hidden className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: color }} />
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- 8 · huddles */

function HuddlesCard({ active, reduced }: CardProps) {
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    if (!active || moved) return;
    if (reduced) {
      setMoved(true);
      return;
    }
    const timer = setTimeout(() => setMoved(true), 850);
    return () => clearTimeout(timer);
  }, [active, moved, reduced]);

  const item = (
    <motion.div
      // Position-only: the decision line changes the slab's height, and
      // animating size would scale the type inside it on the way across.
      layout="position"
      layoutId="onboarding-huddle-item"
      transition={reduced ? { duration: 0.01 } : settle}
    >
      <Slab tone={moved ? 'quiet' : 'default'} onClick={() => setMoved(m => !m)}>
        <div className="px-5 py-4 pl-7">
          <div className="flex items-start gap-3">
            <span className="mt-1">
              <KindGlyph kind="event" />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className="display text-[1.05rem] leading-tight"
                style={{ color: moved ? 'var(--ink-2)' : 'var(--ink)' }}
              >
                Halcyon launch — which week?
              </p>
              {moved && (
                <p className="editorial mt-1.5 text-[1.15rem] leading-snug text-[var(--ink)]">
                  The 8th. Angie takes the copy.
                </p>
              )}
            </div>
          </div>
        </div>
      </Slab>
    </motion.div>
  );

  return (
    <>
      <Head
        eyebrow="Huddles"
        title="Call a huddle."
        body="You both see the same board. Items move from On the table to Decided."
      />

      <div className="mt-7">
        <LayoutGroup id="onboarding-huddle">
          {/* The board's real empty strings, not invented ones. */}
          <Lane
            label="On the table"
            count={moved ? 0 : 1}
            empty="Nothing on the table yet. Add what you want to talk about."
          >
            {!moved && item}
          </Lane>
          <Lane label="Decided" count={moved ? 1 : 0} empty="Nothing decided yet.">
            {moved && item}
          </Lane>
        </LayoutGroup>
      </div>
    </>
  );
}

function Lane({
  label,
  count,
  empty,
  children,
}: {
  label: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="meta mb-2.5 px-1 text-[var(--ink-3)] uppercase">
        {label} · <span className="numeral">{count}</span>
      </h3>
      <div className="flex min-h-[74px] flex-col justify-center">
        {count === 0 ? (
          <p className="editorial px-1 text-lg leading-snug text-[var(--ink-3)]">{empty}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
