import { describe, it, expect } from 'vitest';
import { applyOp, clean, type Op } from './ops';

const op = (over: Partial<Op>): Op => ({
  opId: 'op-1',
  entity: 'bullet',
  entityId: 'b1',
  field: 'title',
  value: 'Hello',
  ts: 1000,
  actor: 'clark',
  ...over,
});

describe('applyOp', () => {
  it('creates a record from the first op', () => {
    const rec = applyOp(undefined, op({}));
    expect((rec as never as { title: string }).title).toBe('Hello');
    expect(rec.id).toBe('b1');
  });

  it('applies a newer op over an older value', () => {
    const a = applyOp(undefined, op({ opId: 'x', ts: 1000, value: 'Old' }));
    const b = applyOp(a, op({ opId: 'y', ts: 2000, value: 'New' }));
    expect((b as never as { title: string }).title).toBe('New');
  });

  it('ignores an op older than the current value', () => {
    const a = applyOp(undefined, op({ opId: 'x', ts: 2000, value: 'New' }));
    const b = applyOp(a, op({ opId: 'y', ts: 1000, value: 'Old' }));
    expect((b as never as { title: string }).title).toBe('New');
  });

  it('is idempotent — replaying the same op changes nothing', () => {
    const once = applyOp(undefined, op({}));
    const twice = applyOp(once, op({}));
    expect(twice).toEqual(once);
  });

  it('breaks simultaneous-clock ties deterministically regardless of arrival order', () => {
    const fromA = applyOp(
      applyOp(undefined, op({ opId: 'aaa', ts: 5, value: 'A' })),
      op({ opId: 'bbb', ts: 5, value: 'B' }),
    );
    const fromB = applyOp(
      applyOp(undefined, op({ opId: 'bbb', ts: 5, value: 'B' })),
      op({ opId: 'aaa', ts: 5, value: 'A' }),
    );
    expect((fromA as never as { title: string }).title)
      .toBe((fromB as never as { title: string }).title);
  });

  it('resolves different fields independently', () => {
    let rec = applyOp(undefined, op({ field: 'title', value: 'T', ts: 3000 }));
    rec = applyOp(rec, op({ opId: 'z', field: 'horizon', value: 'now', ts: 1000 }));
    expect((rec as never as { title: string }).title).toBe('T');
    expect((rec as never as { horizon: string }).horizon).toBe('now');
  });

  it('tracks updatedAt as the newest op clock seen', () => {
    let rec = applyOp(undefined, op({ ts: 1000 }));
    rec = applyOp(rec, op({ opId: 'z', field: 'note', value: 'n', ts: 4000 }));
    expect(rec.updatedAt).toBe(4000);
  });

  it('converges no matter what order a batch of ops arrives in', () => {
    const batch: Op[] = [
      op({ opId: 'a', field: 'title', value: 'One', ts: 10 }),
      op({ opId: 'b', field: 'title', value: 'Two', ts: 30 }),
      op({ opId: 'c', field: 'horizon', value: 'next', ts: 20 }),
      op({ opId: 'd', field: 'state', value: 'done', ts: 25 }),
    ];
    const fold = (ops: Op[]) => ops.reduce<ReturnType<typeof applyOp> | undefined>(
      (rec, o) => applyOp(rec, o), undefined,
    );

    const forward = fold(batch);
    const backward = fold([...batch].reverse());
    const shuffled = fold([batch[2], batch[0], batch[3], batch[1]]);

    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });
});

describe('clean', () => {
  it('strips sync bookkeeping before the UI sees an entity', () => {
    const rec = applyOp(undefined, op({}));
    const out = clean(rec) as Record<string, unknown>;
    expect(out._ts).toBeUndefined();
    expect(out._op).toBeUndefined();
    expect(out.title).toBe('Hello');
  });
});
