import { db, TABLES, ENTITY_TABLES } from './db';
import { applyOp, isAbsurdTs, type Materialized, type Op } from './ops';
import { enqueue } from './outbox';
import { recordOps } from './historyLog';
import { newId } from '../lib/id';
import { keyAtEnd } from '../lib/sortKey';
import { toDay, today, weekStart } from '../lib/dates';
import type {
  Bullet,
  Client,
  EntityKind,
  Horizon,
  Huddle,
  HuddleItem,
  HuddleResponse,
  Person,
  Shot,
} from './types';
import { normalizeHorizon, otherPerson, RESPONSE_FIELD } from './types';

/**
 * THE ONLY MODULE THAT WRITES.
 *
 * If a view writes to Dexie directly it skips the op log, and the two devices
 * silently diverge with no error anywhere. Funnelling every write through
 * mutate() makes that class of bug structurally impossible, so keep it that way.
 */

let actor: Person = 'clark';
export const setActor = (p: Person) => {
  actor = p;
};
export const getActor = (): Person => actor;

type Listener = () => void;
const listeners = new Set<Listener>();
export const onChange = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const notify = () => listeners.forEach(fn => fn());

let lastTs = 0;
let clockSeeded = false;

/**
 * Reseed the hybrid clock from what this device has already observed.
 *
 * The HLC absorbs every timestamp it sees so a later tap always beats an
 * earlier write — but `lastTs` lived only in memory, and the app restarts
 * several times a day. After any skew entered the space (a peer's fast clock,
 * an NTP hiccup), every post-restart tap on an affected field was stamped
 * plain Date.now(), lost the LWW comparison, didn't render locally, and was
 * discarded identically on the server echo and the peer — mark done, tap,
 * nothing happens, for the whole width of the skew. The HLC's own docstring
 * claims this exact failure is fixed; without reseeding it only stayed fixed
 * until the next launch.
 *
 * History records every op applied here in the same transaction as its entity
 * write, so its max ts IS the largest timestamp this device has ever seen.
 * Seeding only raises the clock to an already-observed value, so it can never
 * flip a past LWW outcome.
 */
/** Tests only: forget the clock, as a real app restart does. */
export function __resetClockForTests(): void {
  lastTs = 0;
  clockSeeded = false;
}

export async function initClock(): Promise<void> {
  if (clockSeeded) return;
  clockSeeded = true;
  // Sequential Dexie awaits, never Promise.all: this can run inside a joined
  // transaction, and awaiting a NATIVE promise there lets the IndexedDB
  // transaction auto-commit under the rest of the action.
  const lastHistory = await db.history.orderBy('ts').last();
  const lastOutbox = await db.outbox.orderBy('ts').last();
  observeTs(Number(lastHistory?.ts ?? 0));
  observeTs(Number((lastOutbox as unknown as Op | undefined)?.ts ?? 0));
}

/**
 * Hybrid logical clock.
 *
 * Two separate problems, one mechanism:
 *
 * 1. Date.now() has millisecond resolution, so two local writes in the same
 *    tick collide and fall through to the random opId tie-break — half the
 *    time the *earlier* write wins and the user's tap silently doesn't stick.
 *
 * 2. More seriously, the two phones' clocks drift. If we only ever counted our
 *    own writes, a peer op stamped from a slightly fast clock would poison that
 *    field: every later local edit would carry a smaller ts, lose the
 *    comparison in applyOp, and be discarded — on our own screen and theirs.
 *    Clark would tap Undecide on the huddle board and simply watch nothing
 *    happen until his wall clock caught up with Angie's.
 *
 * Absorbing every timestamp we observe, local or remote, makes the next local
 * write strictly greater than anything this device has ever seen, so a later
 * action always wins over an earlier one regardless of whose clock is fast.
 */
function nextTs(): number {
  const now = Date.now();
  lastTs = now > lastTs ? now : lastTs + 1;
  // Belt and braces: even a poisoned lastTs cannot make us emit a stamp
  // nobody can ever beat.
  if (isAbsurdTs(lastTs)) lastTs = now;
  return lastTs;
}

/**
 * Advance the clock past a timestamp observed from anywhere — unless it is
 * absurd.
 *
 * This is how the poison spread: one device absorbed a year-2286 stamp, and
 * from then on `nextTs` returned lastTs+1 forever, so EVERY write that device
 * made was dated 2286 and outranked every honest write on both phones. 58 ops
 * in production carry those stamps. A clock that trusts anything can be
 * hijacked by one bad row.
 */
function observeTs(ts: number): void {
  if (isAbsurdTs(ts)) return;
  if (ts > lastTs) lastTs = ts;
}


/**
 * Which user action the next ops belong to.
 *
 * The op log is FIELD level: one tap of "Mark done" on a counted parent writes
 * a dozen ops across several entities. A history built by inferring groups from
 * timestamps guesses; this states it.
 *
 * The key rides INSIDE opId as `${actionId}:${n}`. Postgres declares op_id as
 * opaque text and round-trips it verbatim, so this needs no migration, no wire
 * change, and no deploy ordering across three independently-updating clients.
 *
 * The counter lives on the ACTION, never on the mutate() call: an action spans
 * several mutate() calls, so a per-call counter would emit `${id}:0` twice and
 * the server's `on conflict (op_id) do nothing` would silently swallow one
 * field write. That is data loss, not a grouping bug.
 */
type ActionCtx = { id: string; n: number; auto: boolean };
let currentAction: ActionCtx | null = null;

async function runIn<T>(id: string, auto: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = currentAction;
  currentAction = { id, n: 0, auto };
  try {
    return await fn();
  } finally {
    currentAction = prev;
  }
}

/**
 * Wrap a user-facing action. Joins an ambient user action so a bulk loop reads
 * as one entry; never joins a machine one.
 */
export function runAction<T>(fn: () => Promise<T>): Promise<T> {
  if (currentAction && !currentAction.auto) return fn();
  return runIn(newId(), false, fn);
}

/** Wrap a machine write. Never joins; renders as the app, naming no person. */
export function runAuto<T>(fn: () => Promise<T>): Promise<T> {
  return runIn(`auto-${newId()}`, true, fn);
}

/** Allocate the next opId in the current action, minting one if unwrapped. */
function nextOpId(): string {
  if (!currentAction) {
    // A mutation nobody remembered to wrap still groups correctly rather than
    // falling into the legacy path forever.
    currentAction = { id: newId(), n: 0, auto: false };
  }
  return `${currentAction.id}:${currentAction.n++}`;
}





/** Build ops from a patch, apply them locally, queue them for sync. */
export async function mutate(
  entity: EntityKind,
  entityId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  /**
   * Drop writes that change nothing.
   *
   * A real bullet in production carries nineteen consecutive identical
   * `state: "done"` ops, from the era when an explicit completion and a
   * speculative recompute fought each other. Each round trip cost an op, a
   * sync, and a re-render. The cause is fixed, but a value that already equals
   * what is stored is never worth a write.
   */
  const current = (await TABLES[entity]?.().get(entityId)) as Record<string, unknown> | undefined;
  const changed = Object.entries(patch).filter(
    ([field, value]) =>
      current === undefined || JSON.stringify(current[field]) !== JSON.stringify(value),
  );
  if (!changed.length) return;

  // Race backstop: if a mutation beats the boot-time initClock, seed here.
  if (!clockSeeded) await initClock();

  const ts = nextTs();
  const ops: Op[] = changed.map(([field, value]) => ({
    opId: nextOpId(),
    entity,
    entityId,
    field,
    value,
    ts,
    actor,
  }));
  /**
   * Apply and queue in ONE transaction, or neither happens.
   *
   * These used to be two commits: applyLocal opened a transaction over the
   * entity tables, then enqueue wrote the outbox in a separate one. Kill the
   * app in between — a swipe-away, a low-memory kill on Android, a tab close —
   * and the change is materialised locally with no op queued for the server. It
   * looks saved, it survives a reload, and it never reaches the other device or
   * the server log. Nothing anywhere reports it, because from the app's point
   * of view there is nothing outstanding.
   *
   * Dexie joins a nested transaction to its parent when the tables are a subset
   * and the mode is compatible, so applyLocal's own transaction becomes part of
   * this one rather than a second commit.
   */
  await db.transaction('rw', [...ENTITY_TABLES, db.history, db.outbox], async () => {
    await applyLocal(ops);
    await enqueue(ops);
  });
  notify();
}

/** Fold ops into local tables. Used by mutate() and by the sync client. */
export async function applyLocal(ops: Op[]): Promise<void> {
  const byEntity = new Map<string, Op[]>();
  for (const op of ops) {
    // Absorb peer timestamps so our next local write can still beat theirs.
    observeTs(op.ts);
    const key = `${op.entity} ${op.entityId}`;
    const group = byEntity.get(key);
    if (group) group.push(op);
    else byEntity.set(key, [op]);
  }

  // history joins the SAME transaction as the entity write. A trail that can
  // commit apart from the change it describes is a trail you cannot trust.
  await db.transaction('rw', [...ENTITY_TABLES, db.history], async () => {
    for (const [key, group] of byEntity) {
      const [entity, id] = key.split(' ') as [EntityKind, string];
      const table = TABLES[entity]?.();
      // An unknown entity kind means a newer client version wrote something
      // this build doesn't model yet. Skip it rather than throwing — the op
      // stays in the log and will materialize after an update.
      if (!table) continue;
      let rec = await table.get(id);
      for (const op of group) rec = applyOp(rec, op);
      if (rec) await table.put(rec as Materialized);
    }
    // Tail, not head: subject resolution reads post-fold rows, so a shot
    // created in this batch already knows its bulletId.
    await recordOps(ops);
  });
  notify();
}

// ---------------------------------------------------------------- clients

export async function createClient(name: string, hue: number): Promise<string> {
  const id = newId();
  await mutate('client', id, { name, hue });
  return id;
}

export const renameClient = (id: string, name: string) => mutate('client', id, { name });
export const recolorClient = (id: string, hue: number) => mutate('client', id, { hue });
export const archiveClient = (id: string) => mutate('client', id, { archived: true });

// ---------------------------------------------------------------- bullets

export function createBullet(
  init: Partial<Bullet> & { title: string },
): Promise<string> {
  return runAction(() => createBulletCore(init));
}

async function createBulletCore(
  init: Partial<Bullet> & { title: string },
): Promise<string> {
  const id = init.id ?? newId();
  const horizon = init.horizon ?? 'shelf';

  /**
   * The SHOT commits FIRST, the bullet last — crash-safe ordering in place of
   * an atomicity Dexie cannot give across these writes (a joined transaction
   * dies under the live-query cache middleware).
   *
   * Kill the app between the two commits and what survives is an orphan shot:
   * invisible (row building drops shots whose bullet is missing), inert, and
   * harmless. The OLD order left the opposite — a committed NEXT bullet with
   * no shot, which renders on no list at all until a Weekly Pull happens to
   * offer it. A task that saved and then hid is the worst failure a capture
   * can have; a task that visibly did not save is retried on the spot.
   */
  if (!init.parentId) {
    const day = today();
    if (horizon === 'now') await createShot(id, 'day', day);
    else if (horizon === 'next') await createShot(id, 'week', weekStart(day));
  }

  const last = await db.bullets.orderBy('sortKey').last();
  await mutate('bullet', id, {
    title: init.title,
    horizon,
    kind: init.kind ?? 'task',
    state: 'open',
    sortKey: init.sortKey ?? keyAtEnd((last as unknown as Bullet)?.sortKey ?? null),
    ...(init.clientId ? { clientId: init.clientId } : {}),
    ...(init.parentId ? { parentId: init.parentId } : {}),
    ...(init.deadline ? { deadline: init.deadline } : {}),
    ...(init.count ? { count: init.count } : {}),
    ...(init.note ? { note: init.note } : {}),
  });

  if (init.parentId) {
    // Adding a piece to a finished parent is a change to the child SET, which
    // is just as much a transition as a child changing state. Without this the
    // parent stays done, and the new open piece is reachable from nowhere —
    // the same "saved, syncing, unreachable" hole one level down.
    const parent = (await db.bullets.get(init.parentId)) as unknown as Bullet | undefined;
    if (parent && parent.state === 'done') await reopenBullet(parent.id);
  }

  return id;
}

export const setTitle = (id: string, title: string) => mutate('bullet', id, { title });
export const setNote = (id: string, note: string) => mutate('bullet', id, { note });
export const setHorizon = (id: string, horizon: Horizon) => mutate('bullet', id, { horizon });
export const setDeadline = (id: string, deadline?: string) =>
  mutate('bullet', id, { deadline: deadline ?? null });
export const setBulletClient = (id: string, clientId?: string) =>
  mutate('bullet', id, { clientId: clientId ?? null });
export const setCount = (id: string, count?: { total: number; unit: string }) =>
  mutate('bullet', id, { count: count ?? null });

export function setCompletedCount(bulletId: string, target: number): Promise<void> {
  // One tap is one entry in the history.
  return runAction(() => setCompletedCountCore(bulletId, target));
}

/**
 * Set exactly how much of a counted bullet is finished.
 *
 * Backs the progress dots and "Did 1 more part". Progress is derived from
 * completed shot amounts, so this reconciles the shots to match.
 *
 * THE RULES THIS IS BUILT ON, learned by shipping their violations twice:
 *
 * 1. Progress derives ONLY from done rows, and done rows are PER-WRITER —
 *    created, reduced, or emptied, never merged into and never folded together.
 *    Field-level LWW cannot additively merge a counter: any "combine two rows"
 *    move is two causally-untied writes, and a concurrent write to either row
 *    silently erases recorded work (verified: 6 recorded parts converging to 3).
 * 2. Open-claim arithmetic is bookkeeping, not truth. Reducing another row's
 *    claim can race a peer's reduction and lose one intent — bounded, visible,
 *    and self-correcting at the next reconcile. Losing a DONE amount is not.
 * 3. "One card per day" is a RENDER rule, not a data rule. The store groups
 *    day rows per (bullet, date, state); the data layer may legitimately hold
 *    several per-writer rows. Enforcing it in data is what required the folds.
 * 4. Emptying a row writes { amount: 0, deletedAt } in ONE patch — two patches
 *    leave a live "0 of N" card when the app is killed between commits.
 */
async function setCompletedCountCore(bulletId: string, target: number): Promise<void> {
  const bullet = (await db.bullets.get(bulletId)) as unknown as Bullet | undefined;
  if (!bullet?.count) return;

  const total = bullet.count.total;
  const want = Math.max(0, Math.min(total, Math.round(target)));
  const day = today();
  const amountOf = (s: Shot) => s.amount ?? 1;

  await materializeClaims(bulletId, total);

  const doneNow = async () =>
    (await liveShotsFor(bulletId))
      .filter(s => s.state === 'done')
      .reduce((n, s) => n + amountOf(s), 0);

  const done = await doneNow();
  if (done === want) return;

  if (want > done) {
    const delta = want - done;

    /**
     * Consume open DAY claims oldest-first. The week is a separate ledger the
     * day draws OUT of (see unclaimedOf), so the same delta also comes off the
     * open WEEK claims — consuming only one side double-counts the work and a
     * 10-part bullet ends up logging 14.
     */
    let toConsume = delta;
    for (const s of (await liveShotsFor(bulletId))
      .filter(x => x.scope === 'day' && x.state === 'open')
      .sort((a, b) => (a.date < b.date ? -1 : 1))) {
      if (toConsume <= 0) break;
      const claim = amountOf(s);
      if (claim <= toConsume) {
        await mutate('shot', s.id, { amount: 0, deletedAt: Date.now() });
        toConsume -= claim;
      } else {
        await mutate('shot', s.id, { amount: claim - toConsume });
        toConsume = 0;
      }
    }

    let weekDraw = delta;
    for (const s of (await liveShotsFor(bulletId))
      .filter(x => x.scope === 'week' && x.state === 'open')
      .sort((a, b) => (a.date < b.date ? -1 : 1))) {
      if (weekDraw <= 0) break;
      const claim = amountOf(s);
      if (claim <= weekDraw) {
        await mutate('shot', s.id, { amount: 0, deletedAt: Date.now() });
        weekDraw -= claim;
      } else {
        await mutate('shot', s.id, { amount: claim - weekDraw });
        weekDraw = 0;
      }
    }

    // A NEW done row, never a merge into one — rule 1. Two phones tapping dots
    // at once each keep their own recorded work; the render groups the cards.
    const rec = await createShot(bulletId, 'day', day, delta);
    await mutate('shot', rec, { state: 'done' });
  } else {
    /**
     * Take back newest-first. Reducing a done row's amount is the sanctioned
     * way to un-record work; a row at zero records nothing and is emptied in
     * the same patch (rule 4).
     */
    let toReturn = done - want;
    for (const s of (await liveShotsFor(bulletId))
      .filter(x => x.state === 'done')
      .sort((a, b) => (a.date > b.date ? -1 : 1))) {
      if (toReturn <= 0) break;
      const has = amountOf(s);
      if (has <= toReturn) {
        await mutate('shot', s.id, { amount: 0, deletedAt: Date.now() });
        toReturn -= has;
      } else {
        await mutate('shot', s.id, { amount: has - toReturn });
        toReturn = 0;
      }
    }
    // The claim returns to today's plan as its own row (rule 1 again).
    await createShot(bulletId, 'day', day, done - want);
  }

  // Let the shape rule decide the bullet's state, so the two never disagree.
  const finished = await doneNow();
  if (finished >= total && bullet.state !== 'done') await completeBullet(bulletId);
  else if (finished < total && bullet.state === 'done') await reopenBullet(bulletId);
}

/**
 * Materialize "the whole thing". A "Do today" with no stepper creates an open
 * day shot with amount undefined, and every derivation counts that as 1 — so
 * finishing one part consumed the entire claim and the card left Today showing
 * 1 of 5 done with 4 silently unscheduled. Undefined on a counted bullet means
 * the remainder, so write the remainder down before arithmetic starts.
 */
async function materializeClaims(bulletId: string, total: number): Promise<void> {
  const live = await liveShotsFor(bulletId);
  const doneSum = live
    .filter(s => s.state === 'done')
    .reduce((n, s) => n + (s.amount ?? 1), 0);
  let available = Math.max(0, total - doneSum);
  const defined = live.filter(s => s.state === 'open' && s.amount !== undefined);
  available -= Math.min(available, defined.reduce((n, s) => n + s.amount!, 0));
  for (const s of live
    .filter(x => x.scope === 'day' && x.state === 'open' && x.amount === undefined)
    .sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const claim = Math.max(1, available);
    await mutate('shot', s.id, { amount: claim });
    available = Math.max(0, available - claim);
  }
}

/** Live, undeleted children of a bullet. */
async function childrenOf(id: string): Promise<Bullet[]> {
  const rows = await db.bullets.where('parentId').equals(id).toArray();
  return rows.filter(r => !r.deletedAt) as unknown as Bullet[];
}

/** Which of the three shapes is this? See docs/state-model.md. */
async function shapeOf(bullet: Bullet): Promise<'simple' | 'counted' | 'parent'> {
  if ((await childrenOf(bullet.id)).length > 0) return 'parent';
  return bullet.count ? 'counted' : 'simple';
}

/**
 * Mark a bullet done.
 *
 * The rule that makes this predictable: **an explicit "done" makes the
 * derivation true rather than overriding it.** The old version set a flag while
 * a separate rule derived the same field from the children — so marking a
 * parent done with five open children set the flag, the derivation ran, and it
 * flipped straight back to open. The bullet appeared to vanish and return.
 *
 * So: completing a Parent completes its pieces; completing a Counted bullet
 * finishes the remainder. Afterwards the derived answer and the stored answer
 * agree, and nothing can undo it behind your back.
 */
export function completeBullet(id: string, depth = 0): Promise<void> {
  // Depth > 0 means we are already inside a wrapped ancestor's transaction.
  if (depth > 0) return completeBulletCore(id, depth);
  return runAction(() => completeBulletCore(id, depth));
}

async function completeBulletCore(id: string, depth = 0): Promise<void> {
  if (depth > 12) return;
  const bullet = (await db.bullets.get(id)) as unknown as Bullet | undefined;
  if (!bullet || bullet.deletedAt) return;

  const shape = await shapeOf(bullet);

  if (shape === 'parent') {
    for (const child of await childrenOf(id)) {
      if (child.state === 'open') await completeBulletCore(child.id, depth + 1);
    }
  } else if (shape === 'counted' && bullet.count) {
    /**
     * Cap every flip at the remainder. Flipping open claims done wholesale let
     * a re-finished bullet log 6 of 5 — a week claim and a day claim both
     * flipped, counting the same work twice. Day claims flip (trimmed to what
     * is actually left); week claims never flip to done, they are the ledger
     * the day draws out of, and the sweep below retires them.
     */
    const shots = await liveShotsFor(id);
    let done = shots
      .filter(s => s.state === 'done')
      .reduce((n, s) => n + (s.amount ?? 1), 0);
    let remaining = Math.max(0, bullet.count.total - done);

    for (const s of shots
      .filter(x => x.scope === 'day' && x.state === 'open')
      .sort((a, b) => (a.date < b.date ? -1 : 1))) {
      if (remaining <= 0) break;
      const claim = s.amount ?? 1;
      const take = Math.min(claim, remaining);
      // One patch: a trimmed flip must not leave a live over-claimed row if
      // the app dies between writes.
      await mutate('shot', s.id, { amount: take, state: 'done' });
      remaining -= take;
      done += take;
    }

    // The rest as its own done-today row — never merged into another writer's.
    if (remaining > 0) {
      const rest = await createShot(id, 'day', today(), remaining);
      await mutate('shot', rest, { state: 'done' });
    }
  }

  /**
   * A finished bullet must not keep rendering an open card on some other day —
   * but what happens to the open shots is SHAPE-SPECIFIC:
   *
   * - counted: retire them. Their work is already recorded in done rows, and
   *   flipping a week ledger or an over-claim to done counts it twice
   *   (14 logged on a 10-part bullet).
   * - simple/parent: FLIP them done. The shot IS the work record — deleting it
   *   made "Mark done" erase the bullet from Today entirely: no Done row, no
   *   un-tap, work vanished. That shipped in 1.7.0 and lasted a day.
   */
  for (const s of await liveShotsFor(id)) {
    if (s.state !== 'open') continue;
    if (shape === 'counted') await mutate('shot', s.id, { deletedAt: Date.now() });
    else await mutate('shot', s.id, { state: 'done' });
  }

  await mutate('bullet', id, { state: 'done' });

  // A child transitioning to done is what makes a parent reconsider — never a
  // speculative recompute, which is what used to fight explicit actions.
  if (bullet.parentId) await onChildChanged(bullet.parentId, depth + 1);
}

/** A child's state changed, so re-derive just its parent, then upward. */
async function onChildChanged(parentId: string, depth = 0): Promise<void> {
  if (depth > 12) return;
  const parent = (await db.bullets.get(parentId)) as unknown as Bullet | undefined;
  if (!parent || parent.deletedAt) return;

  const kids = await childrenOf(parentId);
  if (kids.length === 0) return;

  const allDone = kids.every(k => k.state === 'done');
  if (allDone && parent.state !== 'done') {
    await completeBullet(parentId, depth + 1);
  } else if (!allDone && parent.state === 'done') {
    await mutate('bullet', parentId, { state: 'open' });
    if (parent.parentId) await onChildChanged(parent.parentId, depth + 1);
  }
}

/**
 * Reopen a bullet — and make sure it is findable again afterwards.
 *
 * Per shape, so the derivation agrees rather than immediately undoing this:
 * a Counted bullet reopens its most recent completed shot (otherwise it is
 * still at total and the settle pass re-finishes it); a Simple bullet reopens
 * the shots completion closed; a Parent just reopens, leaving its pieces alone,
 * because no child transitioned and nothing will re-fire.
 *
 * Then invariant 1: a reopened bullet on a committing horizon needs its shot
 * back, or it is open and reachable from nowhere — which is the state that made
 * a task impossible to select in the Daily Pull.
 */
export function reopenBullet(id: string): Promise<void> {
  return runAction(() => reopenBulletCore(id));
}

async function reopenBulletCore(id: string): Promise<void> {
  const bullet = (await db.bullets.get(id)) as unknown as Bullet | undefined;
  if (!bullet || bullet.deletedAt) return;

  await mutate('bullet', id, { state: 'open' });

  const shape = await shapeOf(bullet);
  const shots = await liveShotsFor(id);

  if (shape === 'counted' && bullet.count) {
    /**
     * Only step back when still AT total — that is the whole reason this
     * exists: at total, the settle pass would immediately re-finish what was
     * just reopened. When the caller has already reconciled progress below
     * total (the dots, "Did 1 more part"), settle cannot re-finish, and
     * flipping a done shot here would wipe the exact count the user just set.
     */
    const done = shots
      .filter(s => s.state === 'done')
      .reduce((n, s) => n + (s.amount ?? 1), 0);
    if (done >= bullet.count.total) {
      /**
       * Step back exactly ONE part. The newest done row can carry a whole
       * day's work — 20 parts walked up the dots land in a handful of rows —
       * and flipping it wholesale turned "Bring it back" into "wipe the day":
       * 19 recorded parts became 0 in one tap. Reopening means one part is
       * outstanding again, so that is precisely what goes back on the plan.
       */
      const lastDone = shots
        .filter(s => s.state === 'done')
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (lastDone) {
        const has = lastDone.amount ?? 1;
        if (has <= 1) await mutate('shot', lastDone.id, { state: 'open' });
        else {
          await mutate('shot', lastDone.id, { amount: has - 1 });
          await createShot(id, 'day', today(), 1);
        }
      }
    }
  } else if (shape === 'simple' || shape === 'parent') {
    /**
     * The parent's OWN shots behave like a simple bullet's — the shot is the
     * commitment marker, the pieces stay untouched. Leaving parents out of
     * this branch meant reopening one left its done card struck on Today while
     * moveToHorizon minted a fresh open card beside it.
     *
     * Stale shots RE-DATE as they reopen. "Bring it back" on Wednesday used to
     * flip Monday's shot open where it sat — an open card on a past day all
     * week — while pullTo, finding nothing dated today, minted a second one.
     */
    const day = today();
    for (const s of shots) {
      if (s.state !== 'done') continue;
      const stale =
        (s.scope === 'day' && s.date < day) ||
        (s.scope === 'week' && s.date < weekStart(day));
      await mutate('shot', s.id, {
        state: 'open',
        ...(stale ? { date: s.scope === 'day' ? day : weekStart(day) } : {}),
      });
    }
  }

  // Restore the commitment the horizon promises, so it is reachable again.
  if (bullet.horizon === 'now' || bullet.horizon === 'next') {
    await moveToHorizon(id, bullet.horizon);
  }

  // Walk every ancestor, not one level — completion rolls up to the root.
  let parentId = bullet.parentId;
  while (parentId) {
    const parent = (await db.bullets.get(parentId)) as unknown as Bullet | undefined;
    if (!parent || parent.state !== 'done') break;
    await mutate('bullet', parent.id, { state: 'open' });
    parentId = parent.parentId;
  }
}

/**
 * Change a bullet's horizon AND keep the calendar honest.
 *
 * Horizon and calendar are two views of one decision — the spec calls manual
 * reconciliation between them "exactly the pedantry we're escaping". A raw
 * setHorizon() to a committing horizon creates no shot, and since every
 * calendar view renders shots while the Shelf only lists shelf/later, the
 * bullet lands in *no view at all*: saved, syncing, and unreachable.
 *
 * Always use this from the UI. setHorizon is the raw field write.
 */
export async function moveToHorizon(id: string, horizon: Horizon): Promise<void> {
  const day = today();

  if (horizon === 'now') {
    await pullTo(id, 'day', day, undefined, 'now');
    return;
  }

  if (horizon === 'next') {
    // "This week, not today" — drop an open commitment for today.
    for (const s of await liveShotsFor(id)) {
      if (s.scope === 'day' && s.state === 'open') {
        await mutate('shot', s.id, { deletedAt: Date.now() });
      }
    }
    await pullTo(id, 'week', weekStart(day), undefined, 'next');
    return;
  }

  // soon / later / shelf are not commitments, so clear the open ones —
  // but never the completed ones. Deleting a done shot erases the record of
  // work that actually happened and resets a counted bullet's progress.
  for (const s of await liveShotsFor(id)) {
    if (s.state === 'open') await mutate('shot', s.id, { deletedAt: Date.now() });
  }
  await setHorizon(id, horizon);
}

/**
 * Slot NOW onto today, and carry yesterday's NOW forward.
 *
 * NOW means today by definition, so nothing on that horizon should ever need
 * scheduling by hand. Capture and moveToHorizon already create the shot, but a
 * commitment made yesterday is stale by morning — the bullet still says NOW
 * while today's list does not show it. Run on launch and when the day rolls
 * over, so opening the app is enough to put NOW work in front of you.
 *
 * Only OPEN bullets, and only their open shots: a stale shot that was actually
 * completed is a record of work done, not a commitment to carry.
 */
export function rollForwardNow(): Promise<number> {
  // Machine write: history renders it as the app, naming no person. Whoever's
  // device happens to run the roll-forward did not do the deciding.
  return runAuto(() => rollForwardNowCore());
}

async function rollForwardNowCore(): Promise<number> {
  const day = today();
  const bullets = (await db.bullets.toArray()).filter(
    b => !b.deletedAt,
  ) as unknown as Bullet[];

  let moved = 0;
  for (const bullet of bullets) {
    if (bullet.state !== 'open' || normalizeHorizon(bullet.horizon) !== 'now' || bullet.parentId) continue;

    const shots = await liveShotsFor(bullet.id);
    const open = shots.filter(s => s.state === 'open');
    if (open.some(s => s.scope === 'day' && s.date === day)) continue;

    // Retire yesterday's unmet commitment rather than leaving two, then
    // re-commit for today CARRYING ITS SIZE. Dropping the amount re-pulled the
    // whole remainder: claim 3 of 20 on Monday, do 1, and Tuesday's card
    // claimed 19 — a plan nobody made.
    let carry: number | undefined;
    for (const s of open) {
      if (s.scope === 'day' && s.date < day) {
        if (s.amount !== undefined) carry = (carry ?? 0) + s.amount;
        await mutate('shot', s.id, { deletedAt: Date.now() });
      }
    }
    /**
     * The carry row's id is DETERMINISTIC: every device that rolls this bullet
     * onto this day writes the same row, so concurrent roll-forwards converge
     * under LWW instead of minting twins — twins here doubled the claim, and a
     * swipe then recorded the doubled amount as done.
     */
    const last = await db.shots.orderBy('sortKey').last();
    await mutate('shot', `carry-${bullet.id}-${day}`, {
      bulletId: bullet.id,
      scope: 'day',
      date: day,
      state: 'open',
      sortKey: keyAtEnd((last as unknown as Shot)?.sortKey ?? null),
      ...(carry !== undefined ? { amount: carry } : {}),
    });
    await setHorizon(bullet.id, 'now');
    moved += 1;
  }
  /**
   * The same safety net for NEXT. A NEXT bullet with no live week shot renders
   * on no list at all — the shape an interrupted capture used to leave, and
   * one the old order could have synced to both devices. The heal row's id is
   * deterministic so concurrent devices converge on one row.
   */
  const weekOf = weekStart(day);
  for (const bullet of bullets) {
    if (bullet.state !== 'open' || bullet.horizon !== 'next' || bullet.parentId) continue;
    const shots = await liveShotsFor(bullet.id);
    if (shots.some(s => s.state === 'open')) continue;
    const last = await db.shots.orderBy('sortKey').last();
    await mutate('shot', `carry-week-${bullet.id}-${weekOf}`, {
      bulletId: bullet.id,
      scope: 'week',
      date: weekOf,
      state: 'open',
      sortKey: keyAtEnd((last as unknown as Shot)?.sortKey ?? null),
    });
    moved += 1;
  }

  return moved;
}

/** Park it. Clears open commitments; the record of finished work survives. */
export const shelve = (id: string) => moveToHorizon(id, 'shelf');

// ------------------------------------------------------------------ shots

async function liveShotsFor(bulletId: string): Promise<Shot[]> {
  const rows = await db.shots.where('bulletId').equals(bulletId).toArray();
  return rows.filter(r => !r.deletedAt) as unknown as Shot[];
}

async function createShot(
  bulletId: string,
  scope: 'week' | 'day',
  date: string,
  amount?: number,
): Promise<string> {
  const id = newId();
  const last = await db.shots.orderBy('sortKey').last();
  await mutate('shot', id, {
    bulletId,
    scope,
    date,
    state: 'open',
    sortKey: keyAtEnd((last as unknown as Shot)?.sortKey ?? null),
    ...(amount !== undefined ? { amount } : {}),
  });
  return id;
}

/**
 * Pull a bullet onto a day or week.
 *
 * Idempotent by (bullet, scope, date). Tapping "take a shot today" twice used to
 * create two shots for the same bullet on the same day, which rendered as the
 * task appearing twice — indistinguishable from a duplicate task. For a counted
 * bullet a second claim is legitimate ("three this morning, five after lunch"),
 * so those merge into the existing shot instead of stacking a second card.
 */
async function pullTo(
  bulletId: string,
  scope: 'week' | 'day',
  date: string,
  amount: number | undefined,
  horizon: Horizon,
): Promise<string> {
  const bullet = (await db.bullets.get(bulletId)) as unknown as Bullet | undefined;
  const existing = (await liveShotsFor(bulletId)).find(
    s => s.scope === scope && s.date === date && s.state === 'open',
  );

  if (existing) {
    /**
     * Counted claims with a size get their OWN row instead of merging into the
     * existing one. The existing row may be mid-consumption on the other
     * device — its reconciler empties rows it consumes, and an increment
     * merged into a row a peer is tombstoning is durably erased (verified: a
     * 3-part pull vanishing entirely). Per-writer rows keep every claim on the
     * row that recorded it; the store groups the cards. For everything else
     * the find-and-reuse stays — it is what stops "Do today" twice rendering
     * a task twice.
     */
    if (amount !== undefined && bullet?.count) {
      const id = await createShot(bulletId, scope, date, amount);
      await setHorizon(bulletId, horizon);
      return id;
    }
    if (amount !== undefined) {
      await mutate('shot', existing.id, { amount: (existing.amount ?? 0) + amount });
    }
    await setHorizon(bulletId, horizon);
    return existing.id;
  }

  const id = await createShot(bulletId, scope, date, amount);
  await setHorizon(bulletId, horizon);
  return id;
}

export const pullToDay = (bulletId: string, date: string, amount?: number) =>
  pullTo(bulletId, 'day', date, amount, 'now');

export const pullToWeek = (bulletId: string, date: string, amount?: number) =>
  pullTo(bulletId, 'week', weekStart(date), amount, 'next');

export async function unpull(shotId: string): Promise<void> {
  // Never tombstone finished work. "Take off today" aims at an open
  // commitment; if the shot completed in the meantime (a peer's swipe landing
  // in the sync gap, or a stale zoom), there is nothing left to take off.
  const shot = (await db.shots.get(shotId)) as unknown as Shot | undefined;
  if (!shot || shot.state === 'done') return;
  await mutate('shot', shotId, { deletedAt: Date.now() });
}

export const moveShot = (shotId: string, date: string) => mutate('shot', shotId, { date });

/**
 * Settle a COUNTED bullet's completion, in the completing direction only.
 *
 * Two devices can each hold half the answer: ten of twenty posts hit on each
 * phone means neither ever computes twenty locally. So after peer ops land we
 * re-check — but only ever to finish something, never to reopen it.
 *
 * One-directional on purpose. A rule that can also reopen is a rule that fights
 * the user: it is what took an explicitly completed parent and flipped it back
 * to open, so the bullet vanished and then reappeared. Parents need no settle
 * at all — the device that completes the last child writes the parent's state,
 * and that field syncs like any other.
 */
async function settleCounted(bulletId: string): Promise<void> {
  const bullet = (await db.bullets.get(bulletId)) as unknown as Bullet | undefined;
  if (!bullet || bullet.deletedAt || bullet.state === 'done' || !bullet.count) return;
  // Children win over count; a Parent is not settled here.
  if ((await childrenOf(bulletId)).length > 0) return;

  const done = (await liveShotsFor(bulletId))
    .filter(s => s.state === 'done')
    .reduce((sum, s) => sum + (s.amount ?? 1), 0);

  if (done >= bullet.count.total) await completeBullet(bulletId);
}

/**
 * Settle everything a batch of peer ops touched.
 *
 * Called by the sync client right after applyLocal. Shot ops are resolved to
 * their bullet here, after the ops are on disk, because the op that created the
 * shot may be in this very batch.
 */
export function settleFromOps(ops: Op[]): Promise<void> {
  // Derived completion is stamped with whichever device pulled first — naming
  // a person here durably credits the wrong one.
  return runAuto(() => settleFromOpsCore(ops));
}

async function settleFromOpsCore(ops: Op[]): Promise<void> {
  const bulletIds = new Set<string>();

  for (const op of ops) {
    if (op.entity === 'bullet') bulletIds.add(op.entityId);
  }

  const shotIds = [...new Set(ops.filter(o => o.entity === 'shot').map(o => o.entityId))];
  if (shotIds.length) {
    const shots = await db.shots.bulkGet(shotIds);
    for (const s of shots) {
      const bulletId = (s as unknown as Shot | undefined)?.bulletId;
      if (bulletId) bulletIds.add(bulletId);
    }
  }

  for (const id of bulletIds) await repairMerged(id);
}

/**
 * Enforce the invariants over a MERGED row set, for every shape.
 *
 * This used to settle counted bullets only, which left a whole class of
 * two-device races permanently broken for simple bullets and parents: the
 * fields land (each write is individually correct), the combination is a state
 * no single device would ever produce, and nothing ever looked at it again.
 * Both devices run this after ops land and the repairs are deterministic
 * functions of the merged rows, so they converge.
 */
async function repairMerged(bulletId: string): Promise<void> {
  const bullet = (await db.bullets.get(bulletId)) as unknown as Bullet | undefined;
  if (!bullet || bullet.deletedAt) return;

  const shape = await shapeOf(bullet);

  /**
   * A shot that is done AND deleted is a collision, not a decision: a stale
   * "Take off today" tombstoning the row a peer had just completed. The done
   * write is a record of finished work; the tombstone was aimed at an open
   * commitment that no longer existed. The work wins. (Counted bullets are
   * exempt — they legitimately empty done rows with { amount: 0, deletedAt }.)
   */
  if (shape !== 'counted') {
    const rows = (await db.shots.where('bulletId').equals(bulletId).toArray()) as unknown as Shot[];
    for (const s of rows) {
      if (s.deletedAt && s.state === 'done') {
        await mutate('shot', s.id, { deletedAt: null });
      }
    }
  }

  /**
   * A done bullet holding a live open shot is the "task came back" complaint:
   * one device completed it overnight, the other rolled it forward before the
   * ops arrived, and the merge is a finished bullet with a fresh open card.
   * Apply completeBullet's own sweep so the phantom becomes the missing Done
   * record (simple/parent) or is retired (counted).
   */
  if (bullet.state === 'done') {
    for (const s of await liveShotsFor(bulletId)) {
      if (s.state !== 'open') continue;
      if (shape === 'counted') await mutate('shot', s.id, { amount: 0, deletedAt: Date.now() });
      else await mutate('shot', s.id, { state: 'done' });
    }
  }

  /**
   * Every live shot done but the bullet still open means the completion
   * happened and the BULLET write was the one that lost — the poisoned-clock
   * shape found in production, and the same shape an app kill mid-swipe
   * leaves. A reopen flips shots back open, so this can never fire against a
   * deliberate reopen.
   */
  if (shape !== 'counted' && bullet.state === 'open') {
    const rows = await liveShotsFor(bulletId);
    if (rows.length > 0 && rows.every(s => s.state === 'done')) {
      await mutate('bullet', bulletId, { state: 'done' });
    }
  }

  /**
   * Parents re-derive from their merged children. A peer un-checking a piece
   * while this device completed the parent merges into "done parent, open
   * child" — a state no device produced and none would ever repair. The
   * doctrine already exists: a child transition makes the parent reconsider.
   */
  if (shape === 'parent') await onChildChanged(bulletId);
  if (bullet.parentId) await onChildChanged(bullet.parentId);

  await settleCounted(bulletId);
}



/** Hit a shot, then apply the owning bullet's shape rule. */
export function completeShot(shotId: string): Promise<void> {
  return runAction(() => completeShotCore(shotId));
}

async function completeShotCore(shotId: string): Promise<void> {
  const shot = (await db.shots.get(shotId)) as unknown as Shot | undefined;
  if (!shot) return;
  const bullet = (await db.bullets.get(shot.bulletId)) as unknown as Bullet | undefined;
  if (!bullet) return;

  const shape = await shapeOf(bullet);

  if (shape === 'counted' && bullet.count) {
    /**
     * The swiped card is the whole DAY, not one row. The store renders day
     * rows grouped per (bullet, date, state), so the card under the finger can
     * stand for several per-writer rows — flip them all, oldest first, each
     * trimmed to the remainder so a swipe can never log more than the total.
     * An undefined claim means the remainder ("Do today"), so it materializes
     * first — flipped raw it records 1 part for a card that stood for 20.
     */
    await materializeClaims(bullet.id, bullet.count.total);
    const live = await liveShotsFor(bullet.id);
    let done = live
      .filter(s => s.state === 'done')
      .reduce((n, s) => n + (s.amount ?? 1), 0);
    let remaining = Math.max(0, bullet.count.total - done);

    /**
     * A WEEK-scope row (the bulk sheet can select the week pool) finishes the
     * share that row claimed — mirroring the day rule. Routed through the
     * day-group logic below it matched nothing and returned having done
     * nothing, while the toast said "Marked 1 done".
     */
    if (shot.scope === 'week') {
      const claim = Math.min(shot.amount ?? remaining, remaining);
      if (claim > 0) await mutate('shot', shot.id, { amount: claim, state: 'done' });
      else await mutate('shot', shot.id, { amount: 0, deletedAt: Date.now() });
      await settleCounted(bullet.id);
      return;
    }

    const group = live
      .filter(x => x.scope === 'day' && x.date === shot.date && x.state === 'open')
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
    let flipped = 0;
    for (const s of group) {
      const claim = s.amount ?? 1;
      const take = Math.min(claim, remaining);
      if (take <= 0) {
        // Over-claim beyond the total: retire it, its work exists nowhere.
        await mutate('shot', s.id, { amount: 0, deletedAt: Date.now() });
        continue;
      }
      await mutate('shot', s.id, { amount: take, state: 'done' });
      remaining -= take;
      flipped += take;
    }

    // The day drew out of the week: the same amount comes off the week ledger.
    let weekDraw = flipped;
    for (const s of (await liveShotsFor(bullet.id))
      .filter(x => x.scope === 'week' && x.state === 'open')
      .sort((a, b) => (a.date < b.date ? -1 : 1))) {
      if (weekDraw <= 0) break;
      const claim = s.amount ?? 1;
      if (claim <= weekDraw) {
        await mutate('shot', s.id, { amount: 0, deletedAt: Date.now() });
        weekDraw -= claim;
      } else {
        await mutate('shot', s.id, { amount: claim - weekDraw });
        weekDraw = 0;
      }
    }

    await settleCounted(bullet.id);
    return;
  }

  await mutate('shot', shotId, { state: 'done' });

  // Simple, or a Parent whose own shot was hit: finishing the shot finishes the
  // bullet, which also closes its other open shots and rolls up to any parent.
  await completeBullet(bullet.id);
}

export function uncompleteShot(shotId: string): Promise<void> {
  return runAction(() => uncompleteShotCore(shotId));
}

async function uncompleteShotCore(shotId: string): Promise<void> {
  const past = (await db.shots.get(shotId)) as unknown as Shot | undefined;
  // Un-hitting work from a past day puts it back on TODAY's plan — reopening
  // it where it sat renders an open card on a day that is already over.
  const stale = past && past.scope === 'day' && past.date < today();
  await mutate('shot', shotId, { state: 'open', ...(stale ? { date: today() } : {}) });

  const shot = (await db.shots.get(shotId)) as unknown as Shot | undefined;
  if (!shot) return;
  const bullet = (await db.bullets.get(shot.bulletId)) as unknown as Bullet | undefined;
  if (!bullet) return;

  // Un-hitting a shot means the bullet is not finished after all. Reopening is
  // always explicit, and reopenBullet restores whatever its horizon promises.
  if (bullet.state === 'done') await reopenBullet(bullet.id);
}

// ---------------------------------------------------------------- huddles

/**
 * Scheduling auto-confirms for both people. There is no pending state and no
 * accept step — the friction we're removing is the surprise, not the meeting.
 */
export async function callHuddle(init: {
  startsAt: number;
  durationMin?: number;
  title?: string;
  calledBy?: Person;
}): Promise<string> {
  const id = newId();
  const by = init.calledBy ?? actor;
  const at = Date.now();
  await mutate('huddle', id, {
    startsAt: init.startsAt,
    durationMin: init.durationMin ?? 30,
    calledBy: by,
    status: 'scheduled',
    ...(init.title ? { title: init.title } : {}),
    // Both sides start confirmed — there is no accept step. `auto` marks these
    // as presumed rather than stated, which is what the badge keys off.
    [RESPONSE_FIELD[by]]: { status: 'in', at, auto: true } satisfies HuddleResponse,
    [RESPONSE_FIELD[otherPerson(by)]]: { status: 'in', at, auto: true } satisfies HuddleResponse,
  });
  return id;
}

export const rescheduleHuddle = (id: string, startsAt: number) =>
  mutate('huddle', id, { startsAt });

export const cancelHuddle = (id: string) => mutate('huddle', id, { status: 'cancelled' });

/**
 * Writes only this person's own field. Deliberately no read-modify-write of a
 * combined map — that pattern loses the other person's concurrent reply.
 */
export async function respondToHuddle(
  huddleId: string,
  response: { status: 'in' | 'nudge' | 'out'; note?: string; proposedAt?: number },
  person: Person = actor,
): Promise<void> {
  await mutate('huddle', huddleId, {
    [RESPONSE_FIELD[person]]: {
      ...response,
      at: Date.now(),
      auto: false,
    } satisfies HuddleResponse,
  });
}

export async function addHuddleItem(
  huddleId: string,
  init: { bulletId?: string; text?: string },
): Promise<string> {
  const id = newId();
  const last = await db.huddleItems.orderBy('sortKey').last();
  await mutate('huddleItem', id, {
    huddleId,
    lane: 'table',
    addedBy: actor,
    sortKey: keyAtEnd((last as unknown as HuddleItem)?.sortKey ?? null),
    ...(init.bulletId ? { bulletId: init.bulletId } : {}),
    ...(init.text ? { text: init.text } : {}),
  });
  return id;
}

/** Single-field ops, which is what makes concurrent lane moves conflict-safe. */
export const decideItem = (itemId: string, decision: string) =>
  mutate('huddleItem', itemId, { lane: 'decided', decision });

export const undecideItem = (itemId: string) => mutate('huddleItem', itemId, { lane: 'table' });

export const removeHuddleItem = (itemId: string) =>
  mutate('huddleItem', itemId, { deletedAt: Date.now() });

/**
 * The point of capturing a decision is that it survives the meeting, so
 * decisions land on their linked bullets rather than staying trapped in
 * a huddle nobody reopens.
 */
export async function wrapHuddle(huddleId: string): Promise<void> {
  const h = (await db.huddles.get(huddleId)) as unknown as Huddle | undefined;
  // Already wrapped: bail rather than append every decision a second time.
  if (!h || h.status === 'done') return;

  const items = (await db.huddleItems.where('huddleId').equals(huddleId).toArray())
    .filter(i => !i.deletedAt) as unknown as HuddleItem[];

  // toDay(), not toISOString(): an 8pm huddle is stamped with tomorrow's date
  // in UTC, which is wrong on the bullet it lands on.
  const stamp = toDay(new Date(h.startsAt));

  for (const item of items) {
    if (item.lane !== 'decided' || !item.bulletId || !item.decision) continue;
    const b = (await db.bullets.get(item.bulletId)) as unknown as Bullet | undefined;
    if (!b) continue;
    const line = `Huddle ${stamp}: ${item.decision}`;
    // Belt and braces — if both devices wrap the same huddle simultaneously,
    // neither should double up the note.
    if (b.note?.includes(line)) continue;
    const prior = b.note ? `${b.note}\n\n` : '';
    await mutate('bullet', item.bulletId, {
      note: `${prior}${line}`,
    });
  }

  await mutate('huddle', huddleId, { status: 'done' });
}

export type { Client, Bullet, Shot, Huddle, HuddleItem };

/**
 * Delete a bullet and everything hanging off it.
 *
 * Distinct from completing it, and deliberately plainly named. Soft delete, so
 * the tombstone syncs and the row cannot resurrect from the other device — and
 * the op log still holds the history if it ever has to be recovered.
 */
export async function deleteBullet(id: string): Promise<void> {
  const bullet = (await db.bullets.get(id)) as unknown as Bullet | undefined;
  const parentId = bullet?.parentId;

  await deleteBulletTree(id);

  /**
   * Removing a piece is a child-set transition, same as adding one — so the
   * parent reconsiders. Deleting the last open piece of an otherwise-finished
   * parent used to leave it open forever with every piece done. Top level
   * only: the cascade below must not fire derivations against a parent that
   * is itself being tombstoned.
   */
  if (parentId) await onChildChanged(parentId);
}

async function deleteBulletTree(id: string): Promise<void> {
  const at = Date.now();

  const children = (await db.bullets.where('parentId').equals(id).toArray())
    .filter(b => !b.deletedAt) as unknown as Bullet[];
  for (const child of children) await deleteBulletTree(child.id);

  // Orphaned shots would keep rendering a card for a bullet that no longer exists.
  for (const s of await liveShotsFor(id)) await mutate('shot', s.id, { deletedAt: at });

  await mutate('bullet', id, { deletedAt: at });
}
