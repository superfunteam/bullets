import type { Person } from '../data/types';
import { setActor } from '../data/mutations';
import { apiUrl } from './api';

const TOKEN_KEY = 'bullets.token';
const PERSON_KEY = 'bullets.person';

/**
 * Bearer tokens rather than cookies, deliberately.
 *
 * Capacitor serves the app from https://localhost on Android, which makes every
 * call to the Netlify domain cross-site. Bearer sidesteps the whole cookie/CORS
 * problem with one code path on both platforms.
 */
export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const getPerson = (): Person | null =>
  (localStorage.getItem(PERSON_KEY) as Person | null) ?? null;

export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

/** Fetch and store a token. Throws so callers can retry rather than assume. */
export async function mintToken(person: Person): Promise<string> {
  const res = await fetch(apiUrl('/api/auth'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ person }),
  });
  if (!res.ok) throw new Error(`auth failed: ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  if (!token) throw new Error('auth returned no token');
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

/**
 * Say who you are. There is no passphrase — you tap a face and you're in.
 *
 * Identity is set locally first so the app is fully usable offline, and the
 * token is fetched opportunistically. If that fetch fails we do NOT pretend it
 * succeeded: ensureToken() retries on every sync tick until it lands.
 */
export async function signIn(person: Person): Promise<boolean> {
  localStorage.setItem(PERSON_KEY, person);
  setActor(person);
  try {
    await mintToken(person);
  } catch {
    /* offline — ensureToken will keep trying */
  }
  return true;
}

/**
 * Guarantee a token if we know who we are.
 *
 * This is the fix for a class of silent failure: previously a device that
 * signed in while the API was unreachable had a person but no token, and the
 * sync loop returned early forever with nothing written anywhere.
 */
export async function ensureToken(): Promise<string | null> {
  const existing = getToken();
  if (existing) return existing;
  const person = getPerson();
  if (!person) return null;
  try {
    return await mintToken(person);
  } catch {
    return null;
  }
}

export function signOut(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PERSON_KEY);
}

/** Restore identity on boot so mutations are attributed correctly offline. */
export function restoreIdentity(): Person | null {
  const p = getPerson();
  if (p) setActor(p);
  return p;
}
