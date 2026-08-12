import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';

/**
 * Replaying the whole log on a fresh device gets slow eventually, so this
 * writes a snapshot a new device can start from.
 *
 * The log itself is never truncated — it is our free history and undo
 * substrate, and at two people's volume it stays small for years.
 */
export default async () => {
  const db = getDatabase();

  const rows = (await db.sql`
    select seq, op_id, entity, entity_id, field, value, ts, actor
    from ops order by seq asc
  `) as Array<Record<string, unknown>>;

  const seq = rows.length ? Number(rows[rows.length - 1].seq) : 0;

  await getStore('bullets-snapshots').setJSON('latest', {
    seq,
    takenAt: new Date().toISOString(),
    ops: rows.map(r => ({
      opId: r.op_id,
      entity: r.entity,
      entityId: r.entity_id,
      field: r.field,
      value: r.value,
      ts: Number(r.ts),
      actor: r.actor,
    })),
  });

  // Presence rows are ephemeral; anything stale is noise.
  await db.sql`delete from presence where seen_at < now() - interval '1 day'`;

  return new Response(`Compacted ${rows.length} ops through seq ${seq}`);
};

export const config: Config = { schedule: '@daily' };
