import type { Config } from '@netlify/functions';
import { mint } from '../lib/auth.mts';

/**
 * Two users, no signup, no email. A shared space passphrase unlocks the space,
 * then you say which of the two you are.
 */
export default async (req: Request) => {
  const secret = process.env.BULLETS_SECRET;
  const passphrase = process.env.BULLETS_PASSPHRASE;

  if (!secret || !passphrase) {
    return new Response('Server not configured: set BULLETS_SECRET and BULLETS_PASSPHRASE', {
      status: 500,
    });
  }

  let body: { passphrase?: string; person?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (body.passphrase !== passphrase) {
    return new Response('Wrong passphrase', { status: 401 });
  }
  if (body.person !== 'clark' && body.person !== 'angie') {
    return new Response('Unknown person', { status: 400 });
  }

  return Response.json({
    person: body.person,
    token: await mint(body.person, secret),
  });
};

export const config: Config = {
  path: '/api/auth',
  method: 'POST',
  rateLimit: { windowSize: 60, windowLimit: 20 },
};
