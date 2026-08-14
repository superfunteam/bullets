# Bullets — working notes for agents

> **Bullets** — *No more dodging.* A two-person, deadline-first bullet journal
> for Clark and Angie at Superfun. **Three targets from one React app**: web on
> Netlify, a sideloaded Android APK (Capacitor), and a macOS menu-bar app
> (Electron).

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
src/native/     platform code: widget payload, notifications, self-update.
                Branches on Capacitor.isNativePlatform() vs window.bulletsDesktop.
electron/       macOS main process, preload bridge, tray
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

**The tag is not optional, and forgetting it fails silently.** Netlify deploys
the web the moment a commit lands on `main`; the APK is built ONLY by a `v*`
tag. Skip the tag and the web moves on while the phone stays behind, with
nothing anywhere reporting it — the web ran 1.6.1 for a day while the APK sat
at 1.6.0 and the only signal was Clark noticing. CI now emits a warning
annotation when `main`'s `package.json` version has no matching tag.

---

## The product idea, because it constrains the code

Every tracker collapses "when it's due" and "when I decided to deal with it"
into one date field, which is why they all rot into a wall of overdue red.
Bullets keeps them separate:

- **target** — `bullet.deadline`. External, immovable.
- **horizon** — `NOW / NEXT / SOON / LATER / SHELF`. Internal, revisable.

`tensionOf()` in `data/selectors.ts` compares them. That function is the
product. Be careful with it.

**Vocabulary rule: flavour the nouns, plain-speak the verbs.**

Nouns are named once and learned: a *shot* is one go at a bullet on a day or
week, a *target* is the deadline, and the *Pull* is the migration ritual. Keep
those.

Buttons and status labels are different. If someone has to pause and work out
whether a control deletes their work, the wording has failed — so actions say
exactly what they do: **Delete**, **Mark done**, **Do today**, **Take off
today**. This was learned the hard way: "Call it off" read as *unschedule*
rather than *delete*, and "Wide" was unguessable on a badge whose whole job is
warning you.

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

**4. Verify on the platform the code actually runs on.** There are now
**three**, and they differ in ways that pass every test: the web runs at a real
https origin, the APK at `https://localhost`, and the macOS app at `file://`.
The sync bug below passed everything on the web and meant the APK never synced
once. A green suite says nothing about the other two.

---

## Traps that have already bitten, in order of nastiness

**Relative API URLs break everything that isn't the web.** Capacitor serves from
`https://localhost` and packaged Electron from `file://` (which sends
`Origin: null`), so `fetch('/api/sync')` hits an origin with no server. Always
go through `sync/api.ts`, which knows about all three. Any new function also
needs CORS + an `OPTIONS` preflight from `netlify/lib/http.mts`, or the
request is never even sent.

**Desktop reminders live in memory.** The macOS app arms `setTimeout`s in the
main process, so they survive closing the window but not quitting the app —
unlike Android's AlarmManager, which survives both kill and reboot. Don't
promise parity in copy. (Node also cannot take a delay over ~24.8 days, so
long-range huddles re-arm; see `arm()` in `electron/main.mjs`.)

**Horizon alone does not put a bullet on the calendar.** Every calendar view
renders *shots*, and `useShelf` only lists `shelf`/`later` — so a bullet with
`horizon: 'now'` and no shot is invisible in Today, Week AND Shelf at once, and
neither Pull will offer it again. **Always change a horizon with
`moveToHorizon()`, never a raw `setHorizon()`** — it creates or clears the
matching shot. This bug shipped twice, in `createBullet` and again in the zoom
view's "Move it" chips, which is why the raw setter is now effectively private.

**Completion is derived, so it must be re-derived when peer ops land.** The old
rollup summed shots on the device that tapped, at that moment — so "20 posts",
ten hit on each phone, left both holding 20 of 20 done with the bullet open
forever. `settleFromOps()` runs after `applyLocal` in the sync client. If you
add another way to finish work, it has to converge the same way.

**Never delete a completed shot.** Progress is derived from live shots, so
soft-deleting a done one silently erases work that actually happened and resets
a counted bullet to zero. `moveToHorizon` clears only *open* commitments.

**A local write and its outbox op must commit together.** `mutate()` wraps
`applyLocal` and `enqueue` in ONE Dexie transaction spanning the entity tables
AND `outbox`. They used to be two commits, so an app killed in between kept the
change locally with no op queued — it looked saved, survived a reload, and never
reached the server or the other device, and nothing reported it because from the
app's side there was nothing outstanding. `durability.test.ts` fails the queue
write on purpose to pin this; if you split those writes again, that test is the
one that goes red.

**The op log is FIELD level; history is ACTION level.** One tap of "Mark done"
on a counted parent writes a dozen ops across several entities. The grouping key
rides INSIDE `opId` as `${actionId}:${n}` — Postgres declares `op_id` as opaque
text and round-trips it verbatim, so this needed no migration, no wire change
and no deploy ordering across the three clients. The counter lives on the ACTION
(`mutations.ts:runAction`/`runAuto`), never on the `mutate()` call: an action
spans several `mutate()` calls, and a per-call counter would emit `${id}:0`
twice, which `on conflict (op_id) do nothing` silently swallows. That is data
loss, not a grouping bug.

**Machine writes name no person.** `settleFromOps` derives completion on
whichever device pulled first, and `sync.mts` stamps `actor` with the
authenticated pusher — so a derived completion is durably credited to the wrong
human. `runAuto` marks those, and history renders them as "Bullets …" with no
initial. Never "fix" this by attributing them.

**`HISTORY_HORIZON` is not `HORIZON_META`.** One is what you can PICK, the other
is what you can READ, and the second has more answers: 'soon' and 'later' were
retired without rewriting a row, so the log holds them forever. Its default arm
is also forward compatibility — a phone one release behind must render a value
it has never heard of rather than white-screen.

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

- **Onboarding may only teach words the app actually prints.** It once taught
  "Pull in" and "Push out" as the deck's three directions; the live deck says
  "This week"/"Later" (weekly) and "Do today"/"Not today" (daily), so you
  learned a vocabulary and then met three different buttons. Same for "shots"
  and "hits" — real domain nouns in the code, but no user-visible string
  outside onboarding uses them, and Today heads its finished section "Done · N".
  Before writing onboarding copy, grep `src/views` for the string. Teaching
  vocabulary the next screen doesn't use is debt with a friendly face.
- **Nothing in onboarding sells.** Clark and Angie built this. Copy that argues
  the product's merit against other trackers is aimed at nobody in the room.
  One fact per card, one sentence, plain verbs — see the header comment in
  `Onboarding.tsx`.
- **Don't render a tension state the engine cannot produce.** The idea card
  used to show `level="incoming" daysLeft={9}`; `INCOMING_WINDOW` is 3, so
  `tensionOf` returns calm at 9 days and the badge never appears in real life.
  If you hand-build a `TensionBadge` for an illustration, check it against
  `selectors.ts` first.

- **Scroll position is per-tab and lives in App.tsx.** Every view unmounts on a
  tab change, so `goTab` stashes `window.scrollY` under the outgoing tab and a
  `useLayoutEffect` puts it back for the incoming one. It has to be a LAYOUT
  effect — a passive one paints the top of the list first and then jumps. It
  also only works because the live queries in `store.ts` are cached: an
  incoming view that renders empty has no document height yet, so any restored
  offset is clamped straight back to 0. If you ever un-cache those queries, this
  breaks silently and looks like a scroll bug.

---

## Where the reasoning lives

- `docs/state-model.md` — **read this before touching completion, horizons or
  shots.** The three shapes, the two invariants, and what every action does.
  `invariants.test.ts` is that document executed.
- `docs/architecture.md` — how the sync layer works and how to extend it
- `docs/macos-signing.md` — the five secrets the macOS release job needs; it
  skips cleanly without them
- `docs/superpowers/specs/2026-08-12-bullets-design.md` — the original design,
  including a section marked as revised when research contradicted it
- `docs/android-signing.md`, `docs/firebase-setup.md` — the native setup

Commit messages here explain *why*, including what broke. They are worth
reading before changing the module they touch.
