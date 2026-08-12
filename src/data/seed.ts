import { db } from './db';
import { mutate } from './mutations';

/**
 * A first-run set of clients so the Shelf and Capture aren't empty on day one.
 *
 * The ids are FIXED, not generated. Seeding is gated on the local table being
 * empty, but a second device starts empty too — so Angie's phone would seed its
 * own four clients, sync would pull Clark's four, and both would settle on
 * eight: two "Superfun", two "Client One". Clients can only be archived, never
 * deleted, so that mess would be permanent. With stable ids the second seed is
 * just an idempotent re-write of the same four entities.
 *
 * Renamable and archivable — these are a starting point, not a fixture.
 */
const STARTERS: { id: string; name: string; hue: number }[] = [
  { id: 'client-superfun', name: 'Superfun', hue: 25 },
  { id: 'client-one', name: 'Client One', hue: 150 },
  { id: 'client-two', name: 'Client Two', hue: 250 },
  { id: 'client-three', name: 'Client Three', hue: 320 },
];

export async function seedIfEmpty(): Promise<void> {
  if ((await db.clients.count()) > 0) return;
  for (const c of STARTERS) {
    await mutate('client', c.id, { name: c.name, hue: c.hue });
  }
}
