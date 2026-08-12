import { Slab } from '../design/Slab';
import { timeOfDay } from '../lib/dates';
import { hasAnswered, personName, responseOf, type Huddle } from '../data/types';
import { getActor } from '../data/mutations';

/** A huddle as it appears inline in Today and Week, at its time. */
export function HuddleStrip({ huddle, onOpen }: { huddle: Huddle; onOpen: () => void }) {
  const me = getActor();
  const mine = responseOf(huddle, me);
  // "New" means I haven't actually said anything yet — the auto-confirmation
  // written when it was called doesn't count as an answer.
  const needsMe = !hasAnswered(huddle, me) || mine?.status === 'nudge';
  const live = huddle.status === 'live';

  return (
    <Slab
      onClick={onOpen}
      tone={live ? 'raised' : 'default'}
      className={live ? 'ring-2 ring-[var(--hit)]' : ''}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-5">
        <div className="shrink-0 text-center">
          <div className="numeral text-2xl text-[var(--ink)]">{timeOfDay(huddle.startsAt)}</div>
          <div className="meta mt-0.5 text-[var(--ink-3)]">{huddle.durationMin}m</div>
        </div>

        <div
          className="h-10 w-px bg-[var(--line)] [html[data-text-scale='huge']_&]:hidden"
          aria-hidden
        />

        <div className="min-w-[8rem] flex-1">
          <p className="display text-xl text-[var(--ink)]">
            {huddle.title ?? 'Huddle'}
          </p>
          <p className="meta mt-1 text-[var(--ink-3)]">
            {live ? 'Live now' : `Called by ${personName(huddle.calledBy)}`}
          </p>
        </div>

        {needsMe && !live && (
          <span
            className="meta shrink-0 rounded-full px-2.5 py-1 uppercase"
            style={{
              background: 'var(--incoming-soft)',
              color: 'var(--incoming)',
              fontVariationSettings: "'wght' 750",
            }}
          >
            {mine?.status === 'nudge' ? 'Nudged' : 'New'}
          </span>
        )}
      </div>
    </Slab>
  );
}
