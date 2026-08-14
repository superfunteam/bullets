import { describe as suite, expect, it } from 'vitest';
import {
  actionKeyOf,
  buildNames,
  describe,
  entriesFrom,
  groupOps,
  horizonWord,
  isAuto,
  nameAsOf,
  type DescribeCtx,
} from './history';
import type { HistoryRow } from './db';

/**
 * The log is field-level; Clark asked for actions. These pin the translation.
 */

let seq = 0;
const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  opId: `act-${++seq}:0`,
  actionId: `act-${seq}`,
  ts: 1_000,
  actor: 'clark',
  entity: 'bullet',
  entityId: 'b1',
  field: 'title',
  value: 'Halcyon deck',
  subjectId: 'b1',
  about: ['b1'],
  ...over,
});

/** Ops from one action share the id and differ only in the counter. */
const action = (id: string, parts: Partial<HistoryRow>[], ts = 2_000): HistoryRow[] =>
  parts.map((p, i) => row({ opId: `${id}:${i}`, actionId: id, ts, ...p }));

const ctx = (rows: HistoryRow[] = [], clients: [string, string][] = []): DescribeCtx => ({
  names: buildNames(rows),
  titles: new Map(),
  clients: new Map(clients),
});

const textOf = (rows: HistoryRow[], c = ctx(rows)) => describe(rows, c).text;

suite('action grouping', () => {
  it('groups every field of one tap into one entry', () => {
    const g = action('a1', [
      { field: 'state', value: 'done' },
      { field: 'title', value: 'Site copy' },
    ]);
    expect(groupOps(g)).toHaveLength(1);
  });

  it('falls back to actor and timestamp for ops written before action ids', () => {
    // Legacy ops carry a bare uuid. mutate() stamps every op in one call with
    // the same hybrid-clock ts, so this recovers the real grouping.
    const legacy = [
      row({ opId: 'bare-uuid-1', ts: 5_000, field: 'title', value: 'A' }),
      row({ opId: 'bare-uuid-2', ts: 5_000, field: 'state', value: 'open' }),
    ];
    expect(groupOps(legacy)).toHaveLength(1);
    expect(actionKeyOf(legacy[0])).toBe('legacy:clark:5000');
  });

  it('keeps two different people apart even at the same instant', () => {
    const both = [
      row({ opId: 'x1', ts: 7_000, actor: 'clark' }),
      row({ opId: 'x2', ts: 7_000, actor: 'angie' }),
    ];
    expect(groupOps(both)).toHaveLength(2);
  });

  it('knows a machine write from a person', () => {
    expect(isAuto('auto-abc')).toBe(true);
    expect(isAuto('abc')).toBe(false);
  });
});

suite('sentences', () => {
  it('names the horizon a bullet was created on', () => {
    const g = action('a2', [
      { field: 'title', value: 'Draft the invoice' },
      { field: 'state', value: 'open' },
      { field: 'horizon', value: 'shelf' },
    ]);
    expect(textOf(g)).toBe('Clark added “Draft the invoice” to The Shelf.');
  });

  it('calls a sub-bullet a piece', () => {
    const parent = row({ entityId: 'p1', subjectId: 'p1', ts: 500, value: 'Halcyon deck' });
    const g = action('a3', [
      { field: 'title', value: 'Write the intro', entityId: 'c1', subjectId: 'c1' },
      { field: 'state', value: 'open', entityId: 'c1', subjectId: 'c1' },
      { field: 'parentId', value: 'p1', entityId: 'c1', subjectId: 'c1' },
    ]);
    expect(textOf(g, ctx([parent, ...g]))).toBe(
      'Clark added “Write the intro” as a piece of “Halcyon deck”.',
    );
  });

  it('prints both sides of a rename', () => {
    const first = row({ ts: 100, field: 'title', value: 'Halcyon rebrand deck' });
    const g = action('a4', [{ field: 'title', value: 'Halcyon deck v2' }], 9_000);
    expect(textOf(g, ctx([first, ...g]))).toBe(
      'Clark renamed “Halcyon rebrand deck” to “Halcyon deck v2”.',
    );
  });

  it('lists the pieces a parent finished', () => {
    const names = [
      row({ ts: 10, entityId: 'p1', subjectId: 'p1', value: 'Q3 launch' }),
      row({ ts: 11, entityId: 'c1', subjectId: 'c1', value: 'Site copy' }),
      row({ ts: 12, entityId: 'c2', subjectId: 'c2', value: 'Deck' }),
    ];
    const g = action('a5', [
      { field: 'state', value: 'done', entityId: 'p1', subjectId: 'p1', about: ['p1'] },
      { field: 'state', value: 'done', entityId: 'c1', subjectId: 'c1', about: ['c1', 'p1'] },
      { field: 'state', value: 'done', entityId: 'c2', subjectId: 'c2', about: ['c2', 'p1'] },
    ]);
    const e = describe(g, ctx([...names, ...g]));
    // The parent is the headline; the pieces are detail, not three more entries.
    expect(e.text).toBe('Clark marked “Q3 launch” done.');
    expect(e.detail).toEqual(['Site copy', 'Deck']);
  });

  it('says took it off today rather than moved it to the Shelf', () => {
    const g = action('a6', [
      { field: 'horizon', value: 'shelf' },
      { field: 'deletedAt', value: 123, entity: 'shot', entityId: 's1', subjectId: 'b1' },
    ]);
    expect(textOf(g, ctx([row({ ts: 1, value: 'Site copy' }), ...g]))).toBe(
      'Clark took “Site copy” off today.',
    );
  });

  it('counts a bulk action instead of listing it', () => {
    const g = action('a7', [
      { field: 'state', value: 'done', entityId: 'b1', subjectId: 'b1', about: ['b1'] },
      { field: 'state', value: 'done', entityId: 'b2', subjectId: 'b2', about: ['b2'] },
      { field: 'state', value: 'done', entityId: 'b3', subjectId: 'b3', about: ['b3'] },
    ]);
    expect(textOf(g)).toBe('Clark marked 3 things done.');
  });

  it('names no person for a machine write', () => {
    const g = action('auto-x', [{ field: 'horizon', value: 'now' }]);
    const e = describe(g, ctx([row({ ts: 1, value: 'Halcyon deck' }), ...g]));
    // settleFromOps derives completion on whichever phone pulled first, and the
    // server stamps the actor with whoever pushed — so naming a person here
    // would durably credit the wrong one. Naming none makes that invisible.
    expect(e.actor).toBeNull();
    expect(e.text).toBe('Bullets put “Halcyon deck” on Today.');
  });

  it('never renders blank or throws on a field it does not know', () => {
    const g = action('a8', [{ field: 'somethingNew', value: 42 }]);
    const e = describe(g, ctx([row({ ts: 1, value: 'Site copy' }), ...g]));
    expect(e.text).toContain('changed somethingNew');
    expect(e.text.length).toBeGreaterThan(0);
  });
});

suite('retired horizons still read', () => {
  it('keeps the word the op was written with', () => {
    // 'soon' and 'later' were retired without rewriting a row, so the log is
    // full of them forever. They must render as what they meant.
    expect(horizonWord('soon')).toBe('Soon');
    expect(horizonWord('later')).toBe('Later');
    expect(horizonWord('shelf')).toBe('The Shelf');
    expect(horizonWord('now')).toBe('Today');
    expect(horizonWord('next')).toBe('This Week');
  });

  it('renders a horizon from a future build rather than crashing', () => {
    expect(horizonWord('someday')).toBe('someday');
    const g = action('a9', [{ field: 'horizon', value: 'someday' }]);
    expect(() => describe(g, ctx(g))).not.toThrow();
  });
});

suite('names as of the moment', () => {
  it('uses the title the bullet had that day', () => {
    const names = buildNames([
      row({ ts: 100, value: 'First name' }),
      row({ ts: 500, value: 'Second name' }),
    ]);
    expect(nameAsOf(names, 'b1', 300)).toBe('First name');
    expect(nameAsOf(names, 'b1', 900)).toBe('Second name');
    // Before any title op we still say something rather than nothing.
    expect(nameAsOf(names, 'b1', 50)).toBe('First name');
    expect(nameAsOf(names, 'nope', 100)).toBeNull();
  });
});

suite('the whole pipeline', () => {
  it('returns entries newest first', () => {
    const rows = [
      ...action('a', [{ field: 'state', value: 'done' }], 1_000),
      ...action('b', [{ field: 'state', value: 'done' }], 3_000),
      ...action('c', [{ field: 'state', value: 'done' }], 2_000),
    ];
    const out = entriesFrom(rows, ctx(rows));
    expect(out.map(e => e.ts)).toEqual([3_000, 2_000, 1_000]);
  });
});
