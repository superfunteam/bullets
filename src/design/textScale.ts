/**
 * Detects how large the user's text actually renders, and tells CSS about it.
 *
 * Angie runs Android's font size near the top of the range. That is an
 * accessibility preference, so the app honours it — overriding it to make our
 * layout easier would be solving our problem with her eyesight. But a few
 * layouts genuinely cannot survive 200% text without losing a control, so we
 * need to *know* when we're there.
 *
 * CSS has no media query for text scale, so measure it: a 1rem probe is 16px
 * at default and grows with the OS setting (Android WebView applies the system
 * scale as a text zoom on the root). The result lands on <html> as
 * data-text-scale, which components key off to reflow — usually by dropping
 * decorative labels rather than shrinking anything.
 */

export type TextScale = 'normal' | 'large' | 'huge';

const BREAKPOINTS: [TextScale, number][] = [
  ['huge', 22], // ~140%+ — drop non-essential labels
  ['large', 19], // ~120%+ — tighten spacing
];

export function measureTextScale(): { scale: TextScale; remPx: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'width:1rem;height:0;position:absolute;top:-9999px;left:-9999px;visibility:hidden;';
  document.body.appendChild(probe);
  const remPx = probe.getBoundingClientRect().width || 16;
  probe.remove();

  const scale = BREAKPOINTS.find(([, min]) => remPx >= min)?.[0] ?? 'normal';
  return { scale, remPx };
}

export function applyTextScale(): TextScale {
  const { scale, remPx } = measureTextScale();
  document.documentElement.dataset.textScale = scale;
  document.documentElement.style.setProperty('--rem-px', String(Math.round(remPx)));
  return scale;
}

/** Re-measure when the OS setting changes under a running app. */
export function watchTextScale(): () => void {
  applyTextScale();
  const onChange = () => applyTextScale();
  window.addEventListener('resize', onChange);
  // Returning to the app after changing the setting in Settings.
  document.addEventListener('visibilitychange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}
