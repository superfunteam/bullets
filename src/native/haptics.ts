/**
 * A single light tap, on Android only.
 *
 * Guarded exactly like native/widget.ts: the import is dynamic and the failure
 * is swallowed, so the web build and Electron simply get nothing. This is the
 * one moment in the app where the phone should answer the finger — the point
 * where a pull commits — and without it the gesture feels like a web page
 * pretending.
 */
export async function tapLight(): Promise<void> {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* web, Electron, or the plugin is absent */
  }
}

/** Warm the dynamic import so the first buzz is not a frame late. */
export function warmHaptics(): void {
  void import('@capacitor/haptics').catch(() => {});
}
