/**
 * The Bullets mark: two stacked bowls forming a B, offset like a bullet list.
 *
 * Inlined rather than an <img> so it can inherit `currentColor` — the source
 * file hardcodes black, which would vanish against the dark canvas. Being in
 * the bundle also means it paints with the first frame instead of arriving a
 * request later, which matters on the sign-in screen where it is the first
 * thing drawn.
 */
export function Logo({
  size = 28,
  className = '',
  title,
}: {
  size?: number;
  className?: string;
  /** Give it a title only where it is the sole naming of the app. */
  title?: string;
}) {
  // Source viewBox is 468x502; keep the ratio so nothing squashes.
  const height = size;
  const width = Math.round((468 / 502) * size);

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 468 502"
      fill="none"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      <path
        d="M65 275L354.5 275C417.184 275 468 325.816 468 388.5C468 451.184 417.184 502 354.5 502H65V275Z"
        fill="currentColor"
      />
      <path
        d="M0 0L289.5 0C352.184 0 403 50.8157 403 113.5C403 176.184 352.184 227 289.5 227H0V0Z"
        fill="currentColor"
      />
    </svg>
  );
}
