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

/**
 * Say who you are. There is no passphrase — you tap a face and you're in.
 *
 * Offline-tolerant on purpose: if the network is down we still set the local
 * identity so the app is fully usable, and the token is fetched on the next
 * successful sync. Being unable to reach Netlify should never block you from
 * writing down a task.
 */
export async function signIn(person: Person): Promise<boolean> {
  localStorage.setItem(PERSON_KEY, person);
  setActor(person);

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ person }),
    });
    if (!res.ok) return true;
    const { token } = (await res.json()) as { token: string };
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* offline — identity is set locally, the token can wait */
  }
  return true;
}

/** Fetch a token for an already-chosen identity, e.g. after being offline. */
export async function ensureToken(): Promise<void> {
  if (getToken()) return;
  const person = getPerson();
  if (!person) return;
  await signIn(person);
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
