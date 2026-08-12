# Bullets — Design Spec

> **Bullets** — *No more dodging.*

**Date:** 2026-08-12
**For:** Superfun (Clark + Angie)
**Status:** Approved, ready for implementation planning

---

## 1. What this is

A two-person, deadline-first to-do app built on bullet journal methodology, delivered as a
web app (Netlify) and an installable Android APK with a home screen widget.

It is explicitly **not** a project manager, a time tracker, or a team tool. It has two users,
forever. Every design decision should exploit that.

### The problem with everything we've tried

Notion, Jira, Obsidian, and the rest fail us the same way: they make you *maintain* the
system. Tiny checkboxes, nested date pickers, percentage bars, status enums with eight
values. The cost of keeping the tool honest exceeds the value of the tool. So we stop
opening it, and then it's worse than nothing because now it's also lying.

### The core insight

Every tracker we've used conflates two different facts about a task:

- **When it's due** — an external, immovable fact. The client needs it Thursday.
- **When you've decided to deal with it** — an internal, revisable choice.

Collapsing these into one "due date" field is why every to-do app eventually becomes a wall
of overdue red. You can't tell the difference between *"this is genuinely late"* and *"I
scheduled this optimistically and then moved on."*

Bullets keeps them as two independent properties: a **target** and a **horizon**. The app's
central job is to surface the *tension between them*. A bullet parked on `LATER` with a
target four days out is the single most important thing the app can tell you, and no other
tool we've used can express that thought at all.

(In code the field is `deadline`; in the interface it's always called the target.)

### Design principles

1. **Giant and thumbable.** Every interactive target is a slab, not a checkbox. If it can't
   be operated one-handed on a phone while walking, it's wrong.
2. **Few settings per item.** A bullet has a title, a client, a horizon, and optionally a
   deadline and a count. That's the whole vocabulary. Resist every future field.
3. **The ritual is the feature.** Bullet journaling works because of migration — the periodic
   act of re-deciding what deserves your attention. The Pull is a first-class screen, not a
   drag-and-drop afterthought.
4. **Never show a spinner.** Local-first. The UI renders from on-device state, always. The
   network is a background detail the user never waits on.
5. **Extensible by construction.** We will change this a lot. The data layer must accept new
   entity types and fields without migrations or coordination.

---

## 2. Vocabulary

Five horizons, from on-fire to undecided. These are the only priority language in the app.

| Horizon | Means | Emoji |
|---|---|---|
| `NOW` | Super urgent, right now, today | 🔥 |
| `NEXT` | As soon as we can — this week | ⚡ |
| `SOON` | The near future — this month | 🌤 |
| `LATER` | The distant future | 🌙 |
| `SHELF` | To be decided on. Not committed. | 📚 |

Other terms, kept deliberately small:

- **Bullet** — the atomic item. A task, an event, or a note.
- **Shot** — one go at a bullet on a specific week or day, optionally partial. *"Three shots
  at the TikTok posts today."*
- **Pull** — the ritual of moving bullets from a wider horizon into a narrower one.
- **Target** — the deadline. The date the work is actually due.
- **Huddle** — a meeting between Clark and Angie.
- **Client** — who the work is for.

### Voice

The tagline is **"No more dodging."** It works on both halves of the product: don't dodge the
work, and don't dodge the conversation.

The language set is **target shooting, not firearms** — aim, target, shot, on target, wide,
the Pull, a clean hit. Sporting and precise. This distinction is deliberate and should hold
for anything we add later: "took three shots at it" is the register, "unloaded a clip" is
not. Fun, not wacky — same rule as the visual design.

A few places the voice surfaces concretely:

- Completing a bullet is a **hit**. The completion animation should feel like one.
- A bullet whose target has passed is **wide**, not "overdue." Less scolding, more factual.
- The deadline tension banner is **Incoming** — something is coming at you that you haven't
  aimed at yet.
- Dropping a bullet is **called off**, never "deleted." Bullet journal migration explicitly
  values the act of deciding *not* to do something, and the word should respect that.

### Horizon is not a second thing to maintain

The horizon and the calendar stay in sync automatically, because manual sync between two
overlapping concepts is exactly the pedantry we're escaping:

- Pull a bullet into today → horizon becomes `NOW`.
- Pull a bullet into this week → horizon becomes `NEXT`.
- Shelve a bullet → its shots are removed.

Manual override is always one tap away, but you should never *have* to do it.

### No owners

Bullets belong to Superfun, not to a person. There is no assignee field, no filtering by
person, no "my tasks." One shared pile. Either of us can pull anything into our day.

Person identity still exists, but only where it's genuinely about a human: who called a
huddle, who responded and how, who's present on the live board, and attribution in history.

---

## 3. Data model

Six entity types. All of them share a common envelope so the sync layer never needs to know
what it's carrying.

```ts
type Person = 'clark' | 'angie';

type Entity = {
  id: string;           // uuid, client-generated
  createdAt: number;    // epoch ms
  updatedAt: number;
  deletedAt?: number;   // soft delete, always — never hard delete a synced row
};

type Client = Entity & {
  name: string;
  hue: number;          // 0-360, the single source of a client's color
  archived?: boolean;
};

type Bullet = Entity & {
  title: string;
  note?: string;
  clientId?: string;
  parentId?: string;              // nesting — this is what "zoom" navigates
  horizon: Horizon;
  deadline?: string;              // 'YYYY-MM-DD', day granularity, no times
  kind: 'task' | 'event' | 'note';
  count?: { total: number; unit: string };   // "20 posts"
  state: 'open' | 'done' | 'dropped';
  sortKey: string;                // fractional index for reorder without renumbering
};

type Shot = Entity & {
  bulletId: string;
  scope: 'week' | 'day';
  date: string;                   // 'YYYY-MM-DD'; for week scope, the Monday
  amount?: number;                // portion of the parent bullet's count
  state: 'open' | 'done';
  sortKey: string;
};

type Huddle = Entity & {
  title?: string;
  startsAt: number;               // epoch ms
  durationMin: number;            // default 30
  calledBy: Person;
  status: 'scheduled' | 'live' | 'done' | 'cancelled';
  responses: Partial<Record<Person, {
    status: 'in' | 'nudge' | 'out';
    note?: string;
    proposedAt?: number;          // for 'nudge' — a counter-offer time
    at: number;
  }>>;
};

type HuddleItem = Entity & {
  huddleId: string;
  bulletId?: string;              // linked bullet, or...
  text?: string;                  // ...a freeform agenda line
  lane: 'table' | 'decided';
  decision?: string;              // the note captured on moving to Decided
  sortKey: string;
  addedBy: Person;
};
```

### Why `kind` exists

Classic bullet journal signifiers. A task gets a dot and can be completed. An event gets a
circle and is just a fact on a day. A note gets a dash and is a thought you want to keep near
a date. Costs us one enum, buys the actual methodology.

### Why counts and shots are separate

This is the zoom mechanic. A bullet is "TikTok posts, ×20." It is one thing in the Shelf, one
line in your week. But it produces many shots: three on Monday, five on Wednesday. The
bullet holds the *total*; shots hold the *portions*. Completion is derived — sum the done
shots' amounts against the total — so there is no progress field anyone has to update, and
no progress bar to argue with.

A bullet without a count works identically with an implicit total of 1.

---

## 4. Sync architecture

The requirement that drives this section: **the Huddle board is a live shared surface.** Both
of us will have it open, moving items between lanes, watching each other's changes. There
will be more two-screen interfaces later. So sync is not an afterthought that reconciles
overnight — it's a load-bearing part of the product.

### The server is an ordered op log

Not a set of tables mirroring the entity types. An append-only log:

```sql
create table ops (
  seq         bigserial primary key,
  op_id       text unique not null,   -- client-generated, makes retries idempotent
  entity      text not null,          -- 'bullet' | 'shot' | 'huddle' | ...
  entity_id   text not null,
  field       text not null,
  value       jsonb,
  ts          bigint not null,        -- client clock, for last-write-wins
  actor       text not null,          -- 'clark' | 'angie'
  created_at  timestamptz default now()
);
create index ops_seq_idx on ops (seq);
create index ops_entity_idx on ops (entity, entity_id);
```

Every mutation anywhere in the app is one or more field-level ops. Creating a bullet emits
ops for `title`, `horizon`, `clientId`, and so on. Moving a huddle item emits a single `lane`
op.

**This is the extensibility guarantee.** Adding a new entity type or a new field requires zero
server changes and zero migrations. The server never interprets `value`; it only orders it.
When we add attachments, recurring bullets, or whatever we think of in November, the backend
is already done.

### Conflict resolution

Last-write-wins **per field**, not per record. Each client tracks `fieldTs` per entity field
and ignores an incoming op older than the value it already has. Two people editing different
fields of the same bullet both win. Two people editing the same field — vanishingly rare with
two users — resolves deterministically to the later clock.

Lane moves on the huddle board are single-field ops, which makes them naturally
conflict-safe: if we both drag the same item to Decided, we agree.

### The wire protocol

One endpoint does both directions in a single round trip:

```
POST /api/sync
  → { since: number, ops: Op[] }
  ← { seq: number, ops: Op[] }
```

The client sends everything in its outbox and its cursor; the server appends, then returns
everything after that cursor. Push and pull are the same request, which halves latency on the
live board and makes the offline story trivial — a queued outbox drains on reconnect with no
special-case code.

### Cold start

Replaying the whole log on a fresh device gets slow eventually. A scheduled Netlify Function
compacts the log into a snapshot stored in Netlify Blobs:

```
GET /api/snapshot  → { seq, entities }
```

New devices fetch the snapshot, then sync from `seq`. The log is never truncated — it's our
free history and undo substrate, and at two people's volume it stays small for years.

### Adaptive polling

Netlify Functions can't hold WebSockets, and their streaming responses cap at 60 seconds, so
SSE would mean reconnect churn. For two users, polling at the right cadence is simpler and
genuinely indistinguishable from realtime:

| Context | Interval |
|---|---|
| Live huddle board open | 1.5s |
| App foreground, normal use | 15s |
| On resume / focus / reconnect | immediate |
| Android background (WorkManager) | 15 min |

Crucially, **your own edits never wait for any of this.** They apply to local state
instantly and optimistically. Polling only governs how fast you see *the other person's*
changes — and 1.5s on a shared board reads as live.

### Presence

Ephemeral, not synced to IndexedDB. The sync response carries a small presence blob (who's
looked at this huddle in the last 10s), so the board can show "Angie is here" without any
extra infrastructure.

### Auth

Two users, no signup, no email. A shared space passphrase unlocks the space; then you tap one
of two large faces to say who you are. That mints a bearer token stored in `localStorage` on
web and Capacitor Preferences in the app.

Bearer tokens rather than cookies specifically because Capacitor serves the app from
`https://localhost` on Android, which makes every call to the Netlify domain cross-site.
Bearer sidesteps the entire cookie/CORS problem on both platforms with one code path.

---

## 5. Views

All views are single-column first. The desktop grid is an explicit toggle, not a breakpoint
surprise.

### Today

The default screen. A single column of giant cards: today's shots, with huddles placed
inline at their time. Above them, a compact **tension banner** appears only when it has
something to say — a deadline inside 72 hours that hasn't been pulled in.

Completing a shot is a full-width swipe or a tap on a slab-sized target. It animates with a
spring and a satisfying settle. No confirmation, undo via a toast.

### Week

Seven day-blocks stacked vertically on mobile; a seven-column grid on desktop for bulk
editing. Each block shows its shots and its huddles. Deadlines that land in the week appear
as a distinct marker even when nothing has been pulled in for them — that's the whole point.

### Shelf

Everything on `SHELF`, plus `LATER`, grouped by client. This is the pile you shop from during
the Weekly Pull. Chunky client headers with their hue, collapsed by default so it never feels
like a wall.

### The Pull

The ritual, and the screen we should make most beautiful.

**Weekly Pull** — run on Monday. Full-screen cards drawn from `SHELF`, `LATER`, and `SOON`,
plus anything with a deadline inside three weeks. Swipe right to pull into this week, left to
push out a horizon, up to shelve. One card at a time, giant type, no lists.

**Daily Pull** — run each morning. Same interaction, but the deck is this week's shots, and
pulling right places it on today. For a counted bullet, pulling opens a chunky number
stepper: *how many today?* Big plus and minus slabs, no text input.

Both end on a summary card: what you committed to, and what the app thinks is at risk.

### Bullet zoom

Tapping a bullet expands it in place via a shared-element transition — the card physically
becomes the detail view rather than navigating to a new screen. Inside: its note, its
sub-bullets, its shot history, and its count progress rendered as discrete blocks rather
than a percentage bar. Zoom out with a downward drag.

Nesting is arbitrary-depth but the UI only ever shows one level at a time. You zoom in.

### Huddles

Covered in its own section below.

---

## 6. Huddles

### The problem it solves

Angie wants to schedule time to talk. Clark works in flow and finds unannounced context
switches expensive, but with advance notice is completely fine. The friction isn't the
meeting — it's the surprise. So the app's job is **telegraphing**, not gatekeeping.

### Auto-approval by default

We're married. Angie schedules a huddle; it is immediately real and on both calendars. There
is no accept step, no pending state, no "awaiting response" badge. The default response is
pre-set to **In**.

Clark can still respond, and the response is expressive rather than binary:

- **In** — the default, already applied. Tapping it just confirms explicitly.
- **Nudge** — "not then, how about this instead," with a proposed time and an optional note.
  The huddle *stays scheduled* at the original time until Angie accepts the nudge. It's a
  counter-offer, not a cancellation.
- **Can't** — with a required note. Requires a reason because a bare decline is the thing
  that makes scheduling feel adversarial.

### Notifications

> **Revised 2026-08-12 during implementation.** This section originally proposed a
> `WorkManager` background-sync job as the delivery mechanism for huddle requests, on the
> theory that it avoided a Firebase dependency. Research during the Android build showed that
> plan does not survive contact with the platform, so the design changed. The original text is
> superseded by what follows.

**"Huddle starts in 30 minutes" — locally scheduled, and completely reliable.** Fired by
Android's `AlarmManager` the moment the huddle syncs down. Exact to the second, survives app
kill, survives reboot, works in airplane mode, needs no network and no third-party account.
This is the path that actually delivers the advance warning Clark needs, and it has no moving
parts. It works today with zero setup.

**"Angie called a huddle" — needs Firebase Cloud Messaging.** Background polling genuinely
cannot do this job, and the reasons are structural rather than a matter of implementation
quality:

- Doze mode **suspends network access** and **blocks `WorkManager` outright**.
- `WorkManager`'s minimum repeat interval is 15 minutes regardless.
- OEM battery managers on Xiaomi, Huawei, Samsung and others kill background work more
  aggressively still.

FCM survives all of this because Play Services is exempt by construction. Nothing we write
from inside an app can be.

**Resolution:** ship the local-reminder backbone, which is the reliable half and the half that
matters most, and wire FCM so it activates on a file drop. Capacitor's Android template
already carries the `google-services` classpath and applies the plugin conditionally on
`google-services.json` existing, so enabling instant push is a ~10 minute setup with **no code
change and no rework** — see `docs/firebase-setup.md`. Until then, a new huddle surfaces at
the next scheduled reminder or when the app is next opened.

### The live board

This is the heart of the feature and the first two-screen interface.

A huddle opens into a shared board with two lanes:

```
┌─────────────────────────┐
│  ON THE TABLE           │   agenda items, linked bullets, freeform lines
├─────────────────────────┤
│  DECIDED                │   each carries the decision note
└─────────────────────────┘
```

Either person can add items before or during the huddle — linked bullets pulled from any
client, or a typed line. Either person can drag an item from **On The Table** to **Decided**,
which opens a chunky note field: *what did we decide?*

Both screens update within ~1.5 seconds of each other. A presence dot shows when the other
person is on the board. Items animate to their new lane on both devices.

### Decisions flow back

The point of capturing a decision is that it survives the meeting. When a huddle ends:

- Every decided item linked to a bullet appends its decision to that bullet's note, stamped
  with the huddle date.
- Items with no linked bullet can be promoted to new bullets in one tap.
- Anything left **On The Table** is offered for the next huddle.

Nothing evaporates, and nobody has to transcribe anything afterward.

---

## 7. Design system

**Direction:** refined and calm, but unmistakably native and expensively made. Fun, not wacky.
The reference points are Things, Linear, and Arc — software that feels funded — rather than a
consumer game.

### Color

A near-neutral canvas in both light and dark, with a warm cast rather than pure grey. Client
hues are the only saturated color in the interface, and they appear as a confident edge or
spine on a card, never as a full fill. This keeps a screen with eleven clients on it calm
instead of looking like a bag of candy.

Semantic color is reserved almost entirely for the deadline tension state. When something is
genuinely at risk, it should be the only urgent-colored thing on screen, so it actually reads
as urgent.

### Type

A single geometric sans with real character at large sizes. The scale is aggressive — bullet
titles are large enough to read at arm's length, and metadata is small and quiet. There is no
middle tier; the absence of medium-sized text is what makes the hierarchy feel deliberate.

### Form

Generous radii (20–28px), slab-like surfaces, soft layered shadows plus a hairline border for
definition in dark mode. Minimum touch target 56px, most primary actions much larger.

### Motion

The performance target is a locked 120Hz on a modern Android phone.

- Spring physics throughout, never duration-based easing. Springs are interruptible, which is
  what makes a UI feel like it's made of physical material rather than playing animations at
  you.
- **Transform and opacity only.** Nothing that animates layout, width, height, or color on a
  per-frame basis. This is the single biggest determinant of whether we hit frame budget.
- Shared-element transitions via layout IDs for the zoom mechanic, so a card *becomes* the
  detail view.
- Gesture-driven wherever possible — the Pull, completion swipes, and zoom-out are all
  velocity-aware and follow the finger.
- Respect `prefers-reduced-motion` by collapsing to cross-fades.

### Stack

React + Vite + TypeScript, Tailwind for tokens and layout, Motion for animation,
`@use-gesture` for drag, Dexie over IndexedDB for local state, Zustand for view state.

---

## 8. Android

**Capacitor**, wrapping the same web build. Not Flutter — that would mean rewriting the UI in
Dart, losing the web app for desktop bulk editing, and it wouldn't help with the widget, which
is Kotlin either way.

### Widget

A home screen widget with two jobs:

1. **Quick add** — a large tap target that deep-links straight into the capture sheet.
2. **Today at a glance** — the count and top few of today's shots, so the widget is worth
   keeping on a home screen rather than being a glorified shortcut.

The widget reads from shared storage written by the app on each sync, so it stays current
without running its own network code.

### Background work

A single `WorkManager` periodic job (15 min) that syncs, then decides whether to raise a
notification. It's the same sync used by the foreground app, so there is one code path.

### Release

A GitHub Actions workflow builds a signed APK and attaches it to a GitHub Release. If no
signing keystore secret is present, it falls back to a debug-signed APK so the pipeline is
useful from day one and the keystore can be added later without touching the workflow.

---

## 9. AI

Netlify AI Gateway, which requires no API key — it injects `ANTHROPIC_API_KEY` and
`ANTHROPIC_BASE_URL` into functions automatically and bills through Netlify credits. Kept
deliberately small; three features that remove typing rather than adding intelligence:

1. **Brain dump** — paste or dictate a messy blob, get back structured bullets with guessed
   client, horizon, deadline, and counts. Everything lands in a review sheet where you swipe
   to accept or discard. Nothing is created without confirmation.
2. **Huddle wrap** — turn the board's raw notes into clean decisions and proposed follow-up
   bullets, again into a review sheet.
3. **Pull risk check** — during the Weekly Pull, one short paragraph on what's at risk given
   deadlines versus what was actually pulled in.

All three are additive. The app is fully functional with AI disabled, and any failure is
silent.

---

## 10. Scope boundaries for v1

Explicitly **in**: the five horizons, bullets with counts and nesting, shots, Today/Week/
Shelf, both Pull rituals, clients, huddles with the live board and notifications, local-first
sync, the APK with widget, and the release pipeline.

Explicitly **out**, to be revisited: recurring bullets, attachments, calendar (ICS) export,
undo history UI, search, and any notion of a third user.

---

## 11. Testing

- **Data core** — the op log, field-level LWW, and materialization get real unit tests,
  including out-of-order and duplicate op delivery. This layer is where a bug silently
  corrupts data, so it's the one place worth rigorous coverage.
- **Sync** — round-trip tests against a local Postgres, plus offline-queue-and-drain.
- **Views** — light interaction tests on the Pull and the huddle board lane moves.
- **Motion and visual polish** — verified by hand on a real device. Not worth automating.
