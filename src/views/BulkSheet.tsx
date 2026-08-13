import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../design/Sheet';
import { BigButton } from '../design/bits';
import { db } from '../data/db';
import {
  completeBullet,
  completeShot,
  deleteBullet,
  moveToHorizon,
  pullToDay,
  pullToWeek,
  reopenBullet,
  uncompleteShot,
} from '../data/mutations';
import { useBullets, useShelf, useShotsOn, useWeekShots } from '../data/store';
import { today as todayFn, weekStart } from '../lib/dates';
import type { Bullet, Shot } from '../data/types';
import { useSelection } from './selection';

/**
 * Bulk actions for a ticked selection.
 *
 * Non-modal on purpose: it stands while you carry on ticking rows, so it is the
 * selection UI as well as the action list. That is why there is no separate
 * count bar and no "Actions" step — the sheet appearing IS the feedback that
 * something is selected, and its buttons are the verbs.
 *
 * The one rule the whole design rests on: **the box picks things, the swipe
 * finishes them.** Nothing here is reachable from the mark itself.
 */

type Undo = { label: string; run: () => Promise<void> };

export function BulkSheet({ onToast }: { onToast: (message: string, undo?: Undo) => void }) {
  const { surface, ids, clear } = useSelection();
  const today = todayFn();

  const dayRows = useShotsOn(today);
  const weekRows = useWeekShots(today);
  const shelf = useShelf();
  const allBullets = useBullets();

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pieces, setPieces] = useState<{ parents: number; children: number }>({
    parents: 0,
    children: 0,
  });

  const open = ids.size > 0;

  // Reset the two-step whenever the selection moves under it.
  useEffect(() => {
    setConfirmingDelete(false);
  }, [ids, surface]);

  /**
   * Resolve ticked ids against the LIVE rows every render. A peer sync can
   * delete a row out from under a selection, and a count or a delete list that
   * names something no longer there is worse than a stale number.
   */
  const picked = useMemo(() => {
    if (surface === 'shelf') {
      const bullets = shelf.filter(b => ids.has(b.id));
      return { shots: [] as Shot[], bullets };
    }
    const rows = surface === 'week' ? [...dayRows, ...weekRows] : dayRows;
    const shots = rows.filter(r => ids.has(r.shot.id)).map(r => r.shot);
    const byId = new Map(allBullets.map(b => [b.id, b]));
    const bullets = [...new Set(shots.map(s => s.bulletId))]
      .map(id => byId.get(id))
      .filter(Boolean) as Bullet[];
    return { shots, bullets };
  }, [surface, ids, dayRows, weekRows, shelf, allBullets]);

  const n = surface === 'shelf' ? picked.bullets.length : picked.shots.length;

  // Counted bullets cannot be finished from the Shelf without guessing how many
  // — see the skip rule below.
  const countedOnShelf = useMemo(
    () => (surface === 'shelf' ? picked.bullets.filter(b => b.count) : []),
    [surface, picked.bullets],
  );
  const doable = surface === 'shelf' ? picked.bullets.length - countedOnShelf.length : n;

  const hasCounted = picked.bullets.some(b => b.count);

  // Blast radius of a delete: children go too, and they are invisible here.
  useEffect(() => {
    let cancelled = false;
    if (!confirmingDelete || picked.bullets.length === 0) {
      setPieces({ parents: 0, children: 0 });
      return;
    }
    void (async () => {
      let parents = 0;
      let children = 0;
      for (const b of picked.bullets) {
        const kids = (await db.bullets.where('parentId').equals(b.id).toArray()).filter(
          k => !(k as unknown as Bullet).deletedAt,
        );
        if (kids.length) {
          parents += 1;
          children += kids.length;
        }
      }
      if (!cancelled) setPieces({ parents, children });
    })();
    return () => {
      cancelled = true;
    };
  }, [confirmingDelete, picked.bullets]);

  if (!open || !surface) return null;

  const num = (v: number) => <span className="numeral">{v}</span>;

  /* ----------------------------------------------------------------- actions */

  const markDone = async () => {
    if (surface === 'shelf') {
      // Snapshot which children were open: reopenBullet on a Parent leaves its
      // children done, so without this the undo is silently lossy.
      const targets = picked.bullets.filter(b => !b.count);
      const snapshot = await Promise.all(
        targets.map(async b => ({
          id: b.id,
          openChildren: (await db.bullets.where('parentId').equals(b.id).toArray())
            .filter(k => {
              const kid = k as unknown as Bullet;
              return !kid.deletedAt && kid.state === 'open';
            })
            .map(k => (k as unknown as Bullet).id),
        })),
      );
      for (const b of targets) await completeBullet(b.id);
      clear();
      onToast(`Marked ${targets.length} done`, {
        label: 'UNDO',
        run: async () => {
          for (const s of [...snapshot].reverse()) {
            await reopenBullet(s.id);
            for (const kid of s.openChildren) await reopenBullet(kid);
          }
        },
      });
      return;
    }

    // Per shot, byte-identical to swiping that row right. Two gestures on one
    // row must not produce two different states.
    const shots = picked.shots.map(s => s.id);
    for (const id of shots) await completeShot(id);
    clear();
    onToast(`Marked ${shots.length} done`, {
      label: 'UNDO',
      run: async () => {
        for (const id of [...shots].reverse()) await uncompleteShot(id);
      },
    });
  };

  /**
   * Unschedule is moveToHorizon(…, 'soon'), NOT unpull.
   *
   * A bare unpull deletes the shot and leaves an open bullet sitting on horizon
   * `now` with nothing committed — and rollForwardNow() re-creates a day shot
   * for exactly that shape on the next launch. You would unschedule five things
   * and find them all back tomorrow morning. moveToHorizon clears every OPEN
   * shot and never a completed one, so the record of finished work survives.
   */
  const unschedule = async () => {
    const snapshot = picked.bullets.map(b => ({
      id: b.id,
      shots: picked.shots
        .filter(s => s.bulletId === b.id && s.state === 'open')
        .map(s => ({ scope: s.scope, date: s.date, amount: s.amount })),
    }));
    for (const b of picked.bullets) await moveToHorizon(b.id, 'soon');
    clear();
    onToast(`Unscheduled ${snapshot.length}`, {
      label: 'UNDO',
      run: async () => {
        for (const s of snapshot) {
          // Week first, then day: replaying in that order lands the horizon
          // back on its original value as a side effect, so nothing has to
          // write `horizon` directly (setHorizon is forbidden to callers).
          for (const sh of s.shots.filter(x => x.scope === 'week')) {
            await pullToWeek(s.id, weekStart(sh.date), sh.amount);
          }
          for (const sh of s.shots.filter(x => x.scope === 'day')) {
            await pullToDay(s.id, sh.date, sh.amount);
          }
        }
      },
    });
  };

  // Distinct bulletIds: one bullet can hold two rows on one day, and
  // deleteBullet must not run against an already-tombstoned row.
  const doDelete = async () => {
    const targets = picked.bullets.map(b => b.id);
    for (const id of targets) await deleteBullet(id);
    clear();
    // No UNDO: deleteBullet soft-deletes with a cascade and there is no restore
    // mutation, so an UNDO that cannot fire would be a worse lie than none.
    onToast(`Deleted ${targets.length}`);
  };

  /* ------------------------------------------------------------------- view */

  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

  return (
    <Sheet open={open} onClose={clear} title={`${n} selected`} showScrim={false}>
      <div className="space-y-3 px-5 pt-2">
        {confirmingDelete ? (
          <>
            <p className="meta px-1 text-[var(--ink-2)]">
              {picked.bullets.length === 1 ? 'Deleting this one:' : <>Deleting these {num(picked.bullets.length)}:</>}
            </p>
            {/* The list IS the safeguard, and it scrolls rather than truncates
                so it scales with the size of the mistake. */}
            <ul className="mt-2 space-y-1">
              {picked.bullets.map(b => (
                <li key={b.id} className="display text-lg text-[var(--ink)]">
                  {b.title}
                </li>
              ))}
            </ul>
            {pieces.parents > 0 && (
              <p className="meta mt-3 px-1 text-[var(--ink-2)]">
                {num(pieces.parents)} of these {plural(pieces.parents, 'has', 'have')}{' '}
                {num(pieces.children)} {plural(pieces.children, 'piece', 'pieces')} inside{' '}
                {plural(pieces.parents, 'it', 'them')}.{' '}
                {plural(pieces.children, 'That goes', 'Those go')} too.
              </p>
            )}
            <p className="meta mt-2 px-1 text-[var(--ink-3)]">There's no undo.</p>
            {/* Confirm sits in the RIGHT cell, never under the finger that just
                tapped a full-width row. Position is the double-tap guard. */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <BigButton tone="quiet" onClick={() => setConfirmingDelete(false)}>
                {plural(picked.bullets.length, 'Keep it', 'Keep them')}
              </BigButton>
              <BigButton tone="wide" onClick={() => void doDelete()}>
                Delete {picked.bullets.length}
              </BigButton>
            </div>
          </>
        ) : (
          <>
            {doable > 0 && (
              <div>
                <BigButton tone="hit" onClick={() => void markDone()}>
                  Mark {doable} done
                </BigButton>
                {surface !== 'shelf' && hasCounted && (
                  <p className="meta mt-2 px-1 text-[var(--ink-3)]">
                    Counted bullets finish only the share this day claimed.
                  </p>
                )}
                {surface === 'shelf' && countedOnShelf.length > 0 && (
                  <p className="meta mt-2 px-1 text-[var(--ink-3)]">
                    {num(countedOnShelf.length)}{' '}
                    {plural(countedOnShelf.length, 'counted bullet stays', 'counted bullets stay')}{' '}
                    put — open {plural(countedOnShelf.length, 'it', 'them')} to say how many.
                  </p>
                )}
              </div>
            )}

            {surface !== 'shelf' && (
              <div>
                <BigButton tone="quiet" onClick={() => void unschedule()}>
                  Unschedule {picked.bullets.length}
                </BigButton>
                <p className="meta mt-2 px-1 text-[var(--ink-3)]">
                  Comes off the days it's on. Goes back to SOON.
                </p>
              </div>
            )}

            <BigButton tone="wide" onClick={() => setConfirmingDelete(true)}>
              Delete {picked.bullets.length}
            </BigButton>

            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={clear}
                className="meta min-h-11 px-4 text-[var(--ink-2)] uppercase"
              >
                Clear
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
