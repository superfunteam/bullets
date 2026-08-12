import type { Config } from '@netlify/functions';
import { mint } from '../lib/auth.mts';
import { isPreflight, json, preflight, text } from '../lib/http.mts';

/**
 * Identity, not authentication.
 *
 * There is no passphrase. This space is deliberately open — see README — so
 * this endpoint hands a signed token to whoever asks for one. What the
 * signature buys is that the token cannot be *edited*: nobody can hand
 * /api/sync a hand-rolled token claiming to be Clark, so attribution on the
 * huddle board and in the op log stays honest.
 *
 * If this ever needs to become a real gate, it is one comparison: check a
 * shared secret here before minting. Nothing else in the stack changes.
 */
export default async (req: Request) => {
  if (isPreflight(req)) return preflight();

  const secret = process.env.BULLETS_SECRET;
  if (!secret) {
    return text('Server not configured: set BULLETS_SECRET', 500);
  }

  let body: { person?: string };
  try {
    body = await req.json();
  } catch {
    return text('Bad request', 400);
  }

  if (body.person !== 'clark' && body.person !== 'angie') {
    return text('Unknown person', 400);
  }

  return json({
    person: body.person,
    token: await mint(body.person, secret),
  });
};

export const config: Config = {
  path: '/api/auth',
  method: ['POST', 'OPTIONS'],
  // Costs the two of us nothing and stops anyone cheaply hammering it.
  rateLimit: { windowSize: 60, windowLimit: 30 },
};
