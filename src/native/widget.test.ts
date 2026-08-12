import { describe, expect, it } from 'vitest';
import { widgetPayloadSignature } from './widget';

describe('widgetPayloadSignature', () => {
  it('ignores timestamp-only changes that do not affect the widget display', () => {
    const visible = { date: '2026-08-12', openCount: 2, titles: ['Write copy', 'Send invoice'] };

    expect(widgetPayloadSignature({ ...visible, updatedAt: 1 })).toBe(
      widgetPayloadSignature({ ...visible, updatedAt: 2 }),
    );
  });

  it('changes when the visible widget content changes', () => {
    expect(
      widgetPayloadSignature({ date: '2026-08-12', openCount: 2, titles: ['Write copy'], updatedAt: 1 }),
    ).not.toBe(
      widgetPayloadSignature({ date: '2026-08-12', openCount: 3, titles: ['Write copy'], updatedAt: 1 }),
    );
  });
});
