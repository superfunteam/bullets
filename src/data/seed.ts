import { db } from './db';
import { mutate } from './mutations';
import { runAuto } from './mutations';

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
  { id: 'client-sourceday', name: 'SourceDay', hue: 25 },
  { id: 'client-michigan-public', name: 'Michigan Public', hue: 205 },
  { id: 'client-red-oak', name: 'Red Oak', hue: 15 },
  { id: 'client-games', name: 'Games', hue: 150 },
  { id: 'client-fun', name: 'Fun', hue: 300 },
];

/** The placeholder clients shipped before the real list existed. */
const RETIRED = ['client-superfun', 'client-one', 'client-two', 'client-three'];

export function seedIfEmpty(): Promise<void> {
  // The starter clients are the app's doing, not the first person to sign in.
  return runAuto(() => seedIfEmptyCore());
}

async function seedIfEmptyCore(): Promise<void> {
  const existing = await db.clients.toArray();
  const live = existing.filter(c => !c.deletedAt);

  // Retire the placeholders. They synced to both devices before the real list
  // existed, so changing STARTERS alone would leave them on every device that
  // had already seeded. Soft delete, so the tombstone travels too.
  for (const c of live) {
    if (RETIRED.includes(c.id)) await mutate('client', c.id, { deletedAt: Date.now() });
  }

  const have = new Set(live.map(c => c.id));
  for (const c of STARTERS) {
    if (have.has(c.id)) continue;
    await mutate('client', c.id, { name: c.name, hue: c.hue });
  }
}
