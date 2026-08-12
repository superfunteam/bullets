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
function idFor(huddleId: string, slot: number): number {
  let h = 0;
  for (let i = 0; i < huddleId.length; i++) h = (h * 31 + huddleId.charCodeAt(i)) | 0;
  return Math.abs(h % 200_000_000) * 10 + slot;
}

export async function scheduleHuddleReminders(huddles: Huddle[]): Promise<void> {
  if (!(await ensureNotificationPermission())) return;

  const now = Date.now();
  const upcoming = huddles.filter(h => h.status === 'scheduled' && h.startsAt > now);

  // Clear ours first so a rescheduled or cancelled huddle doesn't leave a ghost.
  const existing = await LocalNotifications.getPending();
  if (existing.notifications.length) {
    await LocalNotifications.cancel({ notifications: existing.notifications });
  }

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
 * Revoking the exact-alarm setting restarts the app AND deletes anything
 * scheduled exactly, so reminders must be re-verified whenever we come back to
 * the foreground rather than assumed to still exist.
 */
export async function verifyExactAlarms(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const s = await LocalNotifications.checkExactNotificationSetting();
    return s.exact_alarm === 'granted';
  } catch {
    return true; // Android < 12 has no such setting.
  }
}

export function onNotificationTap(navigate: (route: string) => void): void {
  if (!Capacitor.isNativePlatform()) return;
  void LocalNotifications.addListener('localNotificationActionPerformed', event => {
    const route = event.notification.extra?.route;
    if (typeof route === 'string') navigate(route);
  });
}
