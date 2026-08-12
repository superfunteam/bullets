import { Capacitor } from '@capacitor/core';

/**
 * Where the API actually lives.
 *
 * This exists because of a bug that made the APK never sync at all. Capacitor
 * serves the app from `https://localhost` on Android, so a relative
 * `fetch('/api/sync')` resolves to `https://localhost/api/sync` — an origin
 * with no server behind it. On the web the same string is correct, which is
 * exactly why it went unnoticed: it worked everywhere it was tested and failed
 * only on the device.
 *
 * Native therefore needs an absolute origin. `VITE_API_BASE` overrides it so
 * moving to bullets.superfun.team later is an env var, not a code change.
 */
const FALLBACK = 'https://bullets-superfun.netlify.app';

export function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  // Same-origin on the web; the deployed site serves its own functions.
  return Capacitor.isNativePlatform() ? FALLBACK : '';
}

export const apiUrl = (path: string): string => `${apiBase()}${path}`;
