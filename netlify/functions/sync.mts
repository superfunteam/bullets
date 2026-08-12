import { getDatabase } from '@netlify/database';
import type { Config } from '@netlify/functions';
import { requirePerson } from '../lib/auth.mts';

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
  const person = await requirePerson(req);
  if (!person) return new Response('Unauthorized', { status: 401 });

  let body: { since?: number; ops?: WireOp[]; context?: string | null };
  try {
    body = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
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

  return Response.json({
    seq: rows.length ? Number(rows[rows.length - 1].seq) : since,
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
  method: 'POST',
};
