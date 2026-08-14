import Dexie, { type Table } from 'dexie';
import type { Materialized, Op } from './ops';
import type { EntityKind, Person } from './types';

/**
 * One field write, kept forever, so the app can say who did what.
 *
 * The server's ops table is already a complete audit trail and is never
 * truncated — this mirrors it locally so history works offline and does not
 * need a round trip to read.
 */
export type HistoryRow = {
  /** Primary key, and the whole dedupe story: the same op put twice is one row. */
  opId: string;
  /** Ops written by one user action share this. See history.ts:actionKeyOf. */
  actionId: string;
  ts: number;
  actor: Person;
  entity: string;
  entityId: string;
  field: string;
  value: unknown;
  /** The bullet this is really about, so a shot row can be found by its bullet. */
  subjectId?: string;
  /** subjectId plus its ancestors — multiEntry, so a parent finds its pieces. */
  about: string[];
};

/**
 * Entities are stored already materialized (with their _ts/_op clocks) so a
 * read is a plain table lookup rather than an op replay.
 */
export class BulletsDB extends Dexie {
  clients!: Table<Materialized, string>;
  bullets!: Table<Materialized, string>;
  shots!: Table<Materialized, string>;
  huddles!: Table<Materialized, string>;
  huddleItems!: Table<Materialized, string>;
  outbox!: Table<Op, string>;
  meta!: Table<{ key: string; value: unknown }, string>;
  /** The audit trail. One row per FIELD written, grouped into actions on read. */
  history!: Table<HistoryRow, string>;

  constructor(name = 'bullets') {
    super(name);
    this.version(1).stores({
      clients: 'id, name, archived',
      bullets: 'id, clientId, parentId, horizon, deadline, state, sortKey',
      shots: 'id, bulletId, date, scope, state, sortKey, [scope+date]',
      huddles: 'id, startsAt, status',
      huddleItems: 'id, huddleId, lane, sortKey',
      outbox: 'opId, ts',
      meta: 'key',
    });

    /**
     * Additive only. Listing just the new store carries every v1 store forward
     * untouched, so nobody's data is rebuilt to gain a history table.
     *
     * `history` is deliberately NOT in the TABLES map below: it is not an
     * entity, and applyOp must never try to materialise into it.
     */
    this.version(2).stores({
      history: 'opId, ts, actionId, entityId, field, [actor+ts], *about',
    });
  }
}

export const db = new BulletsDB();

export const TABLES: Record<EntityKind, () => Table<Materialized, string>> = {
  client: () => db.clients,
  bullet: () => db.bullets,
  shot: () => db.shots,
  huddle: () => db.huddles,
  huddleItem: () => db.huddleItems,
};

export const ENTITY_TABLES = [
  db.clients,
  db.bullets,
  db.shots,
  db.huddles,
  db.huddleItems,
];
