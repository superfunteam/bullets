import type { HistoryRow } from './db';
import { personName, type Person } from './types';

/**
 * Field ops in, sentences out. Pure — no Dexie, no React, no clock.
 *
 * The log is FIELD level and Clark asked for ACTIONS: one tap of "Mark done" on
 * a counted parent writes a dozen ops across several entities. So ops are
 * grouped by the action id that mutations.ts encodes into opId, then the SHAPE
 * of the group decides the sentence.
 */

export type Entry = {
  key: string;
  ts: number;
  /** null for machine writes: they speak as the app and name no person. */
  actor: Person | null;
  text: string;
  /** Sub-lines, e.g. the pieces a parent finished. */
  detail: string[];
  subjectId?: string;
  rows: HistoryRow[];
};

/**
 * Ops from one user action share a `${actionId}:${n}` opId.
 *
 * Anything older, or written by a client that predates this, falls back to
 * (actor, ts) — which is exactly right, because mutate() stamps every op in one
 * call with the same hybrid-clock timestamp. crypto uuids never contain a
 * colon, so the guard is total.
 */
export function actionKeyOf(row: { opId: string; actor: Person; ts: number }): string {
  const i = row.opId.lastIndexOf(':');
  return i > 0 ? row.opId.slice(0, i) : `legacy:${row.actor}:${row.ts}`;
}

export const isAuto = (key: string): boolean => key.startsWith('auto-');

/**
 * What a horizon value MEANT when it was written.
 *
 * HORIZON_META is what you can PICK. This is what you can READ, and it has more
 * answers: 'soon' and 'later' were retired without rewriting a row, so the log
 * is full of them forever. Deleting the retired entries in a later tidy-up
 * re-breaks every old row. The default arm is forward compatibility too — a
 * phone one release behind must render a value it has never heard of rather
 * than white-screen.
 */
const HISTORY_HORIZON: Record<string, string> = {
  now: 'Today',
  next: 'This Week',
  soon: 'Soon',
  later: 'Later',
  shelf: 'The Shelf',
};

export const horizonWord = (v: unknown): string =>
  HISTORY_HORIZON[String(v)] ?? String(v ?? 'somewhere');

/* --------------------------------------------------------------- names */

export type NameIndex = Map<string, { ts: number; value: string }[]>;

/** Build the title timeline from the log itself. One pass, no joins. */
export function buildNames(rows: HistoryRow[]): NameIndex {
  const out: NameIndex = new Map();
  for (const r of rows) {
    if (r.field !== 'title' || typeof r.value !== 'string') continue;
    const list = out.get(r.entityId) ?? [];
    list.push({ ts: r.ts, value: r.value });
    out.set(r.entityId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.ts - b.ts);
  return out;
}

/**
 * The name a thing had AT THE TIME. A bullet renamed twice and then deleted
 * still reads with the title it carried that day.
 */
export function nameAsOf(names: NameIndex, id: string | undefined, ts: number): string | null {
  if (!id) return null;
  const list = names.get(id);
  if (!list?.length) return null;
  let found: string | null = null;
  for (const n of list) {
    if (n.ts <= ts) found = n.value;
    else break;
  }
  return found ?? list[0].value;
}

/** The title immediately before this moment — the other half of a rename. */
export function nameBefore(names: NameIndex, id: string, ts: number): string | null {
  const list = names.get(id);
  if (!list?.length) return null;
  let prev: string | null = null;
  for (const n of list) {
    if (n.ts < ts) prev = n.value;
    else break;
  }
  return prev;
}

/* ------------------------------------------------------------- grouping */

export function groupOps(rows: HistoryRow[]): HistoryRow[][] {
  const byKey = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const k = actionKeyOf(r);
    const g = byKey.get(k);
    if (g) g.push(r);
    else byKey.set(k, [r]);
  }
  return [...byKey.values()].sort((a, b) => Math.max(...b.map(r => r.ts)) - Math.max(...a.map(r => r.ts)));
}

/* ------------------------------------------------------------ sentences */

const field = (g: HistoryRow[], name: string) => g.find(r => r.field === name);
const has = (g: HistoryRow[], name: string, value?: unknown) =>
  g.some(r => r.field === name && (value === undefined || r.value === value));

function quoted(name: string | null, fallback = 'a bullet'): string {
  return name ? `“${name}”` : fallback;
}

export type DescribeCtx = {
  names: NameIndex;
  /** Current titles, for anything the log never saw a title op for. */
  titles: Map<string, string>;
  clients: Map<string, string>;
};

export function describe(group: HistoryRow[], ctx: DescribeCtx): Entry {
  const key = actionKeyOf(group[0]);
  const auto = isAuto(key);
  const ts = Math.max(...group.map(r => r.ts));
  const actor = auto ? null : group[0].actor;
  const who = auto ? 'Bullets' : personName(group[0].actor);

  const subjects = [...new Set(group.map(r => r.subjectId).filter(Boolean))] as string[];

  /**
   * A parent finishing its pieces touches several bullets, but it is ONE thing
   * that happened, not a bulk action. `about` carries each subject's ancestry,
   * so the headline is whichever subject every other subject descends from.
   */
  const root = subjects.find(candidate =>
    subjects.every(
      other =>
        other === candidate ||
        group.some(r => r.subjectId === other && r.about.includes(candidate)),
    ),
  );
  const subjectId = root ?? subjects[0];
  const name =
    nameAsOf(ctx.names, subjectId, ts) ?? (subjectId ? (ctx.titles.get(subjectId) ?? null) : null);
  const it = quoted(name);

  const entry = (text: string, detail: string[] = []): Entry => ({
    key,
    ts,
    actor,
    text,
    detail,
    subjectId,
    rows: group,
  });

  // Genuinely unrelated subjects read as counts, not as twelve lines.
  if (subjects.length > 1 && !root) {
    const n = subjects.length;
    if (has(group, 'state', 'done')) return entry(`${who} marked ${n} things done.`);
    if (has(group, 'deletedAt')) return entry(`${who} deleted ${n} things.`);
    if (field(group, 'horizon')) {
      return entry(`${who} moved ${n} things to ${horizonWord(field(group, 'horizon')!.value)}.`);
    }
  }

  if (has(group, 'deletedAt') && group.some(r => r.entity === 'bullet' && r.field === 'deletedAt')) {
    return entry(`${who} deleted ${it}.`);
  }

  const title = field(group, 'title');
  const state = field(group, 'state');
  const horizon = field(group, 'horizon');

  // Creation: a title arriving together with an initial state.
  if (title && state?.value === 'open') {
    const parent = field(group, 'parentId');
    if (parent?.value) {
      const parentName = nameAsOf(ctx.names, String(parent.value), ts);
      return entry(`${who} added ${it} as a piece of ${quoted(parentName, 'another bullet')}.`);
    }
    return entry(`${who} added ${it} to ${horizonWord(horizon?.value ?? 'shelf')}.`);
  }

  if (title && !state) {
    const was = subjectId ? nameBefore(ctx.names, subjectId, ts) : null;
    // The one entry that prints both sides, so an as-of name never leaves you
    // hunting for something you cannot find on screen.
    if (was && was !== title.value) return entry(`${who} renamed “${was}” to “${title.value}”.`);
    return entry(`${who} renamed ${it}.`);
  }

  if (state?.value === 'done') {
    const pieces = group
      .filter(r => r.entity === 'bullet' && r.field === 'state' && r.entityId !== subjectId)
      .map(r => nameAsOf(ctx.names, r.entityId, ts))
      .filter(Boolean) as string[];
    return entry(`${who} marked ${it} done.`, pieces);
  }

  if (state?.value === 'open') return entry(`${who} reopened ${it}.`);

  if (horizon) {
    const word = horizonWord(horizon.value);
    // A day shot being tombstoned alongside a park is "took it off today".
    const droppedDay = group.some(
      r => r.entity === 'shot' && r.field === 'deletedAt' && r.value !== undefined,
    );
    if (horizon.value === 'shelf' && droppedDay) return entry(`${who} took ${it} off today.`);
    if (horizon.value === 'now') return entry(`${who} put ${it} on Today.`);
    return entry(`${who} moved ${it} to ${word}.`);
  }

  const deadline = field(group, 'deadline');
  if (deadline) {
    return deadline.value
      ? entry(`${who} set the target on ${it} to ${String(deadline.value)}.`)
      : entry(`${who} cleared the target on ${it}.`);
  }

  const count = field(group, 'count');
  if (count && count.value && typeof count.value === 'object') {
    const c = count.value as { total?: number; unit?: string };
    return entry(`${who} set ${it} to ${c.total ?? '?'} ${c.unit ?? 'parts'}.`);
  }

  const clientId = field(group, 'clientId');
  if (clientId) {
    const cname = ctx.clients.get(String(clientId.value));
    return cname
      ? entry(`${who} filed ${it} under ${cname}.`)
      : entry(`${who} changed the client on ${it}.`);
  }

  if (field(group, 'note')) return entry(`${who} changed the note on ${it}.`);

  // Shots on their own: a commitment made or a chunk done.
  const shotState = group.find(r => r.entity === 'shot' && r.field === 'state');
  if (shotState?.value === 'done') return entry(`${who} did some of ${it}.`);
  if (group.some(r => r.entity === 'shot' && r.field === 'date')) {
    return entry(`${who} scheduled ${it}.`);
  }

  if (group.some(r => r.entity === 'huddle')) {
    if (has(group, 'status', 'done')) return entry(`${who} wrapped a huddle.`);
    if (field(group, 'startsAt')) return entry(`${who} called a huddle.`);
    return entry(`${who} updated a huddle.`);
  }
  if (group.some(r => r.entity === 'huddleItem')) {
    if (field(group, 'decision')) return entry(`${who} decided an agenda item.`);
    return entry(`${who} changed the agenda.`);
  }
  if (group.some(r => r.entity === 'client')) return entry(`${who} changed a client.`);

  // Never blank, never a crash. The raw ops are one tap away in the view.
  return entry(`${who} changed ${group[0].field}${subjectId ? ` on ${it}` : ''}.`);
}

/** The whole pipeline: rows → entries, newest first. */
export function entriesFrom(rows: HistoryRow[], ctx: DescribeCtx): Entry[] {
  return groupOps(rows).map(g => describe(g, ctx));
}
