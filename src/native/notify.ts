import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { personName, type Huddle } from '../data/types';
import { timeOfDay } from '../lib/dates';

/**
 * Huddle notifications.
 *
 * These are locally scheduled through AlarmManager, which means they survive
 * both app kill and reboot and fire at the exact second with no network
 * involved. That reliability is the entire point: advance warning is the
 * feature, so the mechanism delivering it cannot be best-effort.
 *
 * Instant "Angie just called a huddle" alerts need FCM — background polling
 * cannot do it, because Doze suspends network access and blocks WorkManager
 * outright. See docs/firebase-setup.md; the app upgrades with no code change.
 */

const CHANNEL_ID = 'huddles';
const LEAD_MINUTES = 30;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  if (Capacitor.getPlatform() === 'android') {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Huddles',
      description: 'Advance warning before a huddle starts',
      importance: 5,
      visibility: 1,
      vibration: true,
    }).catch(() => {});
  }

  let perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
  return perm.display === 'granted';
}

/**
 * Android notification ids must fit in a signed 32-bit int, so a timestamp
 * would overflow. Hash the uuid into a small stable number instead, which also
 * means rescheduling replaces rather than duplicates.
 */
const ID_SPACE = 200_000_000;
const SLOTS = 10;

function idFor(huddleId: string, slot: number): number {
  let h = 0;
  for (let i = 0; i < huddleId.length; i++) h = (h * 31 + huddleId.charCodeAt(i)) | 0;
  return Math.abs(h % ID_SPACE) * SLOTS + slot;
}

/** Ids in our reserved band, so a blanket cancel never touches other features. */
const isOurs = (id: number): boolean => id > 0 && id < ID_SPACE * SLOTS;

/** Last scheduled set, so a no-op sync doesn't tear down working alarms. */
let lastSignature = '';

export async function scheduleHuddleReminders(huddles: Huddle[]): Promise<void> {
  const now = Date.now();
  const upcoming = huddles.filter(h => h.status === 'scheduled' && h.startsAt > now);

  /**
   * This runs after EVERY sync — about 40 times a minute while a live huddle
   * board is open. Rescheduling unconditionally meant constantly tearing down
   * and re-registering every alarm, and between the cancel and the schedule
   * there was a real window with zero alarms registered. If Android killed the
   * process in that window, every reminder was simply gone.
   *
   * Only touch the OS when the set actually changed.
   */
  const signature = upcoming
    .map(h => `${h.id}:${h.startsAt}:${h.title ?? ''}`)
    .sort()
    .join('|');
  if (signature === lastSignature) return;

  if (!(await ensureNotificationPermission())) return;

  // Cancel only ids we own. A blanket cancel would silently delete any other
  // notification the app ever schedules.
  const ours = new Set(upcoming.flatMap(h => [idFor(h.id, 1), idFor(h.id, 2)]));
  const existing = await LocalNotifications.getPending();
  const stale = existing.notifications.filter(n => isOurs(n.id) && !ours.has(n.id));
  if (stale.length) await LocalNotifications.cancel({ notifications: stale });

  lastSignature = signature;

  const notifications = upcoming.flatMap(h => {
    const title = h.title ?? 'Huddle';
    const leadAt = h.startsAt - LEAD_MINUTES * 60_000;
    const out = [];

    if (leadAt > now) {
      out.push({
        id: idFor(h.id, 1),
        channelId: CHANNEL_ID,
        title: `${title} in ${LEAD_MINUTES} min`,
        body: `${timeOfDay(h.startsAt)} · called by ${personName(h.calledBy)}`,
        schedule: { at: new Date(leadAt), allowWhileIdle: true },
        extra: { route: `/huddle/${h.id}` },
      });
    }

    out.push({
      id: idFor(h.id, 2),
      channelId: CHANNEL_ID,
      title: `${title} starting now`,
      body: 'Tap to open the board',
      schedule: { at: new Date(h.startsAt), allowWhileIdle: true },
      extra: { route: `/huddle/${h.id}` },
    });

    return out;
  });

  if (notifications.length) await LocalNotifications.schedule({ notifications });
}

/**
 * Exact alarms are a SEPARATE grant from POST_NOTIFICATIONS, and on Android 14+
 * a fresh install does not have it. Without it every reminder is registered as
 * inexact and Doze batches it to roughly one wakeup per 9 minutes — a "huddle
 * in 30 minutes" warning can land after the huddle already started, which is
 * the whole feature failing silently on the default install path.
 *
 * Nothing else surfaces this: notification permission is granted, scheduling
 * resolves fine, and only the timing is quietly wrong. So we check it, and ask.
 *
 * Revoking it later restarts the app and deletes exactly-scheduled
 * notifications, which is why this is re-checked on resume rather than once.
 */
export async function ensureExactAlarms(prompt = false): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const s = await LocalNotifications.checkExactNotificationSetting();
    if (s.exact_alarm === 'granted') return true;
    // Opens Settings > Alarms & reminders. There is no in-app grant for this.
    if (prompt) await LocalNotifications.changeExactNotificationSetting();
    return false;
  } catch {
    return true; // Android < 12 has no such setting.
  }
}

/**
 * Call on app resume. If the grant was revoked the OS dropped our alarms, so
 * force the next scheduleHuddleReminders() to actually re-register rather than
 * short-circuit on an unchanged signature.
 */
export async function revalidateReminders(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const ok = await ensureExactAlarms(false);
  if (!ok) lastSignature = '';
}

export function onNotificationTap(navigate: (route: string) => void): void {
  if (!Capacitor.isNativePlatform()) return;
  void LocalNotifications.addListener('localNotificationActionPerformed', event => {
    const route = event.notification.extra?.route;
    if (typeof route === 'string') navigate(route);
  });
}
