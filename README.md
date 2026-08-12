# Bullets

> No more dodging.

A two-person, deadline-first to-do app built on bullet journal methodology, for
Clark and Angie at Superfun. Web app on Netlify, plus an installable Android APK
with a home screen widget.

It has two users, forever. Every design decision exploits that.

---

## The idea

Every tracker we've used collapses two different facts into one date field:

- **When it's due** — external, immovable. The client needs it Thursday.
- **When you decided to deal with it** — internal, revisable.

That's why they all degrade into a wall of overdue red: you can't tell "this is
genuinely late" from "I scheduled this optimistically and moved on."

Bullets keeps them separate. A bullet has a **target** (when it's due) and a
**horizon** (where you decided to deal with it). The app's central job is
surfacing the tension between them — a bullet parked on `LATER` with a target
four days out is the single most useful thing it can tell you.

## Vocabulary

| Horizon | Means |
|---|---|
| 🔥 `NOW` | Super urgent, right now |
| ⚡ `NEXT` | As soon as we can — this week |
| 🌤 `SOON` | The near future — this month |
| 🌙 `LATER` | The distant future |
| 📚 `SHELF` | To be decided on. Not committed. |

- **Bullet** — the atomic item. A task, an event, or a note.
- **Shot** — one go at a bullet on a specific day or week, optionally partial.
  *"Three shots at the TikTok posts today."*
- **Pull** — the ritual of moving bullets from a wider horizon into a narrower one.
- **Target** — the deadline.
- **Huddle** — a meeting between the two of us.

Completing something is a **hit**. A passed target is **wide**, not "overdue".
Dropping something is **calling it off**, never "deleting" — bullet journaling
values the act of deciding *not* to do something.

## Getting started

```bash
npm install
npm run dev
```

Then set two environment variables in Netlify (or a local `.env`):

```bash
netlify env:set BULLETS_PASSPHRASE "the shared phrase"
netlify env:set BULLETS_SECRET "$(openssl rand -hex 32)"
```

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm test` | Vitest, the data core has real coverage |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production build to `dist/` |
| `npm run cap:sync` | Build, then copy into the Android project |

## How it's put together

```
src/
  lib/      pure helpers — dates, ids, fractional sort keys
  data/     the local-first core: types, op log, Dexie, mutations, selectors
  sync/     auth and the adaptive polling loop
  design/   tokens, spring presets, and the chunky primitives
  views/    one directory-level file per screen
  native/   Capacitor-only code (widget payload, local notifications)
netlify/
  functions/  sync, auth, snapshot, scheduled compaction, AI assists
  database/   migrations
```

Two rules keep this honest, and both are load-bearing:

**1. `src/data/mutations.ts` is the only module that writes.** If a view writes
to Dexie directly it skips the op log and the two devices silently diverge with
no error anywhere. Funnelling every write through one module makes that class of
bug structurally impossible.

**2. `src/design/springs.ts` is the only source of motion config.** Duration-based
easing is banned. Springs are interruptible, which is what makes the interface
feel like material rather than playback.

## Local-first, and why

Everything renders synchronously from IndexedDB. The network is never on the
critical path, so there are no loading spinners and the APK works fully offline.

Every mutation becomes one or more **field-level ops** appended to a local
outbox, applied optimistically, and drained to an append-only log on the server.
Conflicts resolve last-write-wins per field, which makes the live Huddle board
safe without CRDTs.

The server has **no tables mirroring the entity types** — just the ordered log.
It never interprets an op's value. That's the extensibility guarantee: adding an
entity type or a field needs zero backend changes and zero migrations, which
matters because we're going to change this a lot.

Sync pace adapts: 1.5s while a live huddle board is open, 15s in normal use,
immediate on focus/resume/reconnect. Your own edits never wait on any of it.

See [the design spec](docs/superpowers/specs/2026-08-12-bullets-design.md) for the
full reasoning, and [docs/architecture.md](docs/architecture.md) for how to extend it.

## Android

Capacitor wraps the same build. Not Flutter — that would mean rewriting the UI
in Dart, losing the web app for desktop bulk editing, and it wouldn't help with
the widget, which is Kotlin either way.

**Notifications split into two mechanisms with very different reliability:**

- **Huddle reminders** ("starts in 30 minutes") are locally scheduled through
  AlarmManager. They survive app kill and reboot, fire at the exact second, and
  need no network. This is the path that actually delivers advance warning, and
  it works today with no setup.
- **Instant "Angie called a huddle" alerts** need Firebase Cloud Messaging.
  Background polling genuinely cannot do this: Doze suspends network access and
  blocks WorkManager outright, and OEM battery managers are more aggressive
  still. The app is wired for FCM already — see
  [docs/firebase-setup.md](docs/firebase-setup.md) for the ~10 minute file drop
  that switches it on with no code change.

Releases are built by GitHub Actions on a tag:

```bash
git tag v1.0.0 && git push --tags
```

Without a signing keystore configured it produces a debug-signed APK so the
pipeline is useful from day one. See [docs/android-signing.md](docs/android-signing.md)
to set up real signing.

## Deliberately not built

Recurring bullets, attachments, calendar export, an undo history UI, search, and
any notion of a third user. All revisitable — none of them earn their complexity
yet.
