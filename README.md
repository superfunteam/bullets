# Bullets

> No more dodging.

**Download:** [macOS app (DMG)](https://github.com/superfunteam/bullets/releases/latest) · [Android app (APK)](https://github.com/superfunteam/bullets/releases/download/v1.1.1/bullets-1.1.1.apk)

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

That's enough to use the app on one device — it's local-first, so everything works offline
against IndexedDB.

### Hosting

Already set up. The site is [bullets-superfun.netlify.app](https://bullets-superfun.netlify.app),
the Postgres database is provisioned, and `BULLETS_SECRET` is set. Nothing needs configuring
for AI either — the Netlify AI Gateway injects `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`
into the functions automatically and bills through Netlify credits.

To point a nicer domain at it (say `bullets.superfun.team`), add it under Domain management
in the Netlify dashboard.

### There is no password

Deliberate, and worth being clear-eyed about.

Opening the app asks which of you is holding the phone — Clark or Angie — and that's it. That
choice is *identity*, not a gate: it's how huddle responses, presence, and history get
attributed to the right person. The token it mints is signed so it can't be edited, which is
what keeps attribution honest, but `/api/auth` will hand one to anyone who asks.

**So the space is open.** Anyone who finds the URL can read every client name and deadline,
and could write to them. The repo is public, which documents both the URL and the API. What
mitigates it: the site is `noindex` and `robots.txt`-disallowed so it stays out of search, the
functions are rate-limited, and the server keeps an append-only op log — so even a destructive
write is recoverable from history rather than gone.

If that trade ever stops feeling right, the fix is one comparison in
`netlify/functions/auth.mts`: check a shared secret before minting a token, and set it as a
Netlify env var. Nothing else in the stack changes.

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm test` | Vitest, the data core has real coverage |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production build to `dist/` |
| `npm run cap:sync` | Build, then copy into the Android project |

> **Working on this with an AI agent?** Point it at [AGENTS.md](AGENTS.md) —
> it lists the traps that have already bitten this codebase, most of which are
> invisible to a typecheck.

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

Sync pace adapts: 1.5s while a live huddle board is open, 4s in normal use, and a
local write pushes within 250ms so the other person sees it in about a second.
Your own edits never wait on any of it.

See [the design spec](docs/superpowers/specs/2026-08-12-bullets-design.md) for the
full reasoning, and [docs/architecture.md](docs/architecture.md) for how to extend it.

## Apps

### Android

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

Releases are built by GitHub Actions on a tag. Bump the version in `package.json` first — the
in-app updater compares that against the release tag:

```bash
npm version patch --no-git-tag-version && git commit -am "Release" && git tag v$(node -p "require('./package.json').version") && git push --follow-tags
```

**Signing is configured.** A 4096-bit release keystore is generated and its four secrets are
set on the repo, so releases are properly signed and install over each other in place. The
keystore lives at `~/.bullets-signing/` — **back that directory up to 1Password.** Losing it
means never being able to update an installed APK again without uninstalling first, which
wipes anything that hasn't synced. See [docs/android-signing.md](docs/android-signing.md).

### Updating the app

The APK checks GitHub Releases for a newer tag (at most every six hours, and on demand) and
offers it as a quiet slab at the bottom of Today. Tapping it hands the download to Android,
which asks you to confirm the install — that consent prompt is the OS's job and we don't try
to route around it. No update server, because the repo is public and the releases API is
readable without a token.

### macOS

The Mac app is an **Electron** shell around the same Vite build — no Swift or
separate UI. It uses the native title bar, lives in the menu bar after its
window closes, and schedules huddle reminders through macOS notifications.
Click the target in the menu bar for **Open Bullets**, **Quick capture**, or
**Quit Bullets**. A notification click opens the relevant huddle.

```bash
npm run mac:dev   # build and launch the local app
npm run mac:pack  # unsigned unpacked app in release/mac-*/
npm run mac:demo  # private, unsigned universal ZIP in demo-release/
npm run mac:dist  # universal (Intel + Apple Silicon) DMG + ZIP in release/
```

For sharing outside the development machine, the DMG must be signed with a
Developer ID Application certificate and notarized by Apple; otherwise
Gatekeeper will block notification events and warn users on install. The
packaging setup automatically uses Electron Builder's standard `CSC_LINK`,
`CSC_KEY_PASSWORD`, and Apple-notarization environment variables when they are
provided. See [macOS signing and updates](docs/macos-signing.md) for the
one-time GitHub Secrets setup.

While Apple Developer enrollment is pending, see the [private two-person macOS
demo](docs/macos-demo.md) path instead.

## Deliberately not built

Recurring bullets, attachments, calendar export, an undo history UI, search, and
any notion of a third user. All revisitable — none of them earn their complexity
yet.
