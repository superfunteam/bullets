import { Capacitor } from '@capacitor/core';

/**
 * In-app update check against GitHub Releases.
 *
 * No server involved: the repo is public, so the releases API is readable
 * without a token. We compare the version baked in at build time against the
 * latest published tag and, if there's a newer one, hand the user the APK.
 *
 * Android will not let a web page install an APK directly — the download lands
 * in the notification shade and the user taps it. That's the OS's install
 * consent flow and it's the right place for it to live, so we deliberately
 * don't try to work around it.
 */

const RELEASES_API = 'https://api.github.com/repos/superfunteam/bullets/releases/latest';
const RELEASES_PAGE = 'https://github.com/superfunteam/bullets/releases/latest';

/** Injected by Vite from package.json — see vite.config.ts. */
declare const __APP_VERSION__: string;

const SKIP_KEY = 'bullets.skipVersion';
const LAST_CHECK_KEY = 'bullets.lastUpdateCheck';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateInfo = {
  version: string;
  current: string;
  apkUrl: string | null;
  pageUrl: string;
  notes: string;
};

export const currentVersion = (): string =>
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/**
 * Compare dotted numeric versions. Returns true when `a` is strictly newer.
 * Segment-wise and length-tolerant, so 1.2 vs 1.2.1 works and 1.10 beats 1.9 —
 * a plain string compare gets that last one backwards.
 */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, '').split('-')[0].split('.').map(n => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

type GhRelease = {
  tag_name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
};

/**
 * @param force skip the throttle and the user's "skip this version" choice.
 *              Used by the manual "Check for updates" action.
 */
export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  // Only the APK can self-update; the web app is always whatever Netlify served.
  if (!Capacitor.isNativePlatform() && !force) return null;

  if (!force) {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
    if (Date.now() - last < CHECK_EVERY_MS) return null;
  }

  let release: GhRelease;
  try {
    const res = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    release = (await res.json()) as GhRelease;
  } catch {
    return null; // offline, rate-limited — never surface this as an error
  }

  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

  const tag = release.tag_name;
  if (!tag || release.draft || release.prerelease) return null;

  const current = currentVersion();
  if (!isNewer(tag, current)) return null;
  if (!force && localStorage.getItem(SKIP_KEY) === tag) return null;

  // Prefer a properly signed release APK over a debug one if both are present.
  const apks = (release.assets ?? []).filter(a => a.name?.endsWith('.apk'));
  const preferred =
    apks.find(a => !a.name?.includes('debug')) ?? apks[0];

  return {
    version: tag.replace(/^v/, ''),
    current,
    apkUrl: preferred?.browser_download_url ?? null,
    pageUrl: RELEASES_PAGE,
    notes: (release.body ?? '').trim().slice(0, 400),
  };
}

/** Don't nag about this specific version again. A newer one still will. */
export function skipVersion(version: string): void {
  localStorage.setItem(SKIP_KEY, version.startsWith('v') ? version : `v${version}`);
}

/**
 * Hand the download to the system browser. Android's download manager takes it
 * from there and the user taps the notification to install — which is exactly
 * where the OS wants install consent to happen.
 */
export async function downloadUpdate(info: UpdateInfo): Promise<void> {
  const url = info.apkUrl ?? info.pageUrl;
  if (Capacitor.isNativePlatform()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch {
      /* plugin unavailable — fall through */
    }
  }
  window.open(url, '_blank', 'noopener');
}
