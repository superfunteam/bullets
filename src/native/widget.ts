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
  const bullets = await db.bullets.bulkGet(open.map(s => s.bulletId));

  const payload: WidgetPayload = {
    date,
    openCount: open.length,
    titles: bullets
      .filter(Boolean)
      .slice(0, 4)
      .map(b => clean<Bullet>(b!).title),
    updatedAt: Date.now(),
  };

  await Preferences.set({ key: 'widget', value: JSON.stringify(payload) });
  await refreshWidget();
}
