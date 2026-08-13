/**
 * The vocabulary from the spec, in code. Kept free of logic so both the
 * client and the Netlify functions can import it.
 */

export type Person = 'clark' | 'angie';

export const PEOPLE: Person[] = ['clark', 'angie'];

export const personName = (p: Person): string => (p === 'clark' ? 'Clark' : 'Angie');

export const otherPerson = (p: Person): Person => (p === 'clark' ? 'angie' : 'clark');

export const HORIZONS = ['now', 'next', 'soon', 'later', 'shelf'] as const;
export type Horizon = (typeof HORIZONS)[number];

export const HORIZON_META: Record<
  Horizon,
  { label: string; blurb: string; emoji: string; hue: number }
> = {
  // The blurb says where the bullet ENDS UP, not how urgent it is. Priority
  // words ("super urgent", "as soon as we can") invite arguing about rank;
  // these five state a consequence you can go and check. SOON's is the one
  // that has to be said out loud — SOON appears on no list screen, so without
  // being told you set something to SOON and never see it again until a Pull.
  now: { label: 'NOW', blurb: 'It gets a card on Today.', emoji: '🔥', hue: 25 },
  next: { label: 'NEXT', blurb: 'It gets a card in this week.', emoji: '⚡', hue: 70 },
  soon: { label: 'SOON', blurb: 'Nothing scheduled. The Weekly Pull will ask again.', emoji: '🌤', hue: 220 },
  later: { label: 'LATER', blurb: 'It sits on the Shelf.', emoji: '🌙', hue: 275 },
  shelf: { label: 'SHELF', blurb: 'It sits on the Shelf, undecided.', emoji: '📚', hue: 150 },
};


/**
 * Fold any stored horizon onto one of the three we offer.
 *
 * 'soon' and 'later' were retired without rewriting a single row. They still
 * arrive from the op log, and Angie's phone can keep writing them until her APK
 * updates — offline, at a higher HLC stamp, winning last-write-wins. Nothing is
 * migrated, so nothing can be lost by a migration.
 *
 * This is a COMPLEMENT, not a lookup table: anything that is not 'now' or
 * 'next' is the Shelf. Turn it into a map and the next unrecognised value — a
 * typo, a value from a future build — silently gets no Shelf surface, which is
 * the invisible-bullet trap that has already shipped twice. The default arm
 * must always be 'shelf'.
 */
export function normalizeHorizon(raw: unknown): Horizon {
  return raw === 'now' || raw === 'next' ? raw : 'shelf';
}

export type EntityKind = 'client' | 'bullet' | 'shot' | 'huddle' | 'huddleItem';

export type Entity = {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Soft delete, always. Hard-deleting a synced row loses the tombstone. */
  deletedAt?: number;
};

export type Client = Entity & {
  name: string;
  hue: number;
  archived?: boolean;
};

export type BulletKind = 'task' | 'event' | 'note';

export type Bullet = Entity & {
  title: string;
  note?: string;
  clientId?: string;
  /** Nesting. This is what "zoom" navigates into. */
  parentId?: string;
  horizon: Horizon;
  /** 'YYYY-MM-DD'. Called the "target" in the interface. Day granularity, no times. */
  deadline?: string;
  kind: BulletKind;
  /** Countable work, e.g. { total: 20, unit: 'posts' }. */
  count?: { total: number; unit: string };
  /** Two states only. 'dropped' used to mean "decided not to do this" but
   *  behaved exactly like a delete while reading like a completion state, which
   *  gave one field three meanings. Deleting is now deleting. */
  state: 'open' | 'done';
  sortKey: string;
};

export type Shot = Entity & {
  bulletId: string;
  scope: 'week' | 'day';
  /** 'YYYY-MM-DD'. For week scope, the Monday. */
  date: string;
  /** Portion of the parent bullet's count. Undefined means the whole thing. */
  amount?: number;
  state: 'open' | 'done';
  sortKey: string;
};

export type HuddleResponse = {
  status: 'in' | 'nudge' | 'out';
  note?: string;
  /** For 'nudge' — a counter-offer time. */
  proposedAt?: number;
  at: number;
  /**
   * True for the auto-confirmation written when the huddle was called, false
   * once that person has actually said something. Lets the UI tell "presumed
   * in" apart from "said in", without a second accept step.
   */
  auto?: boolean;
};

export type Huddle = Entity & {
  title?: string;
  startsAt: number;
  durationMin: number;
  calledBy: Person;
  status: 'scheduled' | 'live' | 'done' | 'cancelled';
  /**
   * One field per person, NOT a single `responses` map.
   *
   * Last-write-wins resolves per field, so a combined map means whoever writes
   * second silently erases the other's reply: Angie declines with a note, Clark
   * confirms a second later from a device that hasn't pulled her op yet, and
   * her decline is gone on both phones. Separate fields make the two replies
   * genuinely independent.
   */
  responseClark?: HuddleResponse;
  responseAngie?: HuddleResponse;
};

export const RESPONSE_FIELD: Record<Person, 'responseClark' | 'responseAngie'> = {
  clark: 'responseClark',
  angie: 'responseAngie',
};

export const responseOf = (h: Huddle, p: Person): HuddleResponse | undefined =>
  h[RESPONSE_FIELD[p]];

/** Everyone who has actually said something, as opposed to being presumed in. */
export const hasAnswered = (h: Huddle, p: Person): boolean => {
  const r = responseOf(h, p);
  return Boolean(r) && r!.auto !== true;
};

export type HuddleItem = Entity & {
  huddleId: string;
  /** Either a linked bullet... */
  bulletId?: string;
  /** ...or a freeform agenda line. */
  text?: string;
  lane: 'table' | 'decided';
  decision?: string;
  sortKey: string;
  addedBy: Person;
};

export type AnyEntity = Client | Bullet | Shot | Huddle | HuddleItem;
