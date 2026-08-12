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
  now: { label: 'NOW', blurb: 'Super urgent, right now', emoji: '🔥', hue: 25 },
  next: { label: 'NEXT', blurb: 'As soon as we can', emoji: '⚡', hue: 70 },
  soon: { label: 'SOON', blurb: 'In the near future', emoji: '🌤', hue: 220 },
  later: { label: 'LATER', blurb: 'In the distant future', emoji: '🌙', hue: 275 },
  shelf: { label: 'SHELF', blurb: 'To be decided on', emoji: '📚', hue: 150 },
};

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

/** Classic bullet journal signifiers: a dot, a circle, a dash. */
export const KIND_GLYPH: Record<BulletKind, string> = {
  task: '•',
  event: '○',
  note: '—',
};

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
  state: 'open' | 'done' | 'dropped';
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
