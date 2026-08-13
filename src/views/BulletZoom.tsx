import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { BigButton, ClientPill, HorizonChip, TensionBadge } from '../design/bits';
import { Slab } from '../design/Slab';
import { settle, snap, zoom } from '../design/springs';
import { useDismissDrag } from '../design/useDismissDrag';
import { Icon } from '../design/icons';
import { progressOf, tensionOf, unclaimedOf } from '../data/selectors';
import { useBullet, useChildren, useClients, useShotsFor } from '../data/store';
import {
  completeBullet,
  createBullet,
  deleteBullet,
  pullToDay,
  reopenBullet,
  setCompletedCount,
  moveToHorizon,
  unpull,
} from '../data/mutations';
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [childTitle, setChildTitle] = useState('');

  if (!bullet) return null;

  const client = clients.find((c) => c.id === bullet.clientId);
  const { done, total } = progressOf(bullet, shots);
  const tension = tensionOf(bullet, shots, today);
  const liveShots = shots.filter((s) => s.state !== 'done');
  // Already on today? Then offer to finish or remove it, never to add it again.
  const onToday = shots.find(s => s.scope === 'day' && s.date === today && s.state === 'open');

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
              className="meta -ml-2 flex min-h-11 items-center gap-0.5 px-2 text-[var(--ink-2)] uppercase"
            >
              <Icon name="chevron_left" size={18} />
              Back
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
              {client && <ClientPill hue={client.hue} name={client.name} />}
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
                {/* Each dot is a control, not decoration: tap the 7th and 7 are
                    done, tap the last filled one to take it back. Dots are the
                    natural place to reach for, and making them inert pushed
                    every count change through the Pull. */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Array.from({ length: total }, (_, i) => {
                    const filled = i < done;
                    return (
                      <motion.button
                        key={i}
                        type="button"
                        aria-label={`Mark ${i + 1} of ${total} ${bullet.count!.unit} done`}
                        aria-pressed={filled}
                        onClick={() =>
                          void setCompletedCount(bullet.id, done === i + 1 ? i : i + 1)
                        }
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        whileTap={{ scale: 0.82 }}
                        transition={{ ...snap, delay: Math.min(i * 0.012, 0.3) }}
                        className="h-9 w-9 rounded-[10px]"
                        style={{ background: filled ? 'var(--hit)' : 'var(--surface-2)' }}
                      />
                    );
                  })}
                </div>
                <p className="meta mt-2 text-[var(--ink-3)]">
                  Tap a square to set how many are done.
                </p>
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
                    <Slab key={child.id} tone="quiet">
                      <div className="flex items-center gap-1 py-1 pr-3 pl-2">
                        {/* Checking a piece off has to be its own target. Tapping
                            the row still zooms in, so the two cannot share one. */}
                        <button
                          type="button"
                          aria-label={
                            child.state === 'done'
                              ? `Mark ${child.title} not done`
                              : `Mark ${child.title} done`
                          }
                          onClick={() =>
                            void (child.state === 'done'
                              ? reopenBullet(child.id)
                              : completeBullet(child.id))
                          }
                          className="flex h-[var(--tap)] w-[var(--tap)] shrink-0
                                     items-center justify-center"
                        >
                          <motion.span
                            whileTap={{ scale: 0.85 }}
                            transition={snap}
                            className="flex h-7 w-7 items-center justify-center rounded-full border-2"
                            style={{
                              borderColor:
                                child.state === 'done' ? 'var(--hit)' : 'var(--line-strong)',
                              background: child.state === 'done' ? 'var(--hit)' : 'transparent',
                            }}
                          >
                            {child.state === 'done' && (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                                <path
                                  d="M5 12.5l4.5 4.5L19 7.5"
                                  stroke="white"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </motion.span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onZoom(child.id)}
                          className="flex flex-1 items-center gap-3 py-3 text-left"
                        >
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
                        </button>
                      </div>
                    </Slab>
                  ))}
                </div>
              ) : (
                !adding && (
                  <p className="meta mt-3 text-[var(--ink-3)]">
                    Nothing inside yet. Break it into pieces if it's too big to do in one go.
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
                    // moveToHorizon, never setHorizon: a committing horizon
                    // with no shot leaves the bullet in no view at all.
                    onClick={() => void moveToHorizon(bullet.id, h)}
                  >
                    <HorizonChip horizon={h} size="lg" active={bullet.horizon === h} />
                  </motion.button>
                ))}
              </div>
            </section>

            {/*
              Plain verbs on purpose.
              "Shot", "target" and "the Pull" are nouns you learn once. A button
              is different: if you have to pause and work out whether it deletes
              your work, the wording has failed. So the flavour lives in what
              things are called, and the actions say exactly what they do.
            */}
            <div className="mt-9 space-y-3">
              {bullet.state === 'done' ? (
                <BigButton tone="quiet" onClick={() => void reopenBullet(bullet.id)}>
                  Reopen
                </BigButton>
              ) : (
                <>
                  {/* A counted bullet has two plausible meanings for "done" and
                      guessing wrong silently finishes twenty posts, so ask. */}
                  {bullet.count && done < total ? (
                    <div className="space-y-2.5">
                      <BigButton
                        tone="hit"
                        onClick={() => {
                          void setCompletedCount(bullet.id, done + 1);
                        }}
                      >
                        Did 1 more {singular(bullet.count.unit)}
                      </BigButton>
                      <BigButton
                        tone="quiet"
                        onClick={() => {
                          void completeBullet(bullet.id);
                          onClose();
                        }}
                      >
                        Finish all {total - done} remaining
                      </BigButton>
                    </div>
                  ) : (
                    <BigButton
                      tone="hit"
                      onClick={() => {
                        void completeBullet(bullet.id);
                        onClose();
                      }}
                    >
                      {children.length > 0 ? 'Mark the whole thing done' : 'Mark done'}
                    </BigButton>
                  )}

                  {onToday ? (
                    <BigButton
                      tone="quiet"
                      onClick={() => {
                        void unpull(onToday.id);
                        // Otherwise it still claims NOW with nothing on the
                        // calendar, which is the strand-it-nowhere state again.
                        void moveToHorizon(bullet.id, 'soon');
                      }}
                    >
                      Take off today
                    </BigButton>
                  ) : (
                    <BigButton
                      tone="quiet"
                      onClick={() =>
                        void pullToDay(
                          bullet.id,
                          today,
                          // A counted bullet with no amount scores as 1, so
                          // "do today" on 20 posts used to claim a single post
                          // and look identical to claiming the lot.
                          bullet.count ? Math.max(1, unclaimedOf(bullet, shots, 'day')) : undefined,
                        )
                      }
                      disabled={Boolean(bullet.count) && unclaimedOf(bullet, shots, 'day') <= 0}
                    >
                      Do today
                    </BigButton>
                  )}
                </>
              )}

              {confirmDelete ? (
                <div className="rounded-[var(--r-md)] border border-[var(--wide)] p-3">
                  <p className="meta mb-3 px-1 text-[var(--ink-2)]">
                    Delete this bullet{children.length > 0
                      ? ` and its ${children.length} piece${children.length === 1 ? '' : 's'}`
                      : ''}
                    ? This can't be undone from here.
                  </p>
                  <div className="flex gap-2.5">
                    <BigButton tone="quiet" onClick={() => setConfirmDelete(false)}>
                      Keep it
                    </BigButton>
                    <BigButton
                      tone="wide"
                      onClick={() => {
                        void deleteBullet(bullet.id);
                        onClose();
                      }}
                    >
                      Delete
                    </BigButton>
                  </div>
                </div>
              ) : (
                <BigButton tone="quiet" onClick={() => setConfirmDelete(true)}>
                  Delete
                </BigButton>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** "posts" -> "post". Good enough for the units two people actually type. */
function singular(unit: string): string {
  if (unit.endsWith('ies')) return `${unit.slice(0, -3)}y`;
  if (unit.endsWith('ses') || unit.endsWith('xes')) return unit.slice(0, -2);
  return unit.endsWith('s') ? unit.slice(0, -1) : unit;
}
