# Bullets Web App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Bullets web app — a two-person, deadline-first bullet journal with live-shared Huddles — deployable to Netlify.

**Architecture:** Local-first. All UI renders synchronously from IndexedDB; the network is never on the critical path. Every mutation is a field-level op appended to a local outbox, applied optimistically, and drained to an append-only op log on the server. Conflict resolution is last-write-wins per field, which makes the live Huddle board conflict-safe without CRDTs. The server never interprets op values, so new entity types and fields need zero backend changes.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind v4, Motion (Framer Motion), `@use-gesture/react`, Dexie (IndexedDB), Zustand, Vitest. Backend is Netlify Functions v2 (`.mts`) over `@netlify/database`.

**Companion plan:** `docs/superpowers/plans/2026-08-12-bullets-android.md` wraps this app's build output. Do not start it until Task 14 is green.

---

## File Structure

Decomposition is by **responsibility**, not by technical layer. Files that change together live together.

```
src/
  lib/
    id.ts               uuid + op id generation
    dates.ts            week/day math, ISO day strings, all date logic
    sortKey.ts          fractional indexing wrapper
  data/
    types.ts            entity types + Horizon. The vocabulary, in code.
    db.ts               Dexie schema and table handles
    ops.ts              Op type, applyOp (field-level LWW), materialize
    outbox.ts           durable queue of unsent ops
    mutations.ts        THE ONLY module that writes. All writes emit ops.
    selectors.ts        derived reads: today's shots, tension, count progress
    store.ts            Zustand store + Dexie live-query bindings
  sync/
    auth.ts             passphrase -> bearer token, person identity
    client.ts           the sync loop + adaptive cadence
  design/
    tokens.css          CSS custom properties; light/dark; the whole palette
    springs.ts          named spring presets — the ONLY source of motion config
    Slab.tsx            the primary chunky surface primitive
    Sheet.tsx           bottom sheet w/ drag-to-dismiss
    Stepper.tsx         giant +/- number control
    HorizonChip.tsx     the NOW/NEXT/SOON/LATER/SHELF chip
    ClientDot.tsx       client hue accent
    Toast.tsx           undo affordance
  views/
    Today/              default screen
    Week/               stacked days + desktop grid toggle
    Shelf/              the pile, grouped by client
    Pull/               weekly + daily ritual
    Bullet/             zoom detail
    Huddle/             list, request sheet, live board
    Capture/            the add-a-bullet sheet
  App.tsx
  main.tsx
netlify/
  functions/
    sync.mts            push+pull in one round trip
    snapshot.mts        cold-start snapshot from Blobs
    auth.mts            passphrase exchange
    compact.mts         scheduled log -> snapshot compaction
    ai-braindump.mts    text -> structured bullets
    ai-huddle-wrap.mts  board notes -> decisions + follow-ups
  database/migrations/
    0001_ops.sql
```

**Why `mutations.ts` is the only writer:** if any view can write to Dexie directly, ops get skipped and devices silently diverge. Funnelling every write through one module makes that class of bug structurally impossible. This is the single most important architectural rule in the codebase.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `netlify.toml`, `.gitignore`, `src/main.tsx`, `src/App.tsx`

- [ ] **Step 1: Scaffold Vite + React + TS**

```bash
npm create vite@latest . -- --template react-ts
npm install
```

- [ ] **Step 2: Install runtime dependencies**

```bash
npm install motion @use-gesture/react dexie dexie-react-hooks zustand fractional-indexing
npm install -D tailwindcss @tailwindcss/vite vitest @vitest/ui jsdom @testing-library/react @testing-library/user-event fake-indexeddb
npm install @netlify/vite-plugin @netlify/functions @netlify/database @netlify/blobs @anthropic-ai/sdk
```

- [ ] **Step 3: Configure Vite with Tailwind v4 and the Netlify plugin**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import netlify from '@netlify/vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), netlify()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

`src/test-setup.ts`:
```ts
import 'fake-indexeddb/auto';
```

- [ ] **Step 4: Write netlify.toml**

```toml
[build]
  command = "npm run build"
  publish = "dist"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"

# Must be last — functions with an explicit config.path are matched first.
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

- [ ] **Step 5: Verify the dev server boots**

Run: `npm run dev`
Expected: Vite serves on :5173 with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite + React + Tailwind + Netlify"
```

---

## Task 2: Core primitives — ids, dates, sort keys

These are pure functions with no dependencies. They get real tests because every other module builds on them and an off-by-one in week math corrupts the whole calendar.

**Files:**
- Create: `src/lib/id.ts`, `src/lib/dates.ts`, `src/lib/sortKey.ts`
- Test: `src/lib/dates.test.ts`, `src/lib/sortKey.test.ts`

- [ ] **Step 1: Write failing tests for date math**

`src/lib/dates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toDay, weekStart, addDays, daysUntil, isSameDay, weekDays } from './dates';

describe('dates', () => {
  it('formats a Date as an ISO day string', () => {
    expect(toDay(new Date(2026, 7, 12))).toBe('2026-08-12');
  });

  it('finds Monday as the week start', () => {
    // 2026-08-12 is a Wednesday
    expect(weekStart('2026-08-12')).toBe('2026-08-10');
  });

  it('treats Monday as its own week start', () => {
    expect(weekStart('2026-08-10')).toBe('2026-08-10');
  });

  it('treats Sunday as belonging to the week that started six days earlier', () => {
    expect(weekStart('2026-08-16')).toBe('2026-08-10');
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02');
  });

  it('counts days until a future day', () => {
    expect(daysUntil('2026-08-12', '2026-08-15')).toBe(3);
  });

  it('returns a negative count for a past day', () => {
    expect(daysUntil('2026-08-12', '2026-08-09')).toBe(-3);
  });

  it('lists the seven days of a week in order', () => {
    expect(weekDays('2026-08-12')).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12',
      '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL — cannot resolve `./dates`.

- [ ] **Step 3: Implement dates.ts**

All day values are `'YYYY-MM-DD'` strings in local time. Never pass a `Date` across a module boundary — that's how timezone bugs get in.

```ts
export type Day = string; // 'YYYY-MM-DD'

export function toDay(d: Date): Day {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDay(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): Day {
  return toDay(new Date());
}

export function addDays(day: Day, n: number): Day {
  const d = fromDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** Monday-based. Sunday belongs to the week that began six days earlier. */
export function weekStart(day: Day): Day {
  const d = fromDay(day);
  const dow = d.getDay();            // 0 = Sunday
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDays(day, delta);
}

export function weekDays(day: Day): Day[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function daysUntil(from: Day, to: Day): number {
  const ms = fromDay(to).getTime() - fromDay(from).getTime();
  return Math.round(ms / 86_400_000);
}

export function isSameDay(a: Day, b: Day): boolean {
  return a === b;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Implement id.ts and sortKey.ts**

`src/lib/id.ts`:
```ts
export const newId = (): string => crypto.randomUUID();
```

`src/lib/sortKey.ts`:
```ts
import { generateKeyBetween } from 'fractional-indexing';

/** Key that sorts between a and b. Pass null for an open end. */
export function keyBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b);
}

export function keyAtEnd(last: string | null): string {
  return generateKeyBetween(last, null);
}

export function keyAtStart(first: string | null): string {
  return generateKeyBetween(null, first);
}
```

`src/lib/sortKey.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { keyBetween, keyAtEnd, keyAtStart } from './sortKey';

describe('sortKey', () => {
  it('produces a key that sorts between two others', () => {
    const a = keyAtEnd(null);
    const b = keyAtEnd(a);
    const mid = keyBetween(a, b);
    expect([b, mid, a].sort()).toEqual([a, mid, b]);
  });

  it('appends after the last key', () => {
    const a = keyAtEnd(null);
    expect(keyAtEnd(a) > a).toBe(true);
  });

  it('prepends before the first key', () => {
    const a = keyAtEnd(null);
    expect(keyAtStart(a) < a).toBe(true);
  });
});
```

- [ ] **Step 6: Run the full suite and commit**

```bash
npx vitest run
git add -A && git commit -m "feat: add id, date, and sort key primitives"
```

---

## Task 3: Entity types

**Files:**
- Create: `src/data/types.ts`

- [ ] **Step 1: Write types.ts**

This file is the vocabulary from the spec, in code. Keep it free of logic so it can be imported by both the client and the Netlify functions.

```ts
export type Person = 'clark' | 'angie';

export const HORIZONS = ['now', 'next', 'soon', 'later', 'shelf'] as const;
export type Horizon = (typeof HORIZONS)[number];

export const HORIZON_META: Record<Horizon, { label: string; blurb: string; emoji: string }> = {
  now:   { label: 'NOW',   blurb: 'Super urgent, right now', emoji: '🔥' },
  next:  { label: 'NEXT',  blurb: 'As soon as we can',       emoji: '⚡' },
  soon:  { label: 'SOON',  blurb: 'In the near future',      emoji: '🌤' },
  later: { label: 'LATER', blurb: 'In the distant future',   emoji: '🌙' },
  shelf: { label: 'SHELF', blurb: 'To be decided on',        emoji: '📚' },
};

export type EntityKind = 'client' | 'bullet' | 'shot' | 'huddle' | 'huddleItem';

export type Entity = {
  id: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type Client = Entity & {
  name: string;
  hue: number;
  archived?: boolean;
};

export type Bullet = Entity & {
  title: string;
  note?: string;
  clientId?: string;
  parentId?: string;
  horizon: Horizon;
  deadline?: string;
  kind: 'task' | 'event' | 'note';
  count?: { total: number; unit: string };
  state: 'open' | 'done' | 'dropped';
  sortKey: string;
};

export type Shot = Entity & {
  bulletId: string;
  scope: 'week' | 'day';
  date: string;
  amount?: number;
  state: 'open' | 'done';
  sortKey: string;
};

export type HuddleResponse = {
  status: 'in' | 'nudge' | 'out';
  note?: string;
  proposedAt?: number;
  at: number;
};

export type Huddle = Entity & {
  title?: string;
  startsAt: number;
  durationMin: number;
  calledBy: Person;
  status: 'scheduled' | 'live' | 'done' | 'cancelled';
  responses: Partial<Record<Person, HuddleResponse>>;
};

export type HuddleItem = Entity & {
  huddleId: string;
  bulletId?: string;
  text?: string;
  lane: 'table' | 'decided';
  decision?: string;
  sortKey: string;
  addedBy: Person;
};

export type AnyEntity = Client | Bullet | Shot | Huddle | HuddleItem;
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add -A && git commit -m "feat: add entity types"
```

---

## Task 4: The op log and field-level LWW

This is the highest-risk module in the codebase. A bug here corrupts data silently across devices, so it gets thorough tests including the adversarial cases: duplicate delivery, out-of-order delivery, and simultaneous writes.

**Files:**
- Create: `src/data/ops.ts`
- Test: `src/data/ops.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/data/ops.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { applyOp, type Op, type Materialized } from './ops';

const op = (over: Partial<Op>): Op => ({
  opId: 'op-1', entity: 'bullet', entityId: 'b1',
  field: 'title', value: 'Hello', ts: 1000, actor: 'clark', ...over,
});

describe('applyOp', () => {
  it('creates a record from the first op', () => {
    const rec = applyOp(undefined, op({}));
    expect(rec.title).toBe('Hello');
    expect(rec.id).toBe('b1');
  });

  it('applies a newer op over an older value', () => {
    const a = applyOp(undefined, op({ opId: 'x', ts: 1000, value: 'Old' }));
    const b = applyOp(a, op({ opId: 'y', ts: 2000, value: 'New' }));
    expect(b.title).toBe('New');
  });

  it('ignores an op older than the current value', () => {
    const a = applyOp(undefined, op({ opId: 'x', ts: 2000, value: 'New' }));
    const b = applyOp(a, op({ opId: 'y', ts: 1000, value: 'Old' }));
    expect(b.title).toBe('New');
  });

  it('is idempotent — replaying the same op changes nothing', () => {
    const one = applyOp(undefined, op({}));
    const twice = applyOp(one, op({}));
    expect(twice).toEqual(one);
  });

  it('breaks simultaneous-timestamp ties deterministically by opId', () => {
    const fromA = applyOp(applyOp(undefined, op({ opId: 'aaa', ts: 5, value: 'A' })),
                                   op({ opId: 'bbb', ts: 5, value: 'B' }));
    const fromB = applyOp(applyOp(undefined, op({ opId: 'bbb', ts: 5, value: 'B' })),
                                   op({ opId: 'aaa', ts: 5, value: 'A' }));
    expect(fromA.title).toBe(fromB.title);
  });

  it('resolves different fields independently', () => {
    let rec = applyOp(undefined, op({ field: 'title', value: 'T', ts: 3000 }));
    rec = applyOp(rec, op({ field: 'horizon', value: 'now', ts: 1000 }));
    expect(rec.title).toBe('T');
    expect((rec as any).horizon).toBe('now');
  });

  it('tracks updatedAt as the newest op timestamp seen', () => {
    let rec = applyOp(undefined, op({ ts: 1000 }));
    rec = applyOp(rec, op({ opId: 'z', field: 'note', value: 'n', ts: 4000 }));
    expect(rec.updatedAt).toBe(4000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/ops.test.ts`
Expected: FAIL — cannot resolve `./ops`.

- [ ] **Step 3: Implement ops.ts**

```ts
import type { AnyEntity, EntityKind, Person } from './types';

export type Op = {
  opId: string;
  entity: EntityKind;
  entityId: string;
  field: string;
  value: unknown;
  ts: number;
  actor: Person;
};

/** An entity plus the per-field clocks that make LWW work. */
export type Materialized = AnyEntity & {
  _ts: Record<string, number>;
  _op: Record<string, string>;
};

/**
 * Fold one op into a record. Pure, idempotent, and order-independent:
 * applying the same set of ops in any order yields the same result.
 */
export function applyOp(rec: Materialized | undefined, op: Op): Materialized {
  const base: Materialized = rec ?? ({
    id: op.entityId,
    createdAt: op.ts,
    updatedAt: op.ts,
    _ts: {},
    _op: {},
  } as Materialized);

  const seenTs = base._ts[op.field];
  if (seenTs !== undefined) {
    if (op.ts < seenTs) return base;
    // Equal timestamps: the larger opId wins. Arbitrary but identical everywhere.
    if (op.ts === seenTs && op.opId <= (base._op[op.field] ?? '')) return base;
  }

  return {
    ...base,
    [op.field]: op.value,
    createdAt: Math.min(base.createdAt, op.ts),
    updatedAt: Math.max(base.updatedAt, op.ts),
    _ts: { ...base._ts, [op.field]: op.ts },
    _op: { ...base._op, [op.field]: op.opId },
  } as Materialized;
}

/** Strip sync bookkeeping before handing an entity to the UI. */
export function clean<T extends AnyEntity>(rec: Materialized): T {
  const { _ts, _op, ...rest } = rec;
  return rest as T;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/ops.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add op log with field-level last-write-wins"
```

---

## Task 5: Dexie schema and the outbox

**Files:**
- Create: `src/data/db.ts`, `src/data/outbox.ts`
- Test: `src/data/outbox.test.ts`

- [ ] **Step 1: Write db.ts**

Entities are stored materialized (with `_ts`/`_op`) so reads are direct table lookups rather than a replay.

```ts
import Dexie, { type Table } from 'dexie';
import type { Materialized, Op } from './ops';

export class BulletsDB extends Dexie {
  clients!: Table<Materialized, string>;
  bullets!: Table<Materialized, string>;
  shots!: Table<Materialized, string>;
  huddles!: Table<Materialized, string>;
  huddleItems!: Table<Materialized, string>;
  outbox!: Table<Op, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'bullets') {
    super(name);
    this.version(1).stores({
      clients: 'id, name, archived',
      bullets: 'id, clientId, parentId, horizon, deadline, state, sortKey',
      shots: 'id, bulletId, date, scope, state, [scope+date]',
      huddles: 'id, startsAt, status',
      huddleItems: 'id, huddleId, lane, sortKey',
      outbox: 'opId, ts',
      meta: 'key',
    });
  }
}

export const db = new BulletsDB();

export const TABLES = {
  client: () => db.clients,
  bullet: () => db.bullets,
  shot: () => db.shots,
  huddle: () => db.huddles,
  huddleItem: () => db.huddleItems,
} as const;
```

- [ ] **Step 2: Write the failing outbox test**

`src/data/outbox.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { enqueue, pending, ack } from './outbox';
import type { Op } from './ops';

const op = (id: string): Op => ({
  opId: id, entity: 'bullet', entityId: 'b1',
  field: 'title', value: id, ts: Date.now(), actor: 'clark',
});

describe('outbox', () => {
  beforeEach(async () => { await db.outbox.clear(); });

  it('holds enqueued ops until they are acked', async () => {
    await enqueue([op('a'), op('b')]);
    expect((await pending()).map(o => o.opId)).toEqual(['a', 'b']);
  });

  it('drops only the acked ops', async () => {
    await enqueue([op('a'), op('b')]);
    await ack(['a']);
    expect((await pending()).map(o => o.opId)).toEqual(['b']);
  });

  it('survives ops enqueued while a send is in flight', async () => {
    await enqueue([op('a')]);
    const inFlight = await pending();
    await enqueue([op('b')]);          // arrives mid-send
    await ack(inFlight.map(o => o.opId));
    expect((await pending()).map(o => o.opId)).toEqual(['b']);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then implement outbox.ts**

Run: `npx vitest run src/data/outbox.test.ts` → FAIL.

```ts
import { db } from './db';
import type { Op } from './ops';

export async function enqueue(ops: Op[]): Promise<void> {
  await db.outbox.bulkPut(ops);
}

export async function pending(limit = 500): Promise<Op[]> {
  return db.outbox.orderBy('ts').limit(limit).toArray();
}

/** Ack by explicit id so ops enqueued mid-flight are never dropped. */
export async function ack(opIds: string[]): Promise<void> {
  await db.outbox.bulkDelete(opIds);
}
```

- [ ] **Step 4: Run tests to verify they pass, then commit**

```bash
npx vitest run src/data/outbox.test.ts
git add -A && git commit -m "feat: add Dexie schema and durable outbox"
```

---

## Task 6: Mutations — the single write path

**Files:**
- Create: `src/data/mutations.ts`
- Test: `src/data/mutations.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/data/mutations.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { createBullet, setHorizon, pullToDay, completeShot, setActor } from './mutations';
import { pending } from './outbox';

beforeEach(async () => {
  await Promise.all([db.bullets.clear(), db.shots.clear(), db.outbox.clear()]);
  setActor('clark');
});

describe('mutations', () => {
  it('creates a bullet and records ops for every field set', async () => {
    const id = await createBullet({ title: 'Ship the deck', horizon: 'shelf' });
    const b = await db.bullets.get(id);
    expect(b!.title).toBe('Ship the deck');
    const fields = (await pending()).map(o => o.field);
    expect(fields).toContain('title');
    expect(fields).toContain('horizon');
  });

  it('pulling a bullet into a day promotes its horizon to now', async () => {
    const id = await createBullet({ title: 'X', horizon: 'shelf' });
    await pullToDay(id, '2026-08-12');
    expect((await db.bullets.get(id))!.horizon).toBe('now');
  });

  it('pulling into a day creates exactly one day-scoped shot', async () => {
    const id = await createBullet({ title: 'X', horizon: 'shelf' });
    await pullToDay(id, '2026-08-12');
    const shots = await db.shots.where('bulletId').equals(id).toArray();
    expect(shots).toHaveLength(1);
    expect(shots[0].scope).toBe('day');
    expect(shots[0].date).toBe('2026-08-12');
  });

  it('completing the only shot of an uncounted bullet completes the bullet', async () => {
    const id = await createBullet({ title: 'X', horizon: 'shelf' });
    await pullToDay(id, '2026-08-12');
    const shot = (await db.shots.where('bulletId').equals(id).toArray())[0];
    await completeShot(shot.id);
    expect((await db.bullets.get(id))!.state).toBe('done');
  });

  it('completing a partial shot leaves a counted bullet open', async () => {
    const id = await createBullet({ title: 'Posts', horizon: 'shelf', count: { total: 20, unit: 'posts' } });
    await pullToDay(id, '2026-08-12', 3);
    const shot = (await db.shots.where('bulletId').equals(id).toArray())[0];
    await completeShot(shot.id);
    expect((await db.bullets.get(id))!.state).toBe('open');
  });

  it('every mutation lands in the outbox', async () => {
    const id = await createBullet({ title: 'X', horizon: 'shelf' });
    const before = (await pending()).length;
    await setHorizon(id, 'next');
    expect((await pending()).length).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement mutations.ts**

Run: `npx vitest run src/data/mutations.test.ts` → FAIL.

Every exported function follows the same shape: build ops, apply them locally, enqueue them. Nothing else in the codebase may call `db.<table>.put`.

```ts
import { db, TABLES } from './db';
import { applyOp, type Op, type Materialized } from './ops';
import { enqueue } from './outbox';
import { newId } from '../lib/id';
import { keyAtEnd } from '../lib/sortKey';
import { weekStart } from '../lib/dates';
import type { Bullet, EntityKind, Horizon, Person, Shot } from './types';

let actor: Person = 'clark';
export const setActor = (p: Person) => { actor = p; };

type Listener = () => void;
const listeners = new Set<Listener>();
export const onChange = (fn: Listener) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach(fn => fn());

/** The one true write path. Builds ops from a patch, applies locally, queues for sync. */
export async function mutate(
  entity: EntityKind,
  entityId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const ts = Date.now();
  const ops: Op[] = Object.entries(patch).map(([field, value]) => ({
    opId: newId(), entity, entityId, field, value, ts, actor,
  }));
  await applyLocal(ops);
  await enqueue(ops);
  notify();
}

/** Fold ops into local tables. Used by mutate() and by the sync client for remote ops. */
export async function applyLocal(ops: Op[]): Promise<void> {
  const byEntity = new Map<string, Op[]>();
  for (const op of ops) {
    const key = `${op.entity}:${op.entityId}`;
    (byEntity.get(key) ?? byEntity.set(key, []).get(key)!).push(op);
  }
  await db.transaction('rw', [db.clients, db.bullets, db.shots, db.huddles, db.huddleItems], async () => {
    for (const [key, group] of byEntity) {
      const [entity, id] = key.split(':') as [EntityKind, string];
      const table = TABLES[entity]();
      let rec = await table.get(id);
      for (const op of group) rec = applyOp(rec, op);
      await table.put(rec as Materialized);
    }
  });
}

// ---- Bullets ----

export async function createBullet(init: Partial<Bullet> & { title: string }): Promise<string> {
  const id = init.id ?? newId();
  const last = await db.bullets.orderBy('sortKey').last();
  await mutate('bullet', id, {
    title: init.title,
    horizon: init.horizon ?? 'shelf',
    kind: init.kind ?? 'task',
    state: 'open',
    sortKey: init.sortKey ?? keyAtEnd(last?.sortKey as string ?? null),
    ...(init.clientId ? { clientId: init.clientId } : {}),
    ...(init.parentId ? { parentId: init.parentId } : {}),
    ...(init.deadline ? { deadline: init.deadline } : {}),
    ...(init.count ? { count: init.count } : {}),
    ...(init.note ? { note: init.note } : {}),
  });
  return id;
}

export const setHorizon = (id: string, horizon: Horizon) => mutate('bullet', id, { horizon });
export const setDeadline = (id: string, deadline?: string) => mutate('bullet', id, { deadline });
export const setTitle = (id: string, title: string) => mutate('bullet', id, { title });
export const setClient = (id: string, clientId?: string) => mutate('bullet', id, { clientId });
export const callOff = (id: string) => mutate('bullet', id, { state: 'dropped' });

/** Shelving clears commitments — a shelved bullet must not linger on a calendar. */
export async function shelve(id: string): Promise<void> {
  const shots = await db.shots.where('bulletId').equals(id).toArray();
  await Promise.all(shots.map(s => mutate('shot', s.id, { deletedAt: Date.now() })));
  await setHorizon(id, 'shelf');
}

// ---- Shots ----

async function createShot(bulletId: string, scope: 'week' | 'day', date: string, amount?: number) {
  const id = newId();
  const last = await db.shots.orderBy('sortKey').last();
  await mutate('shot', id, {
    bulletId, scope, date, state: 'open',
    sortKey: keyAtEnd(last?.sortKey as string ?? null),
    ...(amount !== undefined ? { amount } : {}),
  });
  return id;
}

export async function pullToDay(bulletId: string, date: string, amount?: number): Promise<string> {
  const id = await createShot(bulletId, 'day', date, amount);
  await setHorizon(bulletId, 'now');
  return id;
}

export async function pullToWeek(bulletId: string, date: string, amount?: number): Promise<string> {
  const id = await createShot(bulletId, 'week', weekStart(date), amount);
  await setHorizon(bulletId, 'next');
  return id;
}

export const unpull = (shotId: string) => mutate('shot', shotId, { deletedAt: Date.now() });

/** Completing a shot rolls up: an uncounted bullet is done; a counted one is done at total. */
export async function completeShot(shotId: string): Promise<void> {
  await mutate('shot', shotId, { state: 'done' });
  const shot = await db.shots.get(shotId) as Shot | undefined;
  if (!shot) return;
  const bullet = await db.bullets.get(shot.bulletId) as Bullet | undefined;
  if (!bullet) return;

  if (!bullet.count) {
    await mutate('bullet', bullet.id, { state: 'done' });
    return;
  }
  const all = await db.shots.where('bulletId').equals(bullet.id).toArray();
  const done = all
    .filter(s => !s.deletedAt && (s as Shot).state === 'done')
    .reduce((sum, s) => sum + ((s as Shot).amount ?? 1), 0);
  if (done >= bullet.count.total) {
    await mutate('bullet', bullet.id, { state: 'done' });
  }
}

export const uncompleteShot = (shotId: string) => mutate('shot', shotId, { state: 'open' });
```

- [ ] **Step 3: Run tests to verify they pass, then commit**

```bash
npx vitest run src/data/mutations.test.ts
git add -A && git commit -m "feat: add mutation layer as the single write path"
```

---

## Task 7: Selectors — derived reads

The tension calculation is the product's core idea, so it gets tests.

**Files:**
- Create: `src/data/selectors.ts`
- Test: `src/data/selectors.test.ts`

- [ ] **Step 1: Write the failing tension tests**

`src/data/selectors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { tensionOf, progressOf } from './selectors';
import type { Bullet, Shot } from './types';

const bullet = (over: Partial<Bullet>): Bullet => ({
  id: 'b', createdAt: 0, updatedAt: 0, title: 'X', horizon: 'shelf',
  kind: 'task', state: 'open', sortKey: 'a0', ...over,
});

describe('tensionOf', () => {
  it('is calm when there is no target', () => {
    expect(tensionOf(bullet({}), [], '2026-08-12').level).toBe('calm');
  });

  it('is calm when a distant target sits on a distant horizon', () => {
    const b = bullet({ deadline: '2026-12-01', horizon: 'later' });
    expect(tensionOf(b, [], '2026-08-12').level).toBe('calm');
  });

  it('is incoming when a near target has not been pulled in', () => {
    const b = bullet({ deadline: '2026-08-14', horizon: 'later' });
    expect(tensionOf(b, [], '2026-08-12').level).toBe('incoming');
  });

  it('is calm when a near target has already been pulled onto a day', () => {
    const b = bullet({ deadline: '2026-08-14', horizon: 'now' });
    const shots: Shot[] = [{
      id: 's', createdAt: 0, updatedAt: 0, bulletId: 'b',
      scope: 'day', date: '2026-08-12', state: 'open', sortKey: 'a0',
    }];
    expect(tensionOf(b, shots, '2026-08-12').level).toBe('calm');
  });

  it('is wide when the target has passed and the work is not done', () => {
    const b = bullet({ deadline: '2026-08-09', horizon: 'next' });
    expect(tensionOf(b, [], '2026-08-12').level).toBe('wide');
  });

  it('is calm when the target has passed but the work is done', () => {
    const b = bullet({ deadline: '2026-08-09', state: 'done' });
    expect(tensionOf(b, [], '2026-08-12').level).toBe('calm');
  });
});

describe('progressOf', () => {
  it('reports 0 of 1 for an untouched uncounted bullet', () => {
    expect(progressOf(bullet({}), [])).toEqual({ done: 0, total: 1 });
  });

  it('sums the amounts of completed shots', () => {
    const b = bullet({ count: { total: 20, unit: 'posts' } });
    const shots: Shot[] = [
      { id: 's1', createdAt: 0, updatedAt: 0, bulletId: 'b', scope: 'day', date: 'd', amount: 3, state: 'done', sortKey: 'a' },
      { id: 's2', createdAt: 0, updatedAt: 0, bulletId: 'b', scope: 'day', date: 'd', amount: 5, state: 'done', sortKey: 'b' },
      { id: 's3', createdAt: 0, updatedAt: 0, bulletId: 'b', scope: 'day', date: 'd', amount: 2, state: 'open', sortKey: 'c' },
    ];
    expect(progressOf(b, shots)).toEqual({ done: 8, total: 20 });
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement selectors.ts**

```ts
import { daysUntil } from '../lib/dates';
import type { Bullet, Shot } from './types';

export type Tension = { level: 'calm' | 'incoming' | 'wide'; daysLeft?: number };

/** How near the horizon has to be for a given proximity to count as "aimed at". */
const AIMED: Record<Bullet['horizon'], number> = {
  now: 0, next: 7, soon: 30, later: 9999, shelf: 9999,
};

const INCOMING_WINDOW = 3; // days

/**
 * The product's core idea: compare when it's due against when we decided to deal with it.
 * "Wide" means the target passed. "Incoming" means it's close and we haven't aimed at it.
 */
export function tensionOf(bullet: Bullet, shots: Shot[], today: string): Tension {
  if (bullet.state !== 'open' || !bullet.deadline) return { level: 'calm' };

  const daysLeft = daysUntil(today, bullet.deadline);
  if (daysLeft < 0) return { level: 'wide', daysLeft };

  const live = shots.filter(s => !s.deletedAt && s.state === 'open');
  const pulledIn = live.some(s => s.scope === 'day' || daysUntil(today, s.date) <= daysLeft);
  if (pulledIn) return { level: 'calm', daysLeft };

  if (daysLeft <= INCOMING_WINDOW && daysLeft < AIMED[bullet.horizon]) {
    return { level: 'incoming', daysLeft };
  }
  return { level: 'calm', daysLeft };
}

export function progressOf(bullet: Bullet, shots: Shot[]): { done: number; total: number } {
  const total = bullet.count?.total ?? 1;
  const done = shots
    .filter(s => !s.deletedAt && s.state === 'done')
    .reduce((sum, s) => sum + (s.amount ?? 1), 0);
  return { done: Math.min(done, total), total };
}
```

- [ ] **Step 3: Run tests, then commit**

```bash
npx vitest run src/data/selectors.test.ts
git add -A && git commit -m "feat: add tension and progress selectors"
```

---

## Task 8: Design tokens and motion presets

**Files:**
- Create: `src/design/tokens.css`, `src/design/springs.ts`
- Modify: `src/main.tsx` to import tokens

- [ ] **Step 1: Write tokens.css**

Refined and calm, per the spec. A warm near-neutral canvas; client hues supply the only saturation. Light is the bare `:root`; dark is layered so an explicit toggle can win in both directions later.

```css
@import "tailwindcss";

:root {
  color-scheme: light dark;

  /* Canvas — warm neutrals, never pure grey */
  --bg:        oklch(97.5% 0.006 85);
  --surface:   oklch(100% 0 0);
  --surface-2: oklch(95% 0.008 85);
  --line:      oklch(88% 0.008 85);

  /* Ink */
  --ink:       oklch(22% 0.012 75);
  --ink-2:     oklch(48% 0.012 75);
  --ink-3:     oklch(66% 0.010 75);

  /* Semantic — reserved almost entirely for target tension */
  --incoming:  oklch(72% 0.16 62);
  --wide:      oklch(58% 0.20 25);
  --hit:       oklch(64% 0.15 155);

  /* Form */
  --r-sm: 12px;
  --r-md: 20px;
  --r-lg: 28px;
  --r-xl: 36px;
  --tap: 56px;

  --shadow-1: 0 1px 2px oklch(0% 0 0 / 0.04), 0 2px 8px oklch(0% 0 0 / 0.04);
  --shadow-2: 0 2px 4px oklch(0% 0 0 / 0.06), 0 12px 28px oklch(0% 0 0 / 0.08);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:        oklch(16% 0.008 75);
    --surface:   oklch(21% 0.010 75);
    --surface-2: oklch(26% 0.012 75);
    --line:      oklch(32% 0.012 75);
    --ink:       oklch(96% 0.006 85);
    --ink-2:     oklch(72% 0.010 85);
    --ink-3:     oklch(54% 0.010 85);
    --incoming:  oklch(78% 0.15 62);
    --wide:      oklch(68% 0.19 25);
    --hit:       oklch(72% 0.14 155);
    --shadow-1: 0 1px 2px oklch(0% 0 0 / 0.3), 0 2px 8px oklch(0% 0 0 / 0.2);
    --shadow-2: 0 2px 4px oklch(0% 0 0 / 0.4), 0 12px 28px oklch(0% 0 0 / 0.3);
  }
}

:root[data-theme="dark"] {
  --bg:        oklch(16% 0.008 75);
  --surface:   oklch(21% 0.010 75);
  --surface-2: oklch(26% 0.012 75);
  --line:      oklch(32% 0.012 75);
  --ink:       oklch(96% 0.006 85);
  --ink-2:     oklch(72% 0.010 85);
  --ink-3:     oklch(54% 0.010 85);
  --incoming:  oklch(78% 0.15 62);
  --wide:      oklch(68% 0.19 25);
  --hit:       oklch(72% 0.14 155);
  --shadow-1: 0 1px 2px oklch(0% 0 0 / 0.3), 0 2px 8px oklch(0% 0 0 / 0.2);
  --shadow-2: 0 2px 4px oklch(0% 0 0 / 0.4), 0 12px 28px oklch(0% 0 0 / 0.3);
}

html, body, #root { height: 100%; }

body {
  background: var(--bg);
  color: var(--ink);
  font-synthesis-weight: none;
  text-rendering: optimizeLegibility;
  -webkit-tap-highlight-color: transparent;
  overscroll-behavior-y: none;
}

/* A client's hue drives one accent, set per-card via --hue. */
.client-accent { background: oklch(62% 0.15 var(--hue, 260)); }
```

- [ ] **Step 2: Write springs.ts**

The only source of motion config in the app. Duration-based easing is banned — springs are interruptible, which is what makes the UI feel like material rather than playback.

```ts
import type { Transition } from 'motion/react';

/** Snappy and confident. Default for taps, chips, and small state changes. */
export const snap: Transition = { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 };

/** Slightly softer with a hint of overshoot. Cards entering, sheets settling. */
export const settle: Transition = { type: 'spring', stiffness: 340, damping: 30, mass: 1 };

/** For shared-element zoom — must feel weighty or the transform reads as a glitch. */
export const zoom: Transition = { type: 'spring', stiffness: 280, damping: 32, mass: 1.1 };

/** Gesture release. Low stiffness so velocity carries the motion. */
export const fling: Transition = { type: 'spring', stiffness: 200, damping: 26 };

/** Respect the OS setting by collapsing everything to a fast cross-fade. */
export const reduced: Transition = { duration: 0.12 };

export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;
```

- [ ] **Step 3: Import tokens in main.tsx, verify the app renders, commit**

```bash
npm run dev   # confirm the warm canvas renders in both light and dark
git add -A && git commit -m "feat: add design tokens and spring presets"
```

---

## Task 9: Design primitives

**Files:**
- Create: `src/design/Slab.tsx`, `src/design/Sheet.tsx`, `src/design/Stepper.tsx`, `src/design/HorizonChip.tsx`, `src/design/ClientDot.tsx`, `src/design/Toast.tsx`

- [ ] **Step 1: Build Slab — the primary chunky surface**

Every tappable thing in the app is a Slab. Centralizing it is what keeps the whole UI consistent, and it's the one place press physics are defined.

```tsx
import { motion } from 'motion/react';
import { snap } from './springs';
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  onClick?: () => void;
  hue?: number;          // client accent
  tone?: 'default' | 'raised' | 'quiet';
  className?: string;
};

export function Slab({ children, onClick, hue, tone = 'default', className = '' }: Props) {
  const tones = {
    default: 'bg-[var(--surface)] shadow-[var(--shadow-1)]',
    raised:  'bg-[var(--surface)] shadow-[var(--shadow-2)]',
    quiet:   'bg-[var(--surface-2)]',
  };
  return (
    <motion.div
      onClick={onClick}
      whileTap={onClick ? { scale: 0.975 } : undefined}
      transition={snap}
      style={hue !== undefined ? ({ '--hue': hue } as React.CSSProperties) : undefined}
      className={`relative overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)]
                  ${tones[tone]} ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {hue !== undefined && (
        <span className="client-accent absolute inset-y-0 left-0 w-[6px]" aria-hidden />
      )}
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: Build Sheet with drag-to-dismiss**

Drag physics matter here — the sheet must follow the finger and dismiss on velocity, not just distance, or it feels like a web page.

```tsx
import { motion, AnimatePresence } from 'motion/react';
import { settle } from './springs';
import type { ReactNode } from 'react';

export function Sheet({ open, onClose, children }:
  { open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-[var(--r-xl)]
                       border-t border-[var(--line)] bg-[var(--surface)]
                       pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-2)]"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={settle}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            <div className="mx-auto my-3 h-1.5 w-12 rounded-full bg-[var(--ink-3)]/40" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 3: Build Stepper, HorizonChip, ClientDot, and Toast**

`Stepper.tsx` — giant +/- slabs, no text input, used when pulling a portion of a counted bullet:
```tsx
import { motion } from 'motion/react';
import { snap } from './springs';

export function Stepper({ value, max, onChange }:
  { value: number; max: number; onChange: (n: number) => void }) {
  const btn = `flex h-20 w-20 items-center justify-center rounded-[var(--r-md)]
               bg-[var(--surface-2)] text-4xl font-semibold text-[var(--ink)]
               disabled:opacity-30`;
  return (
    <div className="flex items-center justify-center gap-6">
      <motion.button className={btn} whileTap={{ scale: 0.9 }} transition={snap}
        disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}>−</motion.button>
      <div className="min-w-24 text-center text-7xl font-bold tabular-nums">{value}</div>
      <motion.button className={btn} whileTap={{ scale: 0.9 }} transition={snap}
        disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</motion.button>
    </div>
  );
}
```

`HorizonChip.tsx`:
```tsx
import { HORIZON_META, type Horizon } from '../data/types';

export function HorizonChip({ horizon, size = 'md' }:
  { horizon: Horizon; size?: 'sm' | 'md' }) {
  const meta = HORIZON_META[horizon];
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)]
                      font-semibold tracking-wide text-[var(--ink-2)] ${pad}`}>
      <span aria-hidden>{meta.emoji}</span>{meta.label}
    </span>
  );
}
```

`ClientDot.tsx`:
```tsx
export function ClientDot({ hue, name }: { hue: number; name?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-[var(--ink-2)]">
      <span className="h-2.5 w-2.5 rounded-full"
            style={{ background: `oklch(62% 0.15 ${hue})` }} aria-hidden />
      {name}
    </span>
  );
}
```

`Toast.tsx` — the undo affordance that lets completion be confirmation-free:
```tsx
import { motion, AnimatePresence } from 'motion/react';
import { settle } from './springs';

export function Toast({ message, actionLabel, onAction, onDismiss }: {
  message: string; actionLabel?: string; onAction?: () => void; onDismiss: () => void;
}) {
  return (
    <AnimatePresence onExitComplete={onDismiss}>
      <motion.div
        className="fixed inset-x-4 bottom-24 z-50 flex items-center justify-between gap-4
                   rounded-[var(--r-md)] bg-[var(--ink)] px-5 py-4 text-[var(--bg)]
                   shadow-[var(--shadow-2)]"
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }} transition={settle}
      >
        <span className="font-medium">{message}</span>
        {actionLabel && (
          <button className="font-bold uppercase tracking-wide" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add chunky design primitives"
```

---

## Task 10: Netlify backend — migration, auth, sync

**Files:**
- Create: `netlify/database/migrations/0001_ops.sql`, `netlify/functions/auth.mts`, `netlify/functions/sync.mts`

- [ ] **Step 1: Write the migration**

```sql
create table if not exists ops (
  seq        bigserial primary key,
  op_id      text unique not null,
  entity     text not null,
  entity_id  text not null,
  field      text not null,
  value      jsonb,
  ts         bigint not null,
  actor      text not null,
  created_at timestamptz not null default now()
);

create index if not exists ops_seq_idx on ops (seq);
create index if not exists ops_entity_idx on ops (entity, entity_id);

create table if not exists presence (
  person     text primary key,
  context    text,
  seen_at    timestamptz not null default now()
);
```

- [ ] **Step 2: Write auth.mts**

Two users, no signup. A shared passphrase plus a chosen identity mints a signed bearer token. Tokens are bearer rather than cookie specifically because Capacitor serves from `https://localhost`, making every call cross-site.

```ts
import type { Config, Context } from '@netlify/functions';

const enc = new TextEncoder();

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${payload}.${b64}`;
}

export async function verify(token: string): Promise<string | null> {
  const secret = process.env.BULLETS_SECRET!;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const payload = token.slice(0, idx);
  const expected = await sign(payload, secret);
  return expected === token ? payload : null;
}

export default async (req: Request, _context: Context) => {
  const { passphrase, person } = await req.json();
  if (passphrase !== process.env.BULLETS_PASSPHRASE) {
    return new Response('nope', { status: 401 });
  }
  if (person !== 'clark' && person !== 'angie') {
    return new Response('unknown person', { status: 400 });
  }
  return Response.json({ token: await sign(person, process.env.BULLETS_SECRET!), person });
};

export const config: Config = { path: '/api/auth', method: 'POST' };
```

- [ ] **Step 3: Write sync.mts — push and pull in one round trip**

Combining directions halves latency on the live board and makes the offline story trivial: the outbox drains with no special-case code.

```ts
import { getDatabase } from '@netlify/database';
import type { Config, Context } from '@netlify/functions';
import { verify } from './auth.mts';

export default async (req: Request, _context: Context) => {
  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const person = await verify(token);
  if (!person) return new Response('unauthorized', { status: 401 });

  const { since = 0, ops = [], context: ctx } = await req.json();
  const db = getDatabase();

  if (ops.length) {
    // on conflict do nothing makes retries idempotent — the client can resend freely.
    await db.sql`
      insert into ops (op_id, entity, entity_id, field, value, ts, actor)
      select * from unnest(
        ${ops.map((o: any) => o.opId)}::text[],
        ${ops.map((o: any) => o.entity)}::text[],
        ${ops.map((o: any) => o.entityId)}::text[],
        ${ops.map((o: any) => o.field)}::text[],
        ${ops.map((o: any) => JSON.stringify(o.value ?? null))}::jsonb[],
        ${ops.map((o: any) => o.ts)}::bigint[],
        ${ops.map((o: any) => o.actor)}::text[]
      )
      on conflict (op_id) do nothing
    `;
  }

  if (ctx) {
    await db.sql`
      insert into presence (person, context, seen_at) values (${person}, ${ctx}, now())
      on conflict (person) do update set context = excluded.context, seen_at = now()
    `;
  }

  const rows = await db.sql`
    select seq, op_id, entity, entity_id, field, value, ts, actor
    from ops where seq > ${since} order by seq asc limit 2000
  `;

  const here = await db.sql`
    select person from presence
    where context = ${ctx ?? ''} and seen_at > now() - interval '15 seconds'
  `;

  return Response.json({
    seq: rows.length ? Number(rows[rows.length - 1].seq) : since,
    ops: rows.map((r: any) => ({
      opId: r.op_id, entity: r.entity, entityId: r.entity_id,
      field: r.field, value: r.value, ts: Number(r.ts), actor: r.actor,
    })),
    presence: here.map((r: any) => r.person),
  });
};

export const config: Config = { path: '/api/sync', method: 'POST' };
```

- [ ] **Step 4: Verify locally and commit**

```bash
npm run dev
curl -s localhost:5173/api/auth -X POST -H 'content-type: application/json' \
  -d '{"passphrase":"test","person":"clark"}'
git add -A && git commit -m "feat: add op log migration, auth, and sync endpoint"
```

---

## Task 11: Sync client with adaptive cadence

**Files:**
- Create: `src/sync/auth.ts`, `src/sync/client.ts`
- Test: `src/sync/client.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/sync/client.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../data/db';
import { syncOnce, setPace, currentInterval } from './client';
import { enqueue } from '../data/outbox';

beforeEach(async () => {
  await Promise.all([db.outbox.clear(), db.bullets.clear(), db.meta.clear()]);
});

describe('sync client', () => {
  it('drains the outbox and applies returned ops', async () => {
    await enqueue([{ opId: 'a', entity: 'bullet', entityId: 'b1',
                     field: 'title', value: 'Local', ts: 1, actor: 'clark' }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      seq: 7,
      ops: [{ opId: 'r', entity: 'bullet', entityId: 'b2',
              field: 'title', value: 'Remote', ts: 2, actor: 'angie' }],
      presence: [],
    }))));

    await syncOnce();

    expect(await db.outbox.count()).toBe(0);
    expect((await db.bullets.get('b2'))!.title).toBe('Remote');
  });

  it('keeps the outbox intact when the request fails', async () => {
    await enqueue([{ opId: 'a', entity: 'bullet', entityId: 'b1',
                     field: 'title', value: 'Local', ts: 1, actor: 'clark' }]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    await syncOnce().catch(() => {});
    expect(await db.outbox.count()).toBe(1);
  });

  it('polls fast while a live board is open and slowly otherwise', () => {
    setPace('idle');
    const idle = currentInterval();
    setPace('live');
    expect(currentInterval()).toBeLessThan(idle);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

`src/sync/auth.ts`:
```ts
import type { Person } from '../data/types';

const TOKEN = 'bullets.token';
const PERSON = 'bullets.person';

export const getToken = () => localStorage.getItem(TOKEN);
export const getPerson = () => localStorage.getItem(PERSON) as Person | null;

export async function signIn(passphrase: string, person: Person): Promise<boolean> {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase, person }),
  });
  if (!res.ok) return false;
  const { token } = await res.json();
  localStorage.setItem(TOKEN, token);
  localStorage.setItem(PERSON, person);
  return true;
}

export function signOut() {
  localStorage.removeItem(TOKEN);
  localStorage.removeItem(PERSON);
}
```

`src/sync/client.ts`:
```ts
import { db } from '../data/db';
import { applyLocal } from '../data/mutations';
import { pending, ack } from '../data/outbox';
import { getToken } from './auth';
import type { Op } from '../data/ops';

/**
 * Your own edits never wait on any of this — they apply locally and optimistically.
 * The pace only governs how fast you see the OTHER person's changes.
 */
export type Pace = 'live' | 'idle';
const INTERVAL: Record<Pace, number> = { live: 1_500, idle: 15_000 };

let pace: Pace = 'idle';
let context: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let presentPeople: string[] = [];

export const currentInterval = () => INTERVAL[pace];
export const presence = () => presentPeople;

/** Views call this on mount/unmount. A live huddle board sets 'live'. */
export function setPace(next: Pace, ctx: string | null = null) {
  pace = next;
  context = ctx;
  if (next === 'live') void syncOnce();
  schedule();
}

async function cursor(): Promise<number> {
  return ((await db.meta.get('cursor'))?.value as number) ?? 0;
}

export async function syncOnce(): Promise<void> {
  const token = getToken();
  if (!token) return;

  const outgoing = await pending();
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ since: await cursor(), ops: outgoing, context }),
  });
  if (!res.ok) throw new Error(`sync failed: ${res.status}`);

  const { seq, ops, presence: here } = await res.json() as
    { seq: number; ops: Op[]; presence: string[] };

  if (ops.length) await applyLocal(ops);
  await db.meta.put({ key: 'cursor', value: seq });
  // Ack by explicit id so anything enqueued mid-flight survives.
  if (outgoing.length) await ack(outgoing.map(o => o.opId));
  presentPeople = here ?? [];
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try { await syncOnce(); } catch { /* offline is normal; the outbox holds */ }
    schedule();
  }, currentInterval());
}

export function startSync() {
  schedule();
  addEventListener('focus', () => { void syncOnce(); });
  addEventListener('online', () => { void syncOnce(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncOnce();
  });
}
```

- [ ] **Step 3: Run tests, then commit**

```bash
npx vitest run src/sync/client.test.ts
git add -A && git commit -m "feat: add sync client with adaptive cadence"
```

---

## Task 12: Today, Week, and Shelf views

**Files:**
- Create: `src/data/store.ts`, `src/views/Today/TodayView.tsx`, `src/views/Today/ShotCard.tsx`, `src/views/Week/WeekView.tsx`, `src/views/Shelf/ShelfView.tsx`, `src/views/Capture/CaptureSheet.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write store.ts — live queries over Dexie**

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { clean } from './ops';
import type { Bullet, Client, Huddle, HuddleItem, Shot } from './types';
import { weekStart } from '../lib/dates';

const alive = <T extends { deletedAt?: number }>(rows: T[]) => rows.filter(r => !r.deletedAt);

export function useShotsOn(date: string) {
  return useLiveQuery(async () => {
    const shots = alive(await db.shots.where('[scope+date]').equals(['day', date]).toArray());
    const bullets = await db.bullets.bulkGet(shots.map(s => (s as any).bulletId));
    return shots.map((s, i) => ({
      shot: clean<Shot>(s),
      bullet: bullets[i] ? clean<Bullet>(bullets[i]!) : undefined,
    })).filter(r => r.bullet && r.bullet.state !== 'dropped');
  }, [date], []);
}

export function useWeekShots(day: string) {
  const start = weekStart(day);
  return useLiveQuery(async () => {
    const shots = alive(await db.shots.where('[scope+date]').equals(['week', start]).toArray());
    const bullets = await db.bullets.bulkGet(shots.map(s => (s as any).bulletId));
    return shots.map((s, i) => ({
      shot: clean<Shot>(s),
      bullet: bullets[i] ? clean<Bullet>(bullets[i]!) : undefined,
    })).filter(r => r.bullet);
  }, [start], []);
}

export function useShelf() {
  return useLiveQuery(async () => {
    const all = alive(await db.bullets.toArray()).map(b => clean<Bullet>(b));
    return all.filter(b => (b.horizon === 'shelf' || b.horizon === 'later') && b.state === 'open');
  }, [], []);
}

export const useClients = () =>
  useLiveQuery(async () => alive(await db.clients.toArray()).map(c => clean<Client>(c)), [], []);

export const useBullet = (id?: string) =>
  useLiveQuery(async () => (id ? await db.bullets.get(id) : undefined), [id]);

export const useShotsFor = (bulletId?: string) =>
  useLiveQuery(async () => bulletId
    ? alive(await db.shots.where('bulletId').equals(bulletId).toArray()).map(s => clean<Shot>(s))
    : [], [bulletId], []);
```

- [ ] **Step 2: Build ShotCard with swipe-to-hit**

Completion is a full-width swipe or a slab-sized tap. Transform and opacity only, so it stays on the compositor at 120Hz.

```tsx
import { motion, useMotionValue, useTransform } from 'motion/react';
import { fling, snap } from '../../design/springs';
import { Slab } from '../../design/Slab';
import { ClientDot } from '../../design/ClientDot';
import { completeShot } from '../../data/mutations';
import { tensionOf } from '../../data/selectors';
import type { Bullet, Client, Shot } from '../../data/types';

export function ShotCard({ shot, bullet, client, today }: {
  shot: Shot; bullet: Bullet; client?: Client; today: string;
}) {
  const x = useMotionValue(0);
  const bg = useTransform(x, [0, 140], ['var(--surface)', 'var(--hit)']);
  const tension = tensionOf(bullet, [shot], today);
  const done = shot.state === 'done';

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.6 }}
      style={{ x }}
      transition={fling}
      onDragEnd={(_, info) => {
        if (info.offset.x > 140 || info.velocity.x > 700) void completeShot(shot.id);
      }}
    >
      <Slab hue={client?.hue} tone={done ? 'quiet' : 'default'}>
        <motion.div style={{ background: bg }} className="px-6 py-7 pl-8">
          <div className={`text-2xl font-semibold leading-tight
                           ${done ? 'text-[var(--ink-3)] line-through' : 'text-[var(--ink)]'}`}>
            {bullet.title}
          </div>
          <div className="mt-3 flex items-center gap-4">
            {client && <ClientDot hue={client.hue} name={client.name} />}
            {shot.amount && bullet.count && (
              <span className="text-sm font-medium text-[var(--ink-2)]">
                {shot.amount} of {bullet.count.total} {bullet.count.unit}
              </span>
            )}
            {tension.level === 'incoming' && (
              <span className="text-sm font-bold" style={{ color: 'var(--incoming)' }}>
                Incoming — {tension.daysLeft}d
              </span>
            )}
            {tension.level === 'wide' && (
              <span className="text-sm font-bold" style={{ color: 'var(--wide)' }}>Wide</span>
            )}
          </div>
        </motion.div>
      </Slab>
    </motion.div>
  );
}
```

- [ ] **Step 3: Build TodayView, WeekView, ShelfView, and CaptureSheet**

TodayView is a single column of ShotCards with the Incoming banner above, rendered only when it has something to say. WeekView stacks seven day blocks on mobile and switches to a seven-column grid on desktop behind an explicit toggle (not a breakpoint). ShelfView groups by client with collapsed-by-default headers. CaptureSheet is title, client, horizon, optional target and count — nothing else.

- [ ] **Step 4: Verify by hand and commit**

```bash
npm run dev   # create a bullet, pull it to today, swipe to hit it
git add -A && git commit -m "feat: add Today, Week, and Shelf views"
```

---

## Task 13: The Pull ritual and bullet zoom

**Files:**
- Create: `src/views/Pull/PullDeck.tsx`, `src/views/Pull/PullCard.tsx`, `src/views/Bullet/BulletZoom.tsx`

- [ ] **Step 1: Build PullCard — a velocity-aware swipe deck**

Right pulls in, left pushes the horizon out, up shelves. One card at a time, giant type, no lists.

```tsx
import { motion, useMotionValue, useTransform } from 'motion/react';
import { fling } from '../../design/springs';

export type PullChoice = 'in' | 'out' | 'shelf';

export function PullCard({ children, onChoose }: {
  children: React.ReactNode; onChoose: (c: PullChoice) => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-12, 12]);
  const inGlow = useTransform(x, [40, 200], [0, 1]);
  const outGlow = useTransform(x, [-200, -40], [1, 0]);

  return (
    <motion.div
      drag
      dragElastic={0.5}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      style={{ x, y, rotate }}
      transition={fling}
      onDragEnd={(_, info) => {
        const { offset, velocity } = info;
        if (offset.y < -160 || velocity.y < -800) return onChoose('shelf');
        if (offset.x > 140 || velocity.x > 700) return onChoose('in');
        if (offset.x < -140 || velocity.x < -700) return onChoose('out');
      }}
      className="relative touch-none"
    >
      <motion.div style={{ opacity: inGlow }}
        className="pointer-events-none absolute inset-0 rounded-[var(--r-xl)] ring-4"
        // ring color set inline to keep it off the animated property list
      />
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: Build PullDeck for both rituals**

Weekly Pull draws from `shelf`, `later`, `soon`, plus anything with a target inside three weeks. Daily Pull draws from this week's shots. For a counted bullet, choosing `in` opens the Stepper before committing. Both end on a summary card listing what was committed and what the tension selector flags as at risk.

- [ ] **Step 3: Build BulletZoom with a shared-element transition**

The card physically becomes the detail view via a shared `layoutId`, rather than navigating. Count progress renders as discrete blocks, never a percentage bar.

```tsx
import { motion } from 'motion/react';
import { zoom } from '../../design/springs';
import { progressOf } from '../../data/selectors';

export function BulletZoom({ bullet, shots, onClose }: any) {
  const { done, total } = progressOf(bullet, shots);
  return (
    <motion.div layoutId={`bullet-${bullet.id}`} transition={zoom}
      drag="y" dragConstraints={{ top: 0, bottom: 0 }}
      onDragEnd={(_: any, i: any) => { if (i.offset.y > 120) onClose(); }}
      className="fixed inset-0 z-50 overflow-y-auto bg-[var(--surface)] p-6">
      <motion.h1 layout className="text-4xl font-bold leading-tight">{bullet.title}</motion.h1>
      {bullet.count && (
        <div className="mt-6 flex flex-wrap gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className="h-6 w-6 rounded-md"
              style={{ background: i < done ? 'var(--hit)' : 'var(--surface-2)' }} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 4: Verify on a touch device and commit**

```bash
git add -A && git commit -m "feat: add the Pull ritual and bullet zoom"
```

---

## Task 14: Huddles and the live shared board

**Files:**
- Create: `src/views/Huddle/HuddleList.tsx`, `src/views/Huddle/RequestSheet.tsx`, `src/views/Huddle/HuddleBoard.tsx`, `src/views/Huddle/ResponseBar.tsx`
- Modify: `src/data/mutations.ts` to add huddle mutations

- [ ] **Step 1: Add huddle mutations**

Scheduling auto-confirms. There is no pending state and no accept step — we're married, and the friction we're removing is the surprise, not the meeting.

```ts
import type { Huddle, HuddleItem, Person } from './types';

export async function callHuddle(init: {
  startsAt: number; durationMin?: number; title?: string; calledBy: Person;
}): Promise<string> {
  const id = newId();
  const other: Person = init.calledBy === 'clark' ? 'angie' : 'clark';
  await mutate('huddle', id, {
    startsAt: init.startsAt,
    durationMin: init.durationMin ?? 30,
    calledBy: init.calledBy,
    status: 'scheduled',
    ...(init.title ? { title: init.title } : {}),
    // Auto-confirmed for both sides. The other person can still change it.
    responses: {
      [init.calledBy]: { status: 'in', at: Date.now() },
      [other]:         { status: 'in', at: Date.now() },
    },
  });
  return id;
}

export async function respondToHuddle(
  huddleId: string, person: Person,
  response: { status: 'in' | 'nudge' | 'out'; note?: string; proposedAt?: number },
): Promise<void> {
  const h = await db.huddles.get(huddleId) as Huddle | undefined;
  if (!h) return;
  await mutate('huddle', huddleId, {
    responses: { ...h.responses, [person]: { ...response, at: Date.now() } },
  });
}

export async function addHuddleItem(
  huddleId: string, init: { bulletId?: string; text?: string; addedBy: Person },
): Promise<string> {
  const id = newId();
  const last = await db.huddleItems.orderBy('sortKey').last();
  await mutate('huddleItem', id, {
    huddleId, lane: 'table', addedBy: init.addedBy,
    sortKey: keyAtEnd(last?.sortKey as string ?? null),
    ...(init.bulletId ? { bulletId: init.bulletId } : {}),
    ...(init.text ? { text: init.text } : {}),
  });
  return id;
}

/** A single-field op, which is what makes concurrent lane moves conflict-safe. */
export const decideItem = (itemId: string, decision: string) =>
  mutate('huddleItem', itemId, { lane: 'decided', decision });

export const undecideItem = (itemId: string) =>
  mutate('huddleItem', itemId, { lane: 'table' });

/** Decisions must survive the meeting, so they land on the linked bullets. */
export async function wrapHuddle(huddleId: string): Promise<void> {
  const h = await db.huddles.get(huddleId) as Huddle | undefined;
  if (!h) return;
  const items = (await db.huddleItems.where('huddleId').equals(huddleId).toArray())
    .filter(i => !i.deletedAt) as unknown as HuddleItem[];
  const stamp = new Date(h.startsAt).toISOString().slice(0, 10);

  for (const item of items) {
    if (item.lane !== 'decided' || !item.bulletId || !item.decision) continue;
    const b = await db.bullets.get(item.bulletId);
    if (!b) continue;
    const prior = (b as any).note ? `${(b as any).note}\n\n` : '';
    await mutate('bullet', item.bulletId, {
      note: `${prior}Huddle ${stamp}: ${item.decision}`,
    });
  }
  await mutate('huddle', huddleId, { status: 'done' });
}
```

- [ ] **Step 2: Build HuddleBoard — the two-screen live surface**

The board sets sync pace to `live` on mount and back to `idle` on unmount. Items animate between lanes on both devices via shared `layoutId`, so a move Angie makes materializes on Clark's screen as motion rather than a repaint.

```tsx
import { useEffect, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { setPace, presence } from '../../sync/client';
import { settle } from '../../design/springs';
import { decideItem, undecideItem } from '../../data/mutations';

export function HuddleBoard({ huddleId, items }: { huddleId: string; items: any[] }) {
  const [deciding, setDeciding] = useState<string | null>(null);

  useEffect(() => {
    setPace('live', `huddle:${huddleId}`);
    return () => setPace('idle', null);
  }, [huddleId]);

  const table = items.filter(i => i.lane === 'table');
  const decided = items.filter(i => i.lane === 'decided');
  const others = presence().filter(p => p !== localStorage.getItem('bullets.person'));

  return (
    <LayoutGroup>
      {others.length > 0 && (
        <div className="px-6 py-2 text-sm font-medium text-[var(--ink-2)]">
          {others[0] === 'angie' ? 'Angie' : 'Clark'} is here
        </div>
      )}

      <Lane title="ON THE TABLE">
        <AnimatePresence mode="popLayout">
          {table.map(item => (
            <motion.div key={item.id} layoutId={`hi-${item.id}`} layout transition={settle}
              onClick={() => setDeciding(item.id)}>
              <ItemCard item={item} />
            </motion.div>
          ))}
        </AnimatePresence>
      </Lane>

      <Lane title="DECIDED">
        <AnimatePresence mode="popLayout">
          {decided.map(item => (
            <motion.div key={item.id} layoutId={`hi-${item.id}`} layout transition={settle}
              onClick={() => undecideItem(item.id)}>
              <ItemCard item={item} showDecision />
            </motion.div>
          ))}
        </AnimatePresence>
      </Lane>

      {deciding && (
        <DecisionSheet
          onSave={(text: string) => { void decideItem(deciding, text); setDeciding(null); }}
          onClose={() => setDeciding(null)}
        />
      )}
    </LayoutGroup>
  );
}
```

- [ ] **Step 3: Build RequestSheet and ResponseBar**

RequestSheet offers giant time presets (in an hour, this afternoon, tomorrow 10am, tomorrow 2pm) plus agenda item picking from any client's bullets. ResponseBar shows three slabs — **In** (already the default), **Nudge** (opens a time picker plus note), **Can't** (requires a note, because a bare decline is what makes scheduling feel adversarial).

- [ ] **Step 4: Verify two-screen behavior**

Open the same huddle in two browser profiles. Move an item in one; confirm it animates in the other within ~2 seconds and that the presence line appears.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add huddles with the live shared board"
```

---

## Task 15: Snapshot compaction and AI functions

**Files:**
- Create: `netlify/functions/snapshot.mts`, `netlify/functions/compact.mts`, `netlify/functions/ai-braindump.mts`, `netlify/functions/ai-huddle-wrap.mts`

- [ ] **Step 1: Write compact.mts — a scheduled function writing to Blobs**

Replaying the full log on a fresh device gets slow eventually. The log is never truncated; it stays our free history substrate.

```ts
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';

export default async () => {
  const db = getDatabase();
  const rows = await db.sql`
    select seq, op_id, entity, entity_id, field, value, ts, actor from ops order by seq asc
  `;
  const seq = rows.length ? Number(rows[rows.length - 1].seq) : 0;
  await getStore('bullets-snapshots').setJSON('latest', {
    seq,
    ops: rows.map((r: any) => ({
      opId: r.op_id, entity: r.entity, entityId: r.entity_id,
      field: r.field, value: r.value, ts: Number(r.ts), actor: r.actor,
    })),
  });
  return new Response('ok');
};

export const config: Config = { schedule: '@daily' };
```

- [ ] **Step 2: Write ai-braindump.mts**

The Netlify AI Gateway injects `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` automatically, so the bare constructor works with no key management anywhere.

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '@netlify/functions';
import { verify } from './auth.mts';

const anthropic = new Anthropic();

export default async (req: Request) => {
  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (!(await verify(token))) return new Response('unauthorized', { status: 401 });

  const { text, clients, today } = await req.json();

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    system:
      `Turn a messy brain dump into structured to-do bullets for a two-person agency.\n` +
      `Today is ${today}. Known clients: ${clients.map((c: any) => c.name).join(', ')}.\n` +
      `Horizons: now (urgent today), next (this week), soon (this month), later (distant), shelf (undecided).\n` +
      `Default to shelf when the text gives no timing signal. Only set a deadline the text actually states.\n` +
      `Use count for repeated work, e.g. "20 TikToks" -> count {total:20, unit:"posts"}.\n` +
      `Reply with JSON only: {"bullets":[{"title","clientName"?,"horizon","deadline"?,"count"?}]}`,
    messages: [{ role: 'user', content: text }],
  });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{"bullets":[]}';
  return new Response(raw.replace(/^```json\n?|\n?```$/g, ''), {
    headers: { 'content-type': 'application/json' },
  });
};

export const config: Config = {
  path: '/api/ai/braindump',
  method: 'POST',
  rateLimit: { windowSize: 60, windowLimit: 10 },
};
```

Results land in a review sheet where each proposed bullet is swiped to accept or discard. Nothing is created without confirmation, and any failure is silent — the app is fully functional with AI disabled.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add snapshot compaction and AI assist functions"
```

---

## Task 16: Sign-in, shell, and deploy

**Files:**
- Create: `src/views/SignIn.tsx`, `public/manifest.webmanifest`
- Modify: `src/App.tsx`

- [ ] **Step 1: Build SignIn**

A shared passphrase, then two large faces — tap yours. No email, no accounts.

- [ ] **Step 2: Build the app shell**

Bottom tab bar with four giant targets: Today, Week, Shelf, Huddles. A floating capture button. `startSync()` fires on mount.

- [ ] **Step 3: Set Netlify env vars and deploy**

```bash
netlify env:set BULLETS_PASSPHRASE "<chosen phrase>"
netlify env:set BULLETS_SECRET "$(openssl rand -hex 32)"
netlify deploy --build --prod
```

- [ ] **Step 4: Verify the deployed app end to end**

Sign in as Clark in one browser and Angie in another. Create a bullet in one and confirm it appears in the other within ~15 seconds; open a huddle in both and confirm lane moves cross in ~2 seconds.

- [ ] **Step 5: Commit and tag**

```bash
git add -A && git commit -m "feat: add sign-in and app shell"
git tag web-v1
```

---

## Self-Review

**Spec coverage.** Horizons → Task 3. Bullets with counts and nesting → Tasks 3, 6. Shots → Tasks 3, 6. Target-vs-horizon tension → Task 7. Today/Week/Shelf → Task 12. Both Pull rituals → Task 13. Bullet zoom → Task 13. Huddles, live board, decisions flowing back → Task 14. Op-log sync, field LWW, snapshot, adaptive polling → Tasks 4, 5, 10, 11, 15. Auth → Tasks 10, 11, 16. Design system → Tasks 8, 9. AI → Task 15. Clients → Tasks 3, 12.

**Gap found and closed:** the spec's Android notifications, widget, and CI are deliberately absent here — they live in the companion Android plan, which depends on Task 16's deployed build.

**Known deferrals, consistent with the spec's v1 boundaries:** recurring bullets, attachments, ICS export, undo history UI, and search are all out of scope.

**Type consistency check:** `Shot` (not `Chunk`) throughout. `mutate()` signature is `(entity, entityId, patch)` in Tasks 6 and 14. `applyLocal()` is used by both `mutate()` in Task 6 and the sync client in Task 11. `tensionOf(bullet, shots, today)` and `progressOf(bullet, shots)` match between Tasks 7, 12, and 13. `setPace(pace, context)` matches between Tasks 11 and 14.
