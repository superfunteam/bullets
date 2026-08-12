import Dexie, { type Table } from 'dexie';
import type { Materialized, Op } from './ops';
import type { EntityKind } from './types';

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
