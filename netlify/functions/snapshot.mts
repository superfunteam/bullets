import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { requirePerson } from '../lib/auth.mts';

/** Cold start for a fresh device: take the snapshot, then sync from its seq. */
export default async (req: Request) => {
  if (!(await requirePerson(req))) return new Response('Unauthorized', { status: 401 });

  const snapshot = await getStore('bullets-snapshots').get('latest', { type: 'json' });
  // No snapshot yet just means compaction hasn't run; the client falls back to
  // replaying from seq 0, which is correct, only slower.
  return Response.json(snapshot ?? { seq: 0, ops: [] });
};

export const config: Config = { path: '/api/snapshot', method: 'GET' };
