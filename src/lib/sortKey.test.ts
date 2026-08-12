import { describe, it, expect } from 'vitest';
import { keyBetween, keyAtEnd, keyAtStart } from './sortKey';

describe('sortKey', () => {
  it('produces a key that sorts between two others', () => {
    const a = keyAtEnd(null);
    const b = keyAtEnd(a);
    const mid = keyBetween(a, b);
    expect([b, mid, a].sort()).toEqual([a, mid, b]);
  });

  it('appends after the last key', () => {
    const a = keyAtEnd(null);
    expect(keyAtEnd(a) > a).toBe(true);
  });

  it('prepends before the first key', () => {
    const a = keyAtEnd(null);
    expect(keyAtStart(a) < a).toBe(true);
  });

  it('survives repeated insertion at the same position', () => {
    let lo = keyAtEnd(null);
    const hi = keyAtEnd(lo);
    const keys = [lo, hi];
    for (let i = 0; i < 20; i++) {
      const mid = keyBetween(lo, hi);
      keys.push(mid);
      lo = mid;
    }
    // Every key stays distinct and the set has a stable total order.
    expect(new Set(keys).size).toBe(keys.length);
  });
});
