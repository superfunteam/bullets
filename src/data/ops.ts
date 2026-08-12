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

/** An entity plus the per-field clocks that make last-write-wins work. */
export type Materialized = AnyEntity & {
  _ts: Record<string, number>;
  _op: Record<string, string>;
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
  } as Materialized;
}

/** Strip sync bookkeeping before handing an entity to the UI. */
export function clean<T extends AnyEntity>(rec: Materialized): T {
  const { _ts: _ignoredTs, _op: _ignoredOp, ...rest } = rec;
  return rest as unknown as T;
}
