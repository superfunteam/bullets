# The state model

Written after a run of bugs that were all the same bug: behaviour defined
per-view and per-action instead of once, so the rules quietly contradicted each
other. This is the single source of truth. Code follows it; when they disagree,
the code is wrong.

---

## The three shapes a bullet can take

Every bullet is **exactly one** of these, decided by what it contains. This is
the whole model, and the reason the old code tangled is that it tried to apply
all three rules to every bullet at once.

| Shape | When | Done means |
|---|---|---|
| **Simple** | no children, no count | someone said so |
| **Counted** | has `count`, no children | completed shot amounts ≥ total |
| **Parent** | has children | every child is done |

A bullet cannot be both Counted and Parent. If children exist, children win and
`count` is ignored for completion.

### Why the old version broke

`completeBullet` set `state: 'done'` explicitly, **and** `recomputeCompletion`
derived the same field from children. Marking a parent done with five open
children set the flag, then the derivation ran and reset it to open. The two
rules disagreed and the last one to run decided. That is the disappear-reappear.

---

## Completion rules, one per shape

**Simple** — explicit only. `Mark done`, or hitting its shot. Nothing derives it.

**Counted** — always derived from shots.
- `Mark done` completes the remainder rather than setting a flag, so the
  derivation becomes true instead of fighting it.
- `Reopen` reopens the most recently completed shot, so the derivation becomes
  false. Otherwise reopening is instantly undone by the next recompute.

**Parent** — derived, but only **on a child transition**, never speculatively.
- A child becoming done → if all siblings are done, the parent becomes done.
- A child becoming open → if the parent was done, it reopens.
- **A child being added** → if the parent was done, it reopens. A change to the
  child *set* is as much a transition as a change to a child's state; without
  this, adding a piece to a finished parent left new open work reachable from
  nowhere.
- `Mark done` on a parent **completes all its open children**. The parent
  becomes done because its work is done, not because a flag was set.
- `Reopen` on a parent reopens the parent and leaves children alone. Nothing
  re-fires, because no child transitioned.

The last point is the important one. Derivation reacting only to transitions —
rather than recomputing whenever asked — is what lets explicit actions stick.

---

## Two invariants

Every bug in this area has been a violation of one of these. They are tested
directly.

### 1. A committing horizon always has a matching open shot

> `state: 'open'` and `horizon: 'now'` ⟹ an open day shot for today.
> `state: 'open'` and `horizon: 'next'` ⟹ an open week shot for this week.

`now` and `next` are commitments; `soon`, `later` and `shelf` are not, and must
carry **no open shots** (completed shots always survive — they are a record of
work that happened, not a commitment).

Enforced in exactly one place: `moveToHorizon()`. Nothing else may write
`horizon`.

This holds at write time and **decays with the calendar** — a shot dated today
is stale tomorrow. Rather than a background job re-asserting it, invariant 2 is
made independent of it: the Weekly Pull catches anything without a live
commitment, so a decayed invariant 1 is a nuisance rather than a lost bullet.

### 2. Every open bullet is reachable

> An open, undeleted, top-level bullet appears in **at least one** of
> Today, Week, Shelf, or a Pull deck.

This is the invariant the app kept breaking, always the same way: a bullet with
a committing horizon and no shot is absent from every calendar (they render
shots), absent from the Shelf (it lists only `shelf`/`later`), and offered by
neither Pull. Saved, syncing, and unreachable.

All conditions below apply to **open** bullets only — a finished one is never
rendered as commitment or offered by a deck.

| Where it lives | Condition |
|---|---|
| Today | an open day shot dated today |
| Week | an open shot inside this week |
| Shelf | horizon `shelf` or `later` |
| **Weekly Pull** | **no open shot dated today or later — whatever the horizon** |
| Daily Pull | an open week shot this week, and nothing on today yet |

### The Weekly Pull is the safety net

That row is what makes invariant 2 hold *structurally* rather than by
coincidence, and it is deliberately unconditional on horizon.

An adversarial review of an earlier draft found three separate ways to end up
committed to nothing, all of which made a bullet invisible everywhere:

- **A commitment goes stale with the clock.** Monday's open week shot is not a
  plan by the following Monday. The earlier draft enforced invariant 1 only in
  `moveToHorizon()` — at write time — so it was true when written and false a
  week later, with invariant 2 resting on it.
- **A shot is hit without finishing the bullet.** Five of twenty posts done
  leaves a `now` bullet holding zero open shots on the happy path.
- Any future way of arriving there.

A commitment only counts while it is still ahead of you. Treating an abandoned
one as "already handled" is precisely the lie `tensionOf` refuses to tell, so an
overdue commitment now makes a bullet **more** likely to be offered, never
invisible. Every view defers to `surfacesFor()` rather than re-deriving this —
re-derivation is how the answers drifted apart in the first place.

---

## What each action does, completely

Written out so no view has to invent behaviour.

| Action | Effect |
|---|---|
| **Capture** | Creates the bullet. `now`/`next` also create the matching shot (invariant 1). |
| **Mark done** (any shape) | Always closes the bullet's own open shots, never its completed ones. |
| **Mark done** (Counted) | Also completes the remaining amount, so the derivation agrees. |
| **Mark done** (Parent) | Also completes every open child, so the derivation agrees. |
| **Reopen** (Simple) | `state: open`, reopens the shots completion closed, restores the shot its horizon implies. |
| **Reopen** (Counted) | Reopens the last completed shot. |
| **Reopen** (Parent) | `state: open`. Children untouched. |
| **Check off a child** | Completes that child; if it was the last, the parent follows. |
| **Uncheck a child** | Reopens it; if the parent was done, it reopens too. |
| **Hit a shot** | Completes the shot, then applies the owning bullet's shape rule. |
| **Do today** | Ensures one open day shot for today. Idempotent. Counted claims what is left. |
| **Take off today** | Removes today's open shot **and** moves the horizon to `soon`, so invariant 1 holds. |
| **Move it → horizon** | `moveToHorizon`. Creates or clears open shots to match. Never touches completed ones. |
| **Delete** | Soft-deletes the bullet, its children, and its shots. |

---

## Cross-device convergence

Completion is derived, so two phones can each hold half the answer.

- **Parent** converges for free: the device that completes the last child writes
  the parent's `state`, and that field syncs like any other.
- **Counted** does not. If we each hit a shot for ten of twenty posts, neither
  device ever sees twenty. So after applying peer ops the client re-checks
  counted bullets **in the completing direction only** — it may finish one, never
  reopen one. Reopening is always an explicit local act, and because `Reopen`
  on a counted bullet reopens a shot, the derivation genuinely becomes false and
  the settle pass will not undo it.

---

## Deliberately not modelled

- **`state: 'dropped'`** is retired. It meant "decided not to do this", but it
  behaved exactly like a delete while reading like a completion state, and gave
  a third meaning to a field that already had two. Deleting is now deleting.
- **Nested counts.** A Parent ignores `count`. Supporting both would need a
  rule for how five children and twenty posts relate, and there is no obvious
  right answer.
