import { describe, it, expect } from 'vitest';
import { isNewer } from './update';

describe('isNewer', () => {
  it('detects a newer patch', () => {
    expect(isNewer('1.0.2', '1.0.1')).toBe(true);
  });

  it('is false for the same version', () => {
    expect(isNewer('1.0.1', '1.0.1')).toBe(false);
  });

  it('is false for an older version', () => {
    expect(isNewer('1.0.0', '1.0.1')).toBe(false);
  });

  it('tolerates a leading v on either side', () => {
    expect(isNewer('v1.1.0', '1.0.9')).toBe(true);
    expect(isNewer('1.0.9', 'v1.1.0')).toBe(false);
  });

  it('compares segments numerically, not as strings', () => {
    // The bug a string compare would introduce: '1.10.0' < '1.9.0'
    expect(isNewer('1.10.0', '1.9.0')).toBe(true);
    expect(isNewer('1.9.0', '1.10.0')).toBe(false);
  });

  it('handles differing segment counts', () => {
    expect(isNewer('1.2.1', '1.2')).toBe(true);
    expect(isNewer('1.2', '1.2.0')).toBe(false);
  });

  it('ignores a prerelease suffix on the numeric comparison', () => {
    expect(isNewer('1.1.0-beta', '1.0.0')).toBe(true);
  });
});
