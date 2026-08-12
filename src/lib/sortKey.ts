import { generateKeyBetween } from 'fractional-indexing';

/**
 * Fractional indexing lets either person reorder a list without renumbering
 * anything, which matters because a renumber would emit an op per row and
 * fight with the other person's concurrent edits.
 */
export function keyBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b);
}

export function keyAtEnd(last: string | null): string {
  return generateKeyBetween(last, null);
}

export function keyAtStart(first: string | null): string {
  return generateKeyBetween(null, first);
}
