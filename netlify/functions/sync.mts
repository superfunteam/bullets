import { getDatabase } from '@netlify/database';
import type { Config } from '@netlify/functions';
import { requirePerson } from '../lib/auth.mts';
import { isPreflight, json, preflight, text } from '../lib/http.mts';

type WireOp = {
  opId: string;
  entity: string;
  entityId: string;
  field: string;
  value: unknown;
  ts: number;
  actor: string;
};

const MAX_OPS_PER_PULL = 2000;

/**
 * Push and pull in a single round trip.
 *
 * Combining directions halves latency on the live huddle board and makes the
 * offline story trivial: the client's outbox drains with no special-case code.
 *
 * The server never interprets an op's value — it only orders ops. That is what
 * lets us add entity types and fields later with no migration and no deploy
 * coordination between the two clients.
 */
export default async (req: Request) => {
  if (isPreflight(req)) return preflight();

  const person = await requirePerson(req);
  if (!person) return text('Unauthorized', 401);

  let body: { since?: number; ops?: WireOp[]; context?: string | null };
  try {
    body = await req.json();
  } catch {
    return text('Bad request', 400);
  }

  const since = Number(body.since ?? 0);
  const ops = Array.isArray(body.ops) ? body.ops : [];
  const context = body.context ?? null;
  const db = getDatabase();

  if (ops.length) {
    // unnest keeps this to one statement regardless of batch size, and
    // `on conflict do nothing` makes client retries idempotent.
    await db.sql`
      insert into ops (op_id, entity, entity_id, field, value, ts, actor)
      select * from unnest(
        ${ops.map(o => o.opId)}::text[],
        ${ops.map(o => o.entity)}::text[],
        ${ops.map(o => o.entityId)}::text[],
        ${ops.map(o => o.field)}::text[],
        ${ops.map(o => JSON.stringify(o.value ?? null))}::jsonb[],
        ${ops.map(o => Math.trunc(o.ts))}::bigint[],
        ${ops.map(() => person)}::text[]
      )
      on conflict (op_id) do nothing
    `;
  }

  if (context) {
    await db.sql`
      insert into presence (person, context, seen_at)
      values (${person}, ${context}, now())
      on conflict (person) do update
        set context = excluded.context, seen_at = now()
    `;
  }

  /**
   * The overlap is a WATERMARK on the cursor, not an OR-clause on the read.
   *
   * `seq` is a bigserial, allocated BEFORE commit: a reader can see seq 503
   * while 500-502 are uncommitted. The old guard re-delivered the last 30
   * seconds of rows — which only works if the reader polls again within 30
   * seconds. A locked iPhone or a closed laptop lid routinely sleeps longer,
   * and a device that persisted a cursor past the gap then skipped those ops
   * FOREVER: a task saved on one phone that never appears on the other, with
   * no error anywhere.
   *
   * So the cursor the client is allowed to keep never advances past the
   * newest op old enough that everything before it has certainly committed
   * (Netlify functions time out far under 30s, so an allocated transaction
   * has committed or aborted by then). Rows younger than the watermark are
   * still DELIVERED immediately — they just re-deliver on later polls until
   * the watermark passes them. Re-delivery is free: applyOp is idempotent.
   *
   * Dropping the OR-clause also fixes pagination: a catch-up after an
   * offline stretch used to re-include the last-30s rows on every page.
   */
  const watermarkRows = (await db.sql`
    select coalesce(max(seq), 0) as watermark
    from ops
    where created_at <= now() - interval '30 seconds'
  `) as Array<{ watermark: number | string }>;
  const watermark = Number(watermarkRows[0]?.watermark ?? 0);

  const rows = (await db.sql`
    select seq, op_id, entity, entity_id, field, value, ts, actor
    from ops
    where seq > ${since}
    order by seq asc
    limit ${MAX_OPS_PER_PULL}
  `) as Array<Record<string, unknown>>;

  const here = context
    ? ((await db.sql`
        select person from presence
        where context = ${context} and seen_at > now() - interval '15 seconds'
      `) as Array<{ person: string }>)
    : [];

  const lastSeq = rows.length ? Number(rows[rows.length - 1].seq) : since;
  return json({
    // The client may not advance past the watermark — young rows re-deliver.
    seq: Math.max(since, Math.min(lastSeq, watermark)),
    ops: rows.map(r => ({
      opId: r.op_id,
      entity: r.entity,
      entityId: r.entity_id,
      field: r.field,
      value: r.value,
      ts: Number(r.ts),
      actor: r.actor,
    })),
    presence: here.map(r => r.person),
  });
};

export const config: Config = {
  path: '/api/sync',
  method: ['POST', 'OPTIONS'],
};
