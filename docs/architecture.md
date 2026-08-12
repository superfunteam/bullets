# Architecture

How Bullets is put together, and how to change it without breaking sync.

This is the document to read before adding a feature. It's written for the
version of us that comes back in three months having forgotten all of this.

---

## The one-paragraph version

The UI renders synchronously from IndexedDB. Every write becomes field-level
**ops** that are applied locally first and queued in an outbox. A polling loop
trades the outbox against an append-only op log on the server in a single
round trip. Conflicts resolve last-write-wins per field. The server never
interprets an op, so new entity types and fields need no migration.

---

## Layers

```
views/            React. Reads through hooks, writes through mutations. No exceptions.
  ↓
data/store.ts     Dexie live queries. Reactive reads, already joined.
data/selectors.ts Pure derivations: tension, progress, ordering.
  ↓
data/mutations.ts THE ONLY WRITER. Builds ops, applies locally, enqueues.
  ↓
data/ops.ts       applyOp: pure, idempotent, order-independent fold.
data/db.ts        Dexie schema. Entities stored already materialized.
  ↓
sync/client.ts    Adaptive polling. Drains outbox, applies remote ops.
  ↓
netlify/functions/sync.mts → Postgres `ops` table
```

## The two rules

### 1. Only `data/mutations.ts` writes

A view that calls `db.bullets.put()` directly skips the op log. The change
appears locally, never syncs, and the two devices diverge with no error
anywhere — the worst possible failure mode, because it looks like it worked.

Every write goes through `mutate(entity, entityId, patch)`. If you need a new
write, add a named function to `mutations.ts` and export it.

### 2. Only `design/springs.ts` configures motion

Duration-based easing is banned. Springs are interruptible — a user can grab a
moving card mid-flight and it responds — which is what separates "feels native"
from "plays animations at you."

Animate **transform and opacity only**. Anything that animates layout, width,
height, or color per-frame drops off the compositor and blows the 120Hz budget.
The flood effect on `ShotCard` is a `scaleX` on an overlay for exactly this
reason, not a width animation.

---

## The op log

```ts
type Op = {
  opId: string;      // client-generated uuid; makes retries idempotent
  entity: EntityKind;
  entityId: string;
  field: string;     // ONE field
  value: unknown;    // the server never looks inside this
  ts: number;        // monotonic client clock
  actor: Person;
};
```

Creating a bullet emits an op per field. Moving a huddle item between lanes
emits exactly one.

### Why field-level, not record-level

Two people editing different fields of the same bullet both win. Record-level
LWW would silently discard one of them.

### Why the server has no entity tables

Adding an entity type or a field would otherwise mean a migration, a backend
deploy, and coordination between two independently-updating clients. With an
opaque log, a new client can write `entity: 'ritual'` and an old client simply
skips what it doesn't model — see the `if (!table) continue` guard in
`applyLocal`. The op stays in the log and materializes after the old client
updates.

**When you add an entity type:** add it to `EntityKind` in `data/types.ts`, add
a Dexie store in `data/db.ts` (bump the version), and add it to `TABLES`. That's
it. No SQL, no deploy ordering.

### Convergence

`applyOp` is pure, idempotent, and order-independent. Any set of ops folded in
any order produces the same record on every device. There's a test for exactly
this (`ops.test.ts`, "converges no matter what order a batch of ops arrives in")
and it has already caught one real bug — the timestamp envelope was being
skipped when a value lost, making `createdAt` depend on arrival order.

**If you touch `applyOp`, that test is the one that matters.**

### The monotonic clock

`Date.now()` has millisecond resolution, so two writes in one tick collide and
fall through to the opId tie-break, which is random — meaning the *earlier*
write wins half the time and the user's action silently doesn't stick. This is
not theoretical; it showed up immediately in the huddle board tests.

`mutations.ts` therefore stamps ops with a clock forced to strictly increase on
this device. Cross-device ordering still uses real wall time, which is what we
want.

**Known limitation:** clock skew between two devices resolves in favor of
whichever has the faster clock. With two users editing different things this has
never mattered. If it ever does, the fix is server-assigned timestamps on
ingest, which the schema already accommodates.

---

## Sync

One endpoint, both directions:

```
POST /api/sync  { since, ops, context }  →  { seq, ops, presence }
```

Combining push and pull halves latency on the live board and makes offline
trivial: the outbox drains with no special-case code.

**Ack by explicit id, never "clear the outbox".** A mutation made while a request
is in flight would otherwise be dropped and never sync.

### Pace

| Context | Interval |
|---|---|
| Live huddle board | 1.5s |
| Normal foreground use | 15s |
| Focus / resume / reconnect | immediate |

Views set this with `setPace('live', 'huddle:<id>')` on mount and
`setPace('idle', null)` on unmount.

Netlify Functions can't hold WebSockets and cap streaming responses at 60
seconds, so SSE would mean constant reconnect churn. For two users, polling at
the right cadence is simpler and indistinguishable from realtime.

### Presence

The `context` string doubles as a presence key. Anyone who polled the same
context within 15 seconds is "here". No extra infrastructure.

---

## Data model notes

**Shots vs. counts.** A bullet holds the *total* ("20 posts"); shots hold the
*portions* ("3 on Monday"). Completion is derived by summing done shots against
the total, so there is no progress field anyone has to keep honest and no
progress bar to argue with.

**Horizon stays in sync automatically.** Pulling to a day sets `NOW`; pulling to
a week sets `NEXT`; shelving removes shots. Manual override exists but should
never be *required* — making people maintain two overlapping concepts is exactly
the pedantry this app exists to escape.

**Soft delete always.** `deletedAt`, never a hard delete. A hard delete loses the
tombstone and the row resurrects on the other device.

---

## Adding a feature

1. Add fields to `data/types.ts`.
2. Add a named write to `data/mutations.ts`.
3. Add a read hook to `data/store.ts` and any pure derivation to `selectors.ts`.
4. Build the view with primitives from `design/`.
5. Write tests for anything in `data/` — that layer is where a bug silently
   corrupts data. Views are verified by hand.

No backend work is needed unless you're changing how sync itself behaves.

---

## Things that will bite

- **Dexie indexes.** Any field you `.where()` or `.orderBy()` on must be in the
  schema string. Missing one throws `SchemaError` at runtime, not compile time.
- **`clean()` before the UI.** Entities are stored with `_ts`/`_op` bookkeeping.
  Strip it, or it leaks into props and diffs.
- **`import { motion } from 'motion/react'`**, not `framer-motion`. Same library,
  current package name.
- **The SPA redirect in `netlify.toml` must stay last.** It swallows function
  routes otherwise.
- **Capacitor regenerates `capacitor.build.gradle` on every sync.** Never edit
  it; put custom Gradle in `android/app/build.gradle`.
