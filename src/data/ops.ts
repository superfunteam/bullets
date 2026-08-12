import type { AnyEntity, EntityKind, Person } from './types';

/**
 * Every mutation in Bullets is one or more field-level ops appended to a log.
 * The server never interprets `value` — it only orders ops — which is what
 * lets us add entity types and fields without a migration.
 */
export type Op = {
  opId: string;
  entity: EntityKind;
  entityId: string;
  field: string;
  value: unknown;
  /** Client clock at write time. Drives last-write-wins. */
  ts: number;
  actor: Person;
};

/**
 * An entity plus the per-field bookkeeping that makes last-write-wins work.
 *
 * `_by` is not needed for convergence — it is kept so the app can say who
 * finished something and when, without re-reading the server's op log. In a
 * two-person space that attribution is most of what history is for.
 */
export type Materialized = AnyEntity & {
  _ts: Record<string, number>;
  _op: Record<string, string>;
  _by: Record<string, Person>;
};

/**
 * Fold one op into a record.
 *
 * Pure, idempotent, and order-independent: applying any set of ops in any
 * order yields the same result on every device. That property is what makes
 * the live Huddle board safe without CRDTs.
 */
export function applyOp(rec: Materialized | undefined, op: Op): Materialized {
  const base: Materialized =
    rec ??
    ({
      id: op.entityId,
      createdAt: op.ts,
      updatedAt: op.ts,
      _ts: {},
      _op: {},
      _by: {},
    } as Materialized);

  // The timestamp envelope folds over every op we see, including ones whose
  // value loses. Skipping it here would make createdAt depend on arrival
  // order, which breaks convergence between devices.
  const envelope = {
    createdAt: Math.min(base.createdAt, op.ts),
    updatedAt: Math.max(base.updatedAt, op.ts),
  };

  const seenTs = base._ts[op.field];
  const loses =
    seenTs !== undefined &&
    (op.ts < seenTs ||
      // Equal clocks: the larger opId wins. Arbitrary, but identical everywhere.
      (op.ts === seenTs && op.opId <= (base._op[op.field] ?? '')));

  if (loses) return { ...base, ...envelope };

  return {
    ...base,
    ...envelope,
    [op.field]: op.value,
    _ts: { ...base._ts, [op.field]: op.ts },
    _op: { ...base._op, [op.field]: op.opId },
    _by: { ...base._by, [op.field]: op.actor },
  } as Materialized;
}

/** Strip sync bookkeeping before handing an entity to the UI. */
export function clean<T extends AnyEntity>(rec: Materialized): T {
  const { _ts: _ignoredTs, _op: _ignoredOp, _by: _ignoredBy, ...rest } = rec;
  return rest as unknown as T;
}

/**
 * When a specific field was last written, and by whom if we know.
 *
 * `by` is optional because every record written before attribution existed has
 * a timestamp and no actor. Requiring both would throw away a date we do have
 * and blank the history of everything already in the space.
 */
export type FieldStamp = { at: number; by?: Person };

export function stampOf(rec: Materialized | undefined, field: string): FieldStamp | undefined {
  const at = rec?._ts?.[field];
  if (at === undefined) return undefined;
  return { at, by: rec?._by?.[field] };
}
