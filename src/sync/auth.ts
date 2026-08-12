import type { Person } from '../data/types';
import { setActor } from '../data/mutations';

const TOKEN_KEY = 'bullets.token';
const PERSON_KEY = 'bullets.person';

/**
 * Bearer tokens rather than cookies, deliberately.
 *
 * Capacitor serves the app from https://localhost on Android, which makes
 * every call to the Netlify domain cross-site. Bearer sidesteps the whole
 * cookie/CORS problem with one code path on both platforms.
 */
export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const getPerson = (): Person | null =>
  (localStorage.getItem(PERSON_KEY) as Person | null) ?? null;

export async function signIn(passphrase: string, person: Person): Promise<boolean> {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase, person }),
  });
  if (!res.ok) return false;
  const { token } = (await res.json()) as { token: string };
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(PERSON_KEY, person);
  setActor(person);
  return true;
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
