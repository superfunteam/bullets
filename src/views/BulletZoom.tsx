import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { BigButton, ClientDot, HorizonChip, TensionBadge } from '../design/bits';
import { Slab } from '../design/Slab';
import { settle, snap, zoom } from '../design/springs';
import { useDismissDrag } from '../design/useDismissDrag';
import { progressOf, tensionOf } from '../data/selectors';
import { useBullet, useChildren, useClients, useShotsFor } from '../data/store';
import { callOff, createBullet, pullToDay, setHorizon, shelve } from '../data/mutations';
import { HORIZONS, type Horizon } from '../data/types';
import { relativeDay, today as todayFn } from '../lib/dates';

/**
 * Zoom, not navigation.
 *
 * The card physically becomes the detail view via a shared layoutId, so
 * "zooming in on a task" is literal rather than a screen change. Nesting is
 * arbitrary-depth but only ever one level is shown — you zoom in again.
 */
export function BulletZoom({
  bulletId,
  onClose,
  onZoom,
}: {
  bulletId: string;
  onClose: () => void;
  onZoom: (id: string) => void;
}) {
  const today = todayFn();
  const bullet = useBullet(bulletId);
  const shots = useShotsFor(bulletId);
  const children = useChildren(bulletId);
  const clients = useClients();
  const { controls, scrollRef, handleProps, contentProps } = useDismissDrag();
  const [adding, setAdding] = useState(false);
  const [childTitle, setChildTitle] = useState('');

  if (!bullet) return null;

  const client = clients.find((c) => c.id === bullet.clientId);
  const { done, total } = progressOf(bullet, shots);
  const tension = tensionOf(bullet, shots, today);
  const liveShots = shots.filter((s) => s.state !== 'done');

  const addChild = async () => {
    const t = childTitle.trim();
    if (!t) return;
    await createBullet({
      title: t,
      parentId: bulletId,
      clientId: bullet.clientId,
    });
    setChildTitle('');
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-[var(--bg)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        layoutId={`bullet-${bullet.id}`}
        transition={zoom}
        drag="y"
        // Controlled drag. Dragging and scrolling on the same element means the
        // drag captures the pointer and the content below the fold is
        // unreachable — see useDismissDrag.
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.45 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 600) onClose();
        }}
        className="flex h-full flex-col"
        style={{ paddingTop: 'var(--inset-top)' }}
      >
        {/* Fixed header, and the always-draggable grab area. */}
        <div className="shrink-0" {...handleProps}>
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="meta -ml-2 min-h-11 px-2 text-[var(--ink-2)] uppercase"
            >
              ← Zoom out
            </button>
            <TensionBadge level={tension.level} daysLeft={tension.daysLeft} />
          </div>
        </div>

        <div
          ref={scrollRef}
          className="hide-scrollbar min-h-0 flex-1 overflow-y-auto"
          {...contentProps}
        >
          <div className="mx-auto w-full max-w-2xl px-5 pb-32">
            <motion.h1 layout className="display text-[2.6rem] text-[var(--ink)]">
              {bullet.title}
            </motion.h1>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <HorizonChip horizon={bullet.horizon} active />
              {client && <ClientDot hue={client.hue} name={client.name} />}
              {bullet.deadline && (
                <span className="meta text-[var(--ink-2)]">
                  Target {relativeDay(bullet.deadline, today)}
                </span>
              )}
            </div>

            {/* Progress as discrete blocks. A percentage bar invites arguing with it. */}
            {bullet.count && (
              <section className="mt-8">
                <div className="flex items-baseline justify-between">
                  <p className="meta text-[var(--ink-3)] uppercase">Progress</p>
                  <p className="meta text-[var(--ink-2)]">
                    <span className="numeral text-[var(--ink)]">{done}</span> of {total}{' '}
                    {bullet.count.unit}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Array.from({ length: total }, (_, i) => (
                    <motion.span
                      key={i}
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ ...snap, delay: Math.min(i * 0.012, 0.3) }}
                      className="h-7 w-7 rounded-[8px]"
                      style={{
                        background: i < done ? 'var(--hit)' : 'var(--surface-2)',
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            {bullet.note && (
              <section className="mt-8">
                <p className="meta mb-2 text-[var(--ink-3)] uppercase">Notes</p>
                <Slab tone="quiet">
                  <p className="px-5 py-4 leading-relaxed whitespace-pre-wrap text-[var(--ink-2)]">
                    {bullet.note}
                  </p>
                </Slab>
              </section>
            )}

            {/* Sub-bullets. One level shown; tap to zoom further in. */}
            <section className="mt-8">
              <div className="flex items-center justify-between">
                <p className="meta text-[var(--ink-3)] uppercase">Inside this</p>
                <button
                  type="button"
                  onClick={() => setAdding((v) => !v)}
                  className="meta min-h-11 text-[var(--ink-2)] uppercase"
                >
                  {adding ? 'Done' : '+ Add'}
                </button>
              </div>

              <AnimatePresence initial={false}>
                {adding && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={settle}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 flex gap-2">
                      <input
                        value={childTitle}
                        onChange={(e) => setChildTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void addChild()}
                        placeholder="Another piece of this"
                        className="min-h-[var(--tap)] flex-1 rounded-[var(--r-md)]
                                 bg-[var(--surface-2)] px-4 text-[var(--ink)]
                                 placeholder:text-[var(--ink-3)]"
                      />
                      <button
                        type="button"
                        onClick={() => void addChild()}
                        className="min-h-[var(--tap)] rounded-[var(--r-md)] bg-[var(--ink)]
                                 px-5 text-[var(--bg)]"
                        style={{ fontVariationSettings: "'wght' 700" }}
                      >
                        Add
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {children.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {children.map((child) => (
                    <Slab key={child.id} tone="quiet" onClick={() => onZoom(child.id)}>
                      <div className="flex items-center gap-3 px-5 py-4">
                        <span
                          className="text-[var(--ink-3)]"
                          style={{
                            textDecoration: child.state === 'done' ? 'line-through' : undefined,
                          }}
                        >
                          •
                        </span>
                        <span
                          className="flex-1 text-[var(--ink)]"
                          style={{
                            fontVariationSettings: "'wght' 600",
                            color: child.state === 'done' ? 'var(--ink-3)' : undefined,
                            textDecoration: child.state === 'done' ? 'line-through' : undefined,
                          }}
                        >
                          {child.title}
                        </span>
                      </div>
                    </Slab>
                  ))}
                </div>
              ) : (
                !adding && (
                  <p className="meta mt-3 text-[var(--ink-3)]">
                    Nothing inside yet. Break it down if it's too big to take in one shot.
                  </p>
                )
              )}
            </section>

            {liveShots.length > 0 && (
              <section className="mt-8">
                <p className="meta mb-2 text-[var(--ink-3)] uppercase">Lined up</p>
                <div className="space-y-2">
                  {liveShots.map((s) => (
                    <div
                      key={s.id}
                      className="meta flex justify-between px-1 text-[var(--ink-2)]"
                    >
                      <span>
                        {s.scope === 'week' ? 'Week of ' : ''}
                        {relativeDay(s.date, today)}
                      </span>
                      {s.amount && <span className="numeral">{s.amount}</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-9">
              <p className="meta mb-2.5 text-[var(--ink-3)] uppercase">Move it</p>
              <div className="flex flex-wrap gap-2">
                {HORIZONS.map((h: Horizon) => (
                  <motion.button
                    key={h}
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    transition={snap}
                    onClick={() =>
                      void (h === 'shelf' ? shelve(bullet.id) : setHorizon(bullet.id, h))
                    }
                  >
                    <HorizonChip horizon={h} size="lg" active={bullet.horizon === h} />
                  </motion.button>
                ))}
              </div>
            </section>

            <div className="mt-8 space-y-3">
              {bullet.state === 'open' && (
                <BigButton onClick={() => void pullToDay(bullet.id, today)}>
                  Take a shot today
                </BigButton>
              )}
              <BigButton
                tone="quiet"
                onClick={() => {
                  void callOff(bullet.id);
                  onClose();
                }}
              >
                Call it off
              </BigButton>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
