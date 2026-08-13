import { motion, useMotionValue, useTransform, useMotionValueEvent } from 'motion/react';
import { useState } from 'react';
import { Slab } from '../design/Slab';
import { ClientPill, SelectionMark, TensionBadge } from '../design/bits';
import { fling, zoom } from '../design/springs';
import { Icon } from '../design/icons';
import { completeShot, uncompleteShot } from '../data/mutations';
import { tensionOf } from '../data/selectors';
import type { ShotRow } from '../data/store';

const HIT_DISTANCE = 130;
const HIT_VELOCITY = 650;

/**
 * The signature card. Swipe right to hit; the accent floods in as you drag so
 * the gesture is self-explanatory the first time. Only transform and opacity
 * animate per frame, so this holds frame budget on a 120Hz phone.
 */
export function ShotCard({
  row,
  today,
  onZoom,
  onHit,
  index = 0,
  zoomId,
  selected,
  onToggle,
}: {
  row: ShotRow;
  today: string;
  onZoom?: (bulletId: string) => void;
  onHit?: (shotId: string) => void;
  index?: number;
  selected?: boolean;
  /** Omitted on Done rows, which are status rather than a control. */
  onToggle?: () => void;
  /**
   * The shared element this card claims, so it can physically become the zoom.
   * Defaults to the bullet's global id, which is what BulletZoom grows out of.
   *
   * A layoutId is a claim on ONE element. A bullet can hold two day shots on
   * the same day — hit one, then take another from the zoom — and two mounted
   * cards claiming `bullet-<id>` make motion's projection pick a lead at
   * random: tapping either one zooms out of the wrong card, and they fight
   * over the projection on every re-render. A list that can render the same
   * bullet twice passes an id of its own for the second card.
   */
  zoomId?: string;
}) {
  const { shot, bullet, client } = row;
  const done = shot.state === 'done';

  const x = useMotionValue(0);
  const [armed, setArmed] = useState(false);

  // Accent floods from the leading edge as the drag crosses the threshold.
  const floodScale = useTransform(x, [0, HIT_DISTANCE], [0, 1]);
  const floodOpacity = useTransform(x, [0, 40, HIT_DISTANCE], [0, 0.35, 1]);
  const titleShift = useTransform(x, [0, HIT_DISTANCE], [0, 6]);

  useMotionValueEvent(x, 'change', v => {
    const next = v > HIT_DISTANCE * 0.75;
    if (next !== armed) setArmed(next);
  });

  const tension = tensionOf(bullet, [shot], today);
  const partial = shot.amount !== undefined && bullet.count;

  return (
    <motion.div
      layout
      layoutId={zoomId ?? `bullet-${bullet.id}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      // `layout` must be given its own transition. Motion resolves a layout
      // animation from props.transition when there is no `.layout` sub-key, so
      // without this the entrance delay ALSO delays every reorder and the
      // card→zoom handoff by up to 250ms. ShelfView already documents this
      // exact trap; three sites missed it. zoom, not snap: springs.ts notes the
      // shared-element handoff reads as a glitch when it is too fast.
      transition={{ ...fling, delay: Math.min(index * 0.035, 0.25), layout: zoom }}
      drag={done ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.02, right: 0.7 }}
      dragDirectionLock
      style={{ x }}
      onDragEnd={(_, info) => {
        if (info.offset.x > HIT_DISTANCE || info.velocity.x > HIT_VELOCITY) {
          void completeShot(shot.id);
          onHit?.(shot.id);
        }
      }}
      className="touch-pan-y"
    >
      <Slab
        tone={done ? 'quiet' : 'default'}
        onClick={() => (done ? void uncompleteShot(shot.id) : onZoom?.(bullet.id))}
      >
        {/* Flood layer. Scales on the X axis only — no width animation. */}
        <motion.span
          aria-hidden
          className="absolute inset-0 origin-left"
          style={{
            scaleX: floodScale,
            opacity: floodOpacity,
            background: 'var(--hit-soft)',
          }}
        />

        {/* One grid, one text origin. The old pl-8 was applied twice with two
            different numbers and drifted 4px against the glyph. */}
        <motion.div
          className="relative grid grid-cols-[auto_1fr] gap-x-3.5 px-5 py-6"
          style={{ x: titleShift }}
        >
          <SelectionMark
            kind={bullet.kind}
            selected={selected}
            done={done}
            title={bullet.title}
            onToggle={onToggle}
          />
          <div className="min-w-0 pr-8">
            <h3
              className="display text-[1.6rem] leading-[1.15] text-balance text-[var(--ink)]"
              style={
                done
                  ? { color: 'var(--ink-3)', textDecoration: 'line-through' }
                  : undefined
              }
            >
              {bullet.title}
            </h3>

          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2">
            {client && <ClientPill hue={client.hue} name={client.name} />}
            {partial && (
              <span className="meta text-[var(--ink-2)]">
                <span className="numeral">{shot.amount}</span> of {bullet.count!.total}{' '}
                {bullet.count!.unit}
              </span>
            )}
            <TensionBadge level={tension.level} daysLeft={tension.daysLeft} />
          </div>
          </div>

          {/* Absolute, in a gutter the content reserves with pr-8. Inline, it
              reflowed the title at 75% of every drag. */}
          {armed && !done && (
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="absolute right-5 inline-flex"
              style={{ color: 'var(--hit)', top: 'calc(1.5rem + var(--mark-offset))' }}
            >
              <Icon name="check" size={22} />
            </motion.span>
          )}
        </motion.div>
      </Slab>
    </motion.div>
  );
}
