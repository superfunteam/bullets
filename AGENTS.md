# Bullets — working notes for agents

> **Bullets** — *No more dodging.* A two-person, deadline-first bullet journal
> for Clark and Angie at Superfun. Web on Netlify, plus a sideloaded Android APK.

Read this before changing anything. It is written for the next agent, and it is
mostly a list of things that have already gone wrong here.

---

## Orientation in 60 seconds

```
src/lib/        pure helpers — dates, ids, fractional sort keys
src/data/       the local-first core: types, op log, Dexie, mutations, selectors
src/sync/       api base, auth, the adaptive polling loop
src/design/     tokens, spring presets, chunky primitives, text-scale detection
src/views/      one file per screen
src/native/     Capacitor-only: widget payload, local notifications, self-update
netlify/functions/  sync, auth, snapshot, scheduled compaction, AI assist
netlify/lib/        shared helpers (auth signing, CORS) — NOT deployed as functions
```

```bash
npm run dev        # Vite
npm test           # Vitest — keep it green, it has caught real data corruption
npm run typecheck  # tsc --noEmit
npm run build
```

Ship a release: bump `package.json`, commit, tag `vX.Y.Z`, push. GitHub Actions
builds a signed APK onto Releases; Netlify deploys the web from `main`.

---

## The product idea, because it constrains the code

Every tracker collapses "when it's due" and "when I decided to deal with it"
into one date field, which is why they all rot into a wall of overdue red.
Bullets keeps them separate:

- **target** — `bullet.deadline`. External, immovable.
- **horizon** — `NOW / NEXT / SOON / LATER / SHELF`. Internal, revisable.

`tensionOf()` in `data/selectors.ts` compares them. That function is the
product. Be careful with it.

**Vocabulary is not decoration.** A *shot* is one go at a bullet on a day or
week. Completing is a **hit**. A passed target is **wide**, never "overdue".
Dropping is **calling it off**, never "deleting". The register is target
shooting, not firearms. Match it in UI copy.

---

## Four rules that are load-bearing

**1. Only `data/mutations.ts` writes.** A view calling `db.bullets.put()`
directly skips the op log: the change shows locally, never syncs, and the two
devices diverge with no error anywhere. Add a named function to `mutations.ts`
instead.

**2. Only `design/springs.ts` configures motion.** Duration easing is banned —
springs are interruptible, which is what makes it feel like material. Animate
**transform and opacity only**. Anything animating layout/width/height/color
per-frame drops off the compositor.

**3. Never fail silently.** This app once went a full day never syncing once
while looking perfectly healthy, because every failure was caught and
discarded. If something can break, it must be able to say so — see `SyncPip`.

**4. Verify on the platform the code actually runs on.** The sync bug below
passed every web test. Web and APK are different environments.

---

## Traps that have already bitten, in order of nastiness

**Relative API URLs break the APK.** Capacitor serves from `https://localhost`,
so `fetch('/api/sync')` hits an origin with no server. Always go through
`sync/api.ts`. Any new function also needs CORS + an `OPTIONS` preflight from
`netlify/lib/http.mts`, or the device's request is never even sent.

**Horizon alone does not put a bullet on the calendar.** Every calendar view
renders *shots*. A bullet with `horizon: 'now'` and no shot is invisible in
Today, Week and Shelf simultaneously. `createBullet` now creates the matching
shot for `now`/`next`. If you add another committing horizon, do the same.

**Clock skew between devices.** `mutations.ts` uses a hybrid logical clock that
absorbs every timestamp it sees, local or remote. Without it, one phone running
slightly fast permanently poisons a field: later edits from the other phone
carry a smaller `ts`, lose the comparison, and are discarded on both devices.
Never stamp an op with a bare `Date.now()`.

**Read-modify-write on a shared object loses data.** Huddle responses are two
independent fields (`responseClark`, `responseAngie`) because a combined map
meant last-write-wins erased the other person's reply. Same shape, same bug,
anywhere else you are tempted to spread-and-overwrite.

**`bigserial` allocates before commit.** A reader can see `seq` 503 while
500–502 are uncommitted and skip them forever. `sync.mts` re-delivers a 30s
window; re-delivery is free because `applyOp` is idempotent. Don't "optimize"
that away.

**Dexie indexes are runtime, not compile time.** Any field used in `.where()` or
`.orderBy()` must be in the schema string in `db.ts` or it throws `SchemaError`
in production. `tsc` will not save you.

**Drag and scroll on the same element.** `drag="y"` + `overflow-y-auto` means
Motion captures the pointer and the content never scrolls. Use
`design/useDismissDrag.ts`.

**Duplicate `layoutId`.** A bullet can hold two shots on one day. Two elements
claiming one `layoutId` makes Motion pick a lead at random. Pass `zoomId` so
exactly one card owns the shared element.

**Unlayered CSS beats Tailwind utilities.** Tailwind v4 emits utilities inside
cascade layers, and unlayered rules win regardless of specificity. Element
resets in `tokens.css` must stay inside `@layer base`.

**Angie runs a large system font.** Honour it; never pin the text zoom. Layouts
reflow via `data-text-scale` on `<html>` (see `design/textScale.ts`) by dropping
decorative labels, **never** by shrinking touch targets. Test at 200%.

---

## Testing expectations

`src/data/` and `src/sync/` are where a bug silently corrupts or loses user
data. They get real tests, including adversarial cases: out-of-order ops,
duplicate delivery, clock skew, mid-flight enqueues, paged pulls.

The convergence test in `ops.test.ts` — folding a batch in three different
orders — has already caught a real bug. **If you touch `applyOp`, that is the
test that matters.**

Views are verified by hand. Motion and visual polish are not worth automating,
but *do* check the browser, and check both themes and both text scales.

---

## Things that are deliberate, not oversights

- **No password.** Tapping a face is identity, not a gate. The space is
  knowingly open; see the README. Don't "fix" this without asking.
- **Capture defaults to the Shelf.** Bullet journaling is capture-now,
  decide-later. It confirms where it landed rather than changing the default.
- **The server has no entity tables**, only an ordered op log, and it never
  interprets a value. That is what lets new entity types ship with no migration
  and no deploy coordination between two independently-updating clients.
- **Soft delete only.** A hard delete loses the tombstone and the row
  resurrects from the other device.
- **Polling, not WebSockets.** Netlify Functions can't hold sockets and cap
  streaming at 60s. Two users at a 1.5s live cadence is indistinguishable from
  realtime.

---

## Where the reasoning lives

- `docs/architecture.md` — how the sync layer works and how to extend it
- `docs/superpowers/specs/2026-08-12-bullets-design.md` — the original design,
  including a section marked as revised when research contradicted it
- `docs/android-signing.md`, `docs/firebase-setup.md` — the native setup

Commit messages here explain *why*, including what broke. They are worth
reading before changing the module they touch.
