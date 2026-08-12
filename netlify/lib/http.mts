/**
 * CORS for the Android app.
 *
 * The APK's WebView origin is `https://localhost`, so every call from the
 * device is cross-origin. Sending JSON with an Authorization header is not a
 * simple request, so the browser sends an OPTIONS preflight first — without a
 * reply to that, the real request is never even attempted.
 *
 * `*` is honest here: the space is deliberately open (see README), so pinning
 * an allowlist would imply a protection that does not exist.
 */
export const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400',
};

export const isPreflight = (req: Request): boolean => req.method === 'OPTIONS';

export const preflight = (): Response => new Response(null, { status: 204, headers: CORS });

/** Response helpers that never forget the CORS headers. */
export const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { ...CORS, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

export const text = (body: string, status = 200): Response =>
  new Response(body, { status, headers: CORS });
