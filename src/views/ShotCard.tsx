import { motion, useMotionValue, useTransform, useMotionValueEvent } from 'motion/react';
import { useState } from 'react';
import { Slab } from '../design/Slab';
import { ClientDot, KindGlyph, TensionBadge } from '../design/bits';
import { fling } from '../design/springs';
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
}: {
  row: ShotRow;
  today: string;
  onZoom?: (bulletId: string) => void;
  onHit?: (shotId: string) => void;
  index?: number;
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
      layoutId={`bullet-${bullet.id}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ ...fling, delay: Math.min(index * 0.035, 0.25) }}
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
        hue={client?.hue}
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

        <motion.div className="relative px-6 py-7 pl-8" style={{ x: titleShift }}>
          <div className="flex items-start gap-3">
            <span className="mt-1.5 text-xl">
              <KindGlyph kind={bullet.kind} />
            </span>
            <h3
              className="display flex-1 text-[1.6rem] text-[var(--ink)]"
              style={
                done
                  ? { color: 'var(--ink-3)', textDecoration: 'line-through' }
                  : undefined
              }
            >
              {bullet.title}
            </h3>
            {armed && !done && (
              <motion.span
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="numeral mt-1 text-xl"
                style={{ color: 'var(--hit)' }}
              >
                ✓
              </motion.span>
            )}
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 pl-8">
            {client && <ClientDot hue={client.hue} name={client.name} />}
            {partial && (
              <span className="meta text-[var(--ink-2)]">
                <span className="numeral">{shot.amount}</span> of {bullet.count!.total}{' '}
                {bullet.count!.unit}
              </span>
            )}
            <TensionBadge level={tension.level} daysLeft={tension.daysLeft} />
          </div>
        </motion.div>
      </Slab>
    </motion.div>
  );
}
