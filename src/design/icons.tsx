/**
 * Material Symbols, inlined.
 *
 * These are the real thing — path data lifted verbatim from
 * @material-symbols/svg-400 (Rounded, v0.45.10), not hand-drawn lookalikes.
 * The package itself is 13MB for the full set and is NOT a dependency: the five
 * icons we actually use are committed here instead.
 *
 * Inline rather than the icon font on purpose. The font is served from the
 * Google Fonts CDN, and this app has to work with no network inside the Android
 * APK and from a file:// origin in Electron, where that request cannot succeed.
 * A webfont also paints one frame late, which on a list row reads as a flicker.
 *
 * These replaced typed glyphs — ‹ › ▸ ✓ × — which rendered at wildly different
 * optical sizes and baselines across the two faces this app ships, so an arrow
 * next to a label was never quite aligned with it.
 *
 * The viewBox is Material's own `0 -960 960 960`; leave it alone or the paths
 * land off-screen.
 */

export type IconName = 'chevron_right' | 'chevron_left' | 'check' | 'close' | 'arrow_down';

const PATHS: Record<IconName, string> = {
  chevron_right:
    'M530-481 353-658q-9-9-8.5-21t9.5-21q9-9 21.5-9t21.5 9l198 198q5 5 7 10t2 11q0 6-2 11t-7 10L396-261q-9 9-21 8.5t-21-9.5q-9-9-9-21.5t9-21.5l176-176Z',
  chevron_left:
    'm406-481 177 177q9 9 8.5 21t-9.5 21q-9 9-21.5 9t-21.5-9L341-460q-5-5-7-10t-2-11q0-6 2-11t7-10l199-199q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L406-481Z',
  check:
    'm378-332 363-363q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L399-267q-9 9-21 9t-21-9L175-449q-9-9-8.5-21.5T176-492q9-9 21.5-9t21.5 9l159 160Z',
  close:
    'M480-438 270-228q-9 9-21 9t-21-9q-9-9-9-21t9-21l210-210-210-210q-9-9-9-21t9-21q9-9 21-9t21 9l210 210 210-210q9-9 21-9t21 9q9 9 9 21t-9 21L522-480l210 210q9 9 9 21t-9 21q-9 9-21 9t-21-9L480-438Z',
  arrow_down:
    'M469-358q-5-2-10-7L261-563q-9-9-8.5-21.5T262-606q9-9 21.5-9t21.5 9l175 176 176-176q9-9 21-8.5t21 9.5q9 9 9 21.5t-9 21.5L501-365q-5 5-10 7t-11 2q-6 0-11-2Z',
};

export function Icon({
  name,
  size = 20,
  className = '',
  /** Give it a label only where the icon is the control's sole naming. */
  label,
}: {
  name: IconName;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      fill="currentColor"
      // Icons sit inline next to text constantly; without this they ride the
      // baseline and push the line box taller than the text it labels.
      className={`inline-block shrink-0 align-[-0.15em] ${className}`}
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {label && <title>{label}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
