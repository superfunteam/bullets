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
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Slab } from '../design/Slab';
import { BigButton, HorizonChip, KindGlyph, TensionBadge } from '../design/bits';
import { fling, prefersReducedMotion, settle, snap, stagger } from '../design/springs';
import { HORIZONS, HORIZON_META } from '../data/types';

/**
 * Onboarding.
 *
 * Five cards, and none of them is a tutorial. Clark and Angie have quit Notion,
 * Jira, Obsidian and a dozen checkbox apps precisely because those things ask to
 * be *maintained*, and a nine-screen product tour is the first instalment of
 * exactly that debt. So the copy is a headline and a sentence, the picture does
 * the explaining, and Skip is on screen from the first frame.
 *
 * Everything here is static example data on purpose — no store, no Dexie, no
 * writes. Nothing you touch on the way in should end up in the shelf.
 */

const SWIPE_RATIO = 0.24;
const SWIPE_MAX = 96;
const SWIPE_VELOCITY = 480;

/** A client hue, shown the only way a client hue is ever shown: as a spine. */
const HUE_HALCYON = 250;
const HUE_SUPERFUN = 25;

type CardProps = { active: boolean; reduced: boolean };

const CARDS: { id: string; label: string; render: (p: CardProps) => ReactNode }[] = [
  { id: 'idea', label: 'The idea', render: p => <IdeaCard {...p} /> },
  { id: 'horizons', label: 'The five horizons', render: p => <HorizonsCard {...p} /> },
  { id: 'pull', label: 'The Pull', render: p => <PullCard {...p} /> },
  { id: 'shots', label: 'Shots', render: p => <ShotsCard {...p} /> },
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
        <span
          className="meta text-[var(--ink-3)] uppercase"
          style={{ letterSpacing: '0.14em' }}
        >
          Bullets
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
              className="flex h-[var(--tap)] w-9 items-center justify-center"
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

        <BigButton onClick={() => (last ? onDone() : goTo(index + 1))}>
          {last ? 'Take the first shot' : 'Next'}
        </BigButton>

        {/* Fixed height, so the tagline arriving on the last card doesn't shove
            the button a line up the screen under the thumb that's about to
            press it. */}
        <div className="mt-3 flex h-4 items-center justify-center">
          <AnimatePresence>
            {last && (
              <motion.p
                key="tagline"
                className="meta text-[var(--ink-3)] uppercase"
                style={{ letterSpacing: '0.14em' }}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={reduced ? { duration: 0.01 } : settle}
              >
                No more dodging.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
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

function Head({
  eyebrow,
  title,
  body,
  grace,
}: {
  eyebrow: string;
  title: string;
  body: ReactNode;
  grace?: string;
}) {
  return (
    <div>
      <p className="meta text-[var(--ink-3)] uppercase" style={{ letterSpacing: '0.14em' }}>
        {eyebrow}
      </p>
      <h2 className="display mt-2.5 text-[2.15rem] text-[var(--ink)]">{title}</h2>
      <p className="mt-3.5 text-[1.0625rem] leading-relaxed text-[var(--ink-2)]">{body}</p>
      {grace && (
        <p className="editorial mt-2.5 text-[1.4rem] leading-snug text-[var(--ink-3)]">{grace}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- 1 · the idea */

/**
 * The whole pitch in one card: two dates that every other tracker collapses
 * into one. The badge is the payoff, so it lands a beat after the card settles
 * rather than being already on when you arrive.
 */
function IdeaCard({ active, reduced }: CardProps) {
  const t: Transition = reduced ? { duration: 0.01 } : settle;

  return (
    <>
      <Head
        eyebrow="The idea"
        title="A target and a horizon."
        body="Every other tracker jams both into one date field, then paints the list red. Bullets keeps them apart — when it's due, and when you'll deal with it."
        grace="Nine days out, filed under someday."
      />

      <div className="mt-8">
        <Slab hue={HUE_HALCYON} tone="raised">
          <div className="px-6 py-6 pl-8">
            {/* The badge lands a beat after the card settles. It is the payoff
                of the two rows below it, so arriving already lit would make it
                just another chip. */}
            <div className="flex h-7 items-center gap-2.5">
              <KindGlyph kind="task" />
              <motion.span
                initial={{ opacity: 0, scale: 0.72 }}
                animate={active ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.72 }}
                transition={active && !reduced ? { ...snap, delay: 0.45 } : t}
              >
                <TensionBadge level="incoming" daysLeft={9} />
              </motion.span>
            </div>

            <h3 className="display mt-3 text-[1.4rem] leading-tight text-[var(--ink)]">
              Halcyon rebrand deck
            </h3>

            <dl className="mt-6 space-y-3.5">
              <Field label="Target">
                <span className="text-[var(--ink)]" style={{ fontVariationSettings: "'wght' 620" }}>
                  Fri 21 Aug
                </span>
                <span className="meta ml-2 text-[var(--ink-3)]">
                  <span className="numeral">9</span>d out
                </span>
              </Field>
              <Field label="Horizon">
                <HorizonChip horizon="later" size="sm" active />
              </Field>
            </dl>
          </div>
        </Slab>

        <p className="meta mt-4 leading-snug text-[var(--ink-3)]">
          Bullets says so now, rather than the morning it goes wide.
        </p>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <dt className="meta w-[4.75rem] shrink-0 text-[var(--ink-3)] uppercase">{label}</dt>
      <dd className="flex min-w-0 items-center">{children}</dd>
    </div>
  );
}

/* ---------------------------------------------------------- 2 · the horizons */

function HorizonsCard({ active, reduced }: CardProps) {
  return (
    <>
      <Head
        eyebrow="The map"
        title="Five horizons."
        body="Not priority levels — distance. How far out a thing sits, and nothing more."
        grace="Moving something is not failing at it."
      />

      {/* Two grid columns rather than five rows of flex, so every blurb starts
          on the same axis no matter how wide its chip renders. */}
      <div className="mt-7 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
        {HORIZONS.map((h, i) => {
          const reveal = {
            initial: { opacity: 0, y: 10 },
            animate: active ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 },
            transition: reduced
              ? { duration: 0.01 }
              : { ...settle, delay: active ? stagger(i, 0.05) : 0 },
          };
          return (
            <Fragment key={h}>
              <motion.div {...reveal}>
                <HorizonChip horizon={h} size="lg" active />
              </motion.div>
              <motion.p
                {...reveal}
                className="text-[0.95rem] leading-snug text-[var(--ink-2)]"
              >
                {HORIZON_META[h].blurb}
              </motion.p>
            </Fragment>
          );
        })}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- 3 · the Pull */

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
 */
function PullCard({ active, reduced }: CardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-9, 0, 9]);

  const pullTint = useTransform(x, [14, MINI_X], [0, 0.85]);
  const pushTint = useTransform(x, [-14, -MINI_X], [0, 0.85]);
  const shelveTint = useTransform(y, [-14, -MINI_Y], [0, 0.85]);
  const pullStamp = useTransform(x, [30, MINI_X], [0, 1]);
  const pushStamp = useTransform(x, [-30, -MINI_X], [0, 1]);
  const shelveStamp = useTransform(y, [-30, -MINI_Y], [0, 1]);

  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(null), 1_700);
    return () => clearTimeout(timer);
  }, [said]);

  // Leaving the card mid-gesture shouldn't leave it parked off-centre.
  useEffect(() => {
    if (active) return;
    x.jump(0);
    y.jump(0);
    setSaid(null);
  }, [active, x, y]);

  return (
    <>
      <Head
        eyebrow="The ritual"
        title="The Pull."
        body="Once a week you pick the week off the Shelf. Every morning you pick today out of the week. One card at a time, out loud."
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
          onDragEnd={(_, info) => {
            if (info.offset.x > MINI_X) setSaid('Pulled in');
            else if (info.offset.x < -MINI_X) setSaid('Pushed out to Later');
            else if (info.offset.y < -MINI_Y) setSaid('Shelved');
          }}
        >
          <Slab hue={HUE_SUPERFUN} tone="raised" className="h-full">
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
                <KindGlyph kind="task" />
                <HorizonChip horizon="soon" size="sm" active />
              </div>
              <h3 className="display text-[1.5rem] leading-tight text-[var(--ink)]">
                Draft the Q4 pitch
              </h3>
              <p className="meta text-[var(--ink-2)]">
                Target · Thu · <span className="numeral">6</span>d out
              </p>
            </div>

            <MiniStamp label="Pull in" color="var(--hit)" tilt={-6} opacity={pullStamp} className="top-4 left-5" />
            <MiniStamp
              label="Push out"
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

        <div className="relative mt-4 h-5">
          <AnimatePresence initial={false} mode="wait">
            {said ? (
              <motion.p
                key="said"
                className="meta absolute inset-0 flex items-center justify-center text-[var(--ink)] uppercase"
                style={{ fontVariationSettings: "'wght' 750", letterSpacing: '0.1em' }}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={reduced ? { duration: 0.01 } : snap}
              >
                {said}
              </motion.p>
            ) : (
              <motion.div
                key="hint"
                className="meta absolute inset-0 flex items-center justify-between text-[var(--ink-3)]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={reduced ? { duration: 0.01 } : snap}
              >
                <span>← Push out</span>
                <span>↑ Shelve</span>
                <span>Pull in →</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="editorial mt-4 text-[1.3rem] leading-snug text-[var(--ink-3)]">
          Go on. That card actually moves.
        </p>
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

/* ------------------------------------------------------------------ 4 · shots */

const SHOT_TOTAL = 20;
const SHOT_HIT = 3;
const SHOT_LINED = 5;

function ShotsCard({ active, reduced }: CardProps) {
  return (
    <>
      <Head
        eyebrow="The unit"
        title="One bullet, many shots."
        body={
          <>
            “TikTok posts ×<span className="numeral">20</span>” is one line on the Shelf — and
            three shots today, five on Thursday. Every one you land is a hit.
          </>
        }
        grace="Twenty is a project. Three is a Tuesday."
      />

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <p className="meta text-[var(--ink-3)] uppercase">Progress</p>
          <p className="meta text-[var(--ink-2)]">
            <span className="numeral text-[var(--ink)]">{SHOT_HIT}</span> of{' '}
            <span className="numeral">{SHOT_TOTAL}</span> posts
          </p>
        </div>

        {/* Discrete blocks, never a percentage bar — a bar invites arguing with
            it. The fill is a separate layer that scales in, so no colour is
            interpolated on the compositor. */}
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {Array.from({ length: SHOT_TOTAL }, (_, i) => {
            const fill =
              i < SHOT_HIT
                ? 'var(--hit)'
                : i < SHOT_HIT + SHOT_LINED
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
            <span className="numeral">{SHOT_HIT}</span> hit today
          </Swatch>
          <Swatch color="var(--line-strong)">
            <span className="numeral">{SHOT_LINED}</span> lined up Thursday
          </Swatch>
        </div>
      </section>
    </>
  );
}

function Swatch({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="meta inline-flex items-center gap-2 text-[var(--ink-2)]">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 rounded-[4px]"
        style={{ background: color }}
      />
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- 5 · huddles */

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
      <Slab hue={HUE_HALCYON} tone={moved ? 'quiet' : 'default'} onClick={() => setMoved(m => !m)}>
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
        eyebrow="The two of you"
        title="Call a huddle."
        body="Either of you can call one and it lands on both calendars — nothing to approve. Inside is one live board you're both moving things on."
      />

      <div className="mt-7">
        <LayoutGroup id="onboarding-huddle">
          <Lane label="On the table" count={moved ? 0 : 1} empty="Nothing left to settle.">
            {!moved && item}
          </Lane>
          <Lane label="Decided" count={moved ? 1 : 0} empty="Nothing decided yet.">
            {moved && item}
          </Lane>
        </LayoutGroup>

        <p className="meta mt-4 leading-snug text-[var(--ink-3)]">
          Wrapping it writes every decision back onto its bullet, so neither of you has to
          reopen the room.
        </p>
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
          <p className="editorial px-1 text-lg text-[var(--ink-3)]">{empty}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
