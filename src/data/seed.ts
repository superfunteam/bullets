import { db } from './db';
import { createClient } from './mutations';

/**
 * A first-run set of clients so the Shelf and Capture aren't empty on day one.
 * Hues are spread around the wheel so two clients never read as the same color.
 * Renamable and archivable — these are a starting point, not a fixture.
 */
const STARTERS: [name: string, hue: number][] = [
  ['Superfun', 25],
  ['Client One', 150],
  ['Client Two', 250],
  ['Client Three', 320],
];

export async function seedIfEmpty(): Promise<void> {
  const count = await db.clients.count();
  if (count > 0) return;
  for (const [name, hue] of STARTERS) {
    await createClient(name, hue);
  }
}
