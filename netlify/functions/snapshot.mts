import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { requirePerson } from '../lib/auth.mts';
import { isPreflight, json, preflight, text } from '../lib/http.mts';

/** Cold start for a fresh device: take the snapshot, then sync from its seq. */
export default async (req: Request) => {
  if (isPreflight(req)) return preflight();
  if (!(await requirePerson(req))) return text('Unauthorized', 401);

  const snapshot = await getStore('bullets-snapshots').get('latest', { type: 'json' });
  // No snapshot yet just means compaction hasn't run; the client falls back to
  // replaying from seq 0, which is correct, only slower.
  return json(snapshot ?? { seq: 0, ops: [] });
};

export const config: Config = { path: '/api/snapshot', method: ['GET', 'OPTIONS'] };
