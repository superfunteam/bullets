import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { db } from '../data/db';
import { clean } from '../data/ops';
import { today } from '../lib/dates';
import type { Bullet, Shot } from '../data/types';

/**
 * The home screen widget reads the same SharedPreferences file that
 * @capacitor/preferences writes to (group "CapacitorStorage", no key prefix),
 * so it stays current without running any network code of its own.
 *
 * Values must be written as strings on both sides — the plugin reads with
 * getString, and a Kotlin putInt would make it throw.
 */
export type WidgetPayload = {
  date: string;
  openCount: number;
  titles: string[];
  updatedAt: number;
};

interface WidgetBridgePlugin {
  refresh(): Promise<void>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

export async function refreshWidget(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  // No widget placed on a home screen is the normal case, not an error.
  await WidgetBridge.refresh().catch(() => {});
}

export async function publishWidget(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const date = today();
  const shots = (await db.shots.where('[scope+date]').equals(['day', date]).toArray())
    .filter(s => !s.deletedAt)
    .map(s => clean<Shot>(s));

  const open = shots.filter(s => s.state === 'open');
  const raw = await db.bullets.bulkGet(open.map(s => s.bulletId));

  // The widget must agree with Today. Without this it counts and names bullets
  // that were called off or deleted, so the home screen says "4 shots today"
  // while the app shows two — and the widget is the thing you glance at.
  const live = raw
    .filter(Boolean)
    .map(b => clean<Bullet>(b!))
    .filter(b => !b.deletedAt && b.state === 'open');

  const payload: WidgetPayload = {
    date,
    openCount: live.length,
    titles: live.slice(0, 4).map(b => b.title),
    updatedAt: Date.now(),
  };

  await Preferences.set({ key: 'widget', value: JSON.stringify(payload) });
  await refreshWidget();
}
