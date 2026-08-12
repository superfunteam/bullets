import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db, ENTITY_TABLES } from '../data/db';
import { enqueue, pending } from '../data/outbox';
import { setPace, syncOnce, currentInterval, presence, syncState } from './client';
import type { Op } from '../data/ops';

const op = (over: Partial<Op> = {}): Op => ({
  opId: 'local-1',
  entity: 'bullet',
  entityId: 'b1',
  field: 'title',
  value: 'Local',
  ts: 1,
  actor: 'clark',
  ...over,
});

/** Stub /api/sync with a queue of canned responses, recording each request. */
function stubSync(pages: { seq: number; ops: Op[]; presence?: string[] }[]) {
  const calls: { since: number; ops: Op[]; context: string | null }[] = [];
  const urls: string[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      urls.push(url);
      if (url.includes('/api/auth')) {
        return new Response(JSON.stringify({ person: 'clark', token: 'clark.tok' }), { status: 200 });
      }
      calls.push(JSON.parse(init.body));
      const page = pages[Math.min(i, pages.length - 1)];
      i += 1;
      return new Response(JSON.stringify(page), { status: 200 });
    }),
  );
  return Object.assign(calls, { urls });
}

beforeEach(async () => {
  await Promise.all([...ENTITY_TABLES.map(t => t.clear()), db.outbox.clear(), db.meta.clear()]);
  localStorage.setItem('bullets.token', 'clark.test-token');
  localStorage.setItem('bullets.person', 'clark');
  setPace('idle', null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncOnce', () => {
  it('drains the outbox and applies the ops it gets back', async () => {
    await enqueue([op()]);
    stubSync([
      {
        seq: 7,
        ops: [op({ opId: 'remote-1', entityId: 'b2', value: 'Remote', ts: 2, actor: 'angie' })],
        presence: ['angie'],
      },
    ]);

    await syncOnce();

    expect(await db.outbox.count()).toBe(0);
    expect(((await db.bullets.get('b2')) as unknown as { title: string }).title).toBe('Remote');
    expect((await db.meta.get('cursor'))?.value).toBe(7);
    expect(presence()).toEqual(['angie']);
  });

  it('keeps the outbox intact when the request fails', async () => {
    await enqueue([op()]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    await expect(syncOnce()).rejects.toThrow();
    expect(await db.outbox.count()).toBe(1);
  });

  it('does not drop an op enqueued while a request was in flight', async () => {
    await enqueue([op({ opId: 'first' })]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // Simulates the user tapping something mid-request.
        await enqueue([op({ opId: 'second', ts: 5 })]);
        return new Response(JSON.stringify({ seq: 1, ops: [], presence: [] }), { status: 200 });
      }),
    );

    await syncOnce();

    // 'first' was acked; 'second' must survive to the next round.
    expect((await pending()).map(o => o.opId)).toEqual(['second']);
  });

  it('keeps pulling while pages come back full, so a backlog is not stranded', async () => {
    const full = Array.from({ length: 2000 }, (_, i) =>
      op({ opId: `r${i}`, entityId: `b${i}`, ts: 10 + i, actor: 'angie' }),
    );
    const calls = stubSync([
      { seq: 2000, ops: full },
      { seq: 2001, ops: [op({ opId: 'tail', entityId: 'tail', ts: 99999, actor: 'angie' })] },
    ]);

    await syncOnce();

    expect(calls.length).toBe(2);
    expect((await db.meta.get('cursor'))?.value).toBe(2001);
    expect(await db.bullets.get('tail')).toBeDefined();
  });

  it('sends the outbox only on the first request of a paged pull', async () => {
    await enqueue([op({ opId: 'only-once' })]);
    const full = Array.from({ length: 2000 }, (_, i) =>
      op({ opId: `x${i}`, entityId: `bb${i}`, ts: 10 + i, actor: 'angie' }),
    );
    const calls = stubSync([
      { seq: 2000, ops: full },
      { seq: 2001, ops: [] },
    ]);

    await syncOnce();

    expect(calls[0].ops).toHaveLength(1);
    expect(calls[1].ops).toHaveLength(0);
  });

  it('mints a token on demand rather than silently doing nothing', async () => {
    // The bug this guards: a device that signed in while offline had an
    // identity but no token, and sync returned early forever with no error
    // anywhere. Writes piled up locally and never reached the other phone.
    localStorage.removeItem('bullets.token');
    localStorage.setItem('bullets.person', 'clark');
    const calls = stubSync([{ seq: 1, ops: [] }]);

    await syncOnce();

    expect(calls.urls.some(u => u.includes('/api/auth'))).toBe(true);
    expect(calls.length).toBe(1);
    expect(localStorage.getItem('bullets.token')).toBe('clark.tok');
  });

  it('does nothing when nobody has chosen an identity', async () => {
    localStorage.removeItem('bullets.token');
    localStorage.removeItem('bullets.person');
    const calls = stubSync([{ seq: 1, ops: [] }]);
    await syncOnce();
    expect(calls).toHaveLength(0);
  });

  it('re-mints once when the server rejects the token', async () => {
    localStorage.setItem('bullets.token', 'stale');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/auth')) {
        return new Response(JSON.stringify({ token: 'fresh' }), { status: 200 });
      }
      return new Response('Unauthorized', { status: 401 });
    }));

    await syncOnce();
    // The stale token is dropped so the next tick mints a fresh one.
    expect(localStorage.getItem('bullets.token')).toBeNull();
  });

  it('reports a failure instead of swallowing it', async () => {
    localStorage.setItem('bullets.token', 'clark.tok');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/auth')) {
        return new Response(JSON.stringify({ token: 'clark.tok' }), { status: 200 });
      }
      throw new Error('network down');
    }));

    await syncOnce().catch(() => {});
    expect(syncState().status).not.toBe('ok');
    expect(syncState().error).toBeTruthy();
  });
});

describe('adaptive pace', () => {
  it('polls faster while a live board is open than when idle', () => {
    setPace('idle', null);
    const idle = currentInterval();
    stubSync([{ seq: 0, ops: [] }]);
    setPace('live', 'huddle:x');
    expect(currentInterval()).toBeLessThan(idle);
    setPace('idle', null);
  });
});
