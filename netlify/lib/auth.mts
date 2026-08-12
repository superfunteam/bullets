/**
 * Shared auth helpers. Lives outside netlify/functions on purpose — every file
 * in that directory becomes its own deployed function.
 */

const enc = new TextEncoder();

const b64url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

export async function mint(person: string, secret: string): Promise<string> {
  return `${person}.${await hmac(person, secret)}`;
}

/** Returns the person the token belongs to, or null. */
export async function verify(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  const secret = process.env.BULLETS_SECRET;
  if (!secret) return null;

  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;

  const person = token.slice(0, idx);
  if (person !== 'clark' && person !== 'angie') return null;

  const expected = await mint(person, secret);
  // Constant-time-ish compare. Lengths are fixed here, so a simple XOR walk is fine.
  if (expected.length !== token.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0 ? person : null;
}

export function bearer(req: Request): string | null {
  const header = req.headers.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

export async function requirePerson(req: Request): Promise<string | null> {
  return verify(bearer(req));
}
