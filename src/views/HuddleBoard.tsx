import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { Slab } from '../design/Slab';
import { BigButton, ClientDot, KindGlyph } from '../design/bits';
import { lane as laneSpring, settle, snap } from '../design/springs';
import { Icon } from '../design/icons';
import { presence, setPace } from '../sync/client';
import {
  addHuddleItem,
  decideItem,
  getActor,
  rescheduleHuddle,
  respondToHuddle,
  undecideItem,
  wrapHuddle,
} from '../data/mutations';
import { useBullets, useClients, useHuddle, useHuddleItems } from '../data/store';
import { relativeDay, timeOfDay, toDay } from '../lib/dates';
import {
  PEOPLE,
  otherPerson,
  personName,
  responseOf,
  type Bullet,
  type Client,
  type HuddleItem,
  type Person,
} from '../data/types';

/**
 * The huddle board. A live shared surface, not a document.
 *
 * Both people have this open on two screens at once, so every item move has to
 * arrive as *motion* — a repaint reads as a glitch, while a slab travelling
 * between lanes reads as the other person doing something. That is the entire
 * reason for the LayoutGroup / layoutId machinery below.
 */

type Row = { item: HuddleItem; bullet?: Bullet; client?: Client };

/** 'today at 2pm' / 'Wed Aug 19 at 10am'. */
function whenPhrase(ms: number): string {
  const rel = relativeDay(toDay(new Date(ms)));
  const t = timeOfDay(ms);
  if (rel === 'Today') return `today at ${t}`;
  if (rel === 'Tomorrow') return `tomorrow at ${t}`;
  return `${rel} at ${t}`;
}

const toLocalInput = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
};

export function HuddleBoard({ huddleId, onClose }: { huddleId: string; onClose: () => void }) {
  const huddle = useHuddle(huddleId);
  const items = useHuddleItems(huddleId);
  const bullets = useBullets();
  const clients = useClients();

  const me = getActor();
  const [here, setHere] = useState<Person[]>([]);

  /**
   * The decision editor lives up here, not in the row.
   *
   * Two reasons, both of them the same bug. A decision arriving from the other
   * phone changes `item.decision` and moves the item to the decided lane, and
   * the row unmounts from one lane and mounts in the other — local draft state
   * dies with it. Holding the draft above both lanes means a half-typed
   * sentence survives both the sync and the lane move.
   *
   * `seed` is what the decision said when the editor opened. Anything else
   * showing up in `item.decision` is the other person deciding underneath us,
   * which the editor says out loud rather than quietly overwriting either way.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [seed, setSeed] = useState('');

  const openEditor = (id: string) => {
    const current = items.find(i => i.id === id)?.decision ?? '';
    setEditingId(id);
    setSeed(current);
    setDraft(current);
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft('');
    setSeed('');
  };

  // The other person can remove an item mid-edit. Without this the editor is
  // pointed at a row that renders in neither lane, so there is nothing left to
  // tap to dismiss it.
  useEffect(() => {
    if (!editingId || items.some(i => i.id === editingId)) return;
    setEditingId(null);
    setDraft('');
    setSeed('');
  }, [editingId, items]);

  // Live pace while the board is open; back to idle the moment it closes, so
  // two people reading Today aren't polling every 1.5s for no reason.
  useEffect(() => {
    setPace('live', `huddle:${huddleId}`);
    return () => setPace('idle', null);
  }, [huddleId]);

  // presence() is a plain snapshot off the sync client rather than a
  // subscription, so sample it at roughly the live poll cadence.
  useEffect(() => {
    const read = () =>
      setHere(
        presence().filter((p): p is Person => p !== me && PEOPLE.includes(p as Person)),
      );
    read();
    const t = setInterval(read, 1_500);
    return () => clearInterval(t);
  }, [me]);

  const clientById = useMemo(() => {
    const m = new Map<string, Client>();
    for (const c of clients) m.set(c.id, c);
    return m;
  }, [clients]);

  const bulletById = useMemo(() => {
    const m = new Map<string, Bullet>();
    for (const b of bullets) m.set(b.id, b);
    return m;
  }, [bullets]);

  const rows = useMemo<Row[]>(
    () =>
      items.map(item => {
        const bullet = item.bulletId ? bulletById.get(item.bulletId) : undefined;
        const client = bullet?.clientId ? clientById.get(bullet.clientId) : undefined;
        return { item, bullet, client };
      }),
    [items, bulletById, clientById],
  );

  const table = rows.filter(r => r.item.lane === 'table');
  const decided = rows.filter(r => r.item.lane === 'decided');

  if (!huddle) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-6">
        <BackButton onClose={onClose} />
        <p className="editorial mt-10 text-2xl text-[var(--ink-3)]">That huddle is gone.</p>
      </div>
    );
  }

  const upcoming = huddle.status === 'scheduled' && huddle.startsAt > Date.now();
  const wrapped = huddle.status === 'done';
  const theirs = responseOf(huddle, otherPerson(me));

  return (
    // Fixed overlay, not document flow. App keeps the tab view mounted behind
    // this, so a plain container renders the entire board off-screen below it —
    // tapping a huddle looks like a dead control.
    <motion.div
      className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg)] hide-scrollbar"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={settle}
      style={{ paddingTop: 'var(--inset-top)' }}
    >
    <div className="mx-auto w-full max-w-2xl px-4 pb-40">
      <header className="pt-6 pb-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <BackButton onClose={onClose} />
          {here.length > 0 && (
            <motion.span
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={settle}
              className="meta flex shrink-0 items-center gap-2 rounded-full bg-[var(--surface-2)]
                         px-3.5 py-2 text-[var(--ink-2)]"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: 'var(--hit)' }}
              />
              {here.map(personName).join(' and ')} {here.length > 1 ? 'are' : 'is'} here
            </motion.span>
          )}
        </div>

        <div className="px-2">
          <p className="meta text-[var(--ink-3)] uppercase">
            {relativeDay(toDay(new Date(huddle.startsAt)))}
            {wrapped ? ' · Wrapped' : huddle.status === 'live' ? ' · Live now' : ''}
          </p>
          <h1 className="display mt-1.5 text-4xl leading-tight text-[var(--ink)]">
            {huddle.title ?? 'Huddle'}
          </h1>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="numeral text-2xl text-[var(--ink)]">
              {timeOfDay(huddle.startsAt)}
            </span>
            <span className="meta text-[var(--ink-3)]">
              <span className="numeral">{huddle.durationMin}</span> min · called by{' '}
              {personName(huddle.calledBy)}
            </span>
          </p>
        </div>
      </header>

      {theirs && theirs.status !== 'in' && (
        <TheirResponse
          who={personName(otherPerson(me))}
          status={theirs.status}
          note={theirs.note}
          proposedAt={theirs.proposedAt}
          startsAt={huddle.startsAt}
          onTakeIt={ms => void rescheduleHuddle(huddleId, ms)}
        />
      )}

      {upcoming && (
        <ResponseBar
          huddleId={huddleId}
          startsAt={huddle.startsAt}
          mine={responseOf(huddle, me)?.status}
        />
      )}

      <LayoutGroup id={`huddle-${huddleId}`}>
        <Lane
          label="On the table"
          count={table.length}
          rows={table}
          editingId={editingId}
          draft={draft}
          seed={seed}
          onDraft={setDraft}
          onOpenEditor={openEditor}
          onCloseEditor={closeEditor}
          empty="Nothing on the table yet. Add what you want to talk about."
        >
          <AddItem huddleId={huddleId} />
        </Lane>

        <Lane
          label="Decided"
          count={decided.length}
          rows={decided}
          editingId={editingId}
          draft={draft}
          seed={seed}
          onDraft={setDraft}
          onOpenEditor={openEditor}
          onCloseEditor={closeEditor}
          empty="Nothing decided yet."
        />
      </LayoutGroup>

      <div className="mt-10">
        {wrapped ? (
          <p className="editorial px-2 text-center text-xl text-[var(--ink-3)]">
            Wrapped. Every decision is on its bullet now.
          </p>
        ) : (
          <>
            <BigButton
              onClick={() => {
                void wrapHuddle(huddleId).then(onClose);
              }}
              tone={decided.length > 0 ? 'ink' : 'quiet'}
            >
              Wrap it up
            </BigButton>
            <p className="meta mt-3 text-center text-[var(--ink-3)]">
              {decided.length > 0
                ? `Writes ${decided.length === 1 ? 'the decision' : 'all ' + decided.length + ' decisions'} onto their bullets, so nobody has to reopen this.`
                : 'Decisions get written onto their bullets. Nothing decided yet.'}
            </p>
          </>
        )}
      </div>
    </div>
    </motion.div>
  );
}

function BackButton({ onClose }: { onClose: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClose}
      whileTap={{ scale: 0.94 }}
      transition={snap}
      className="meta flex min-h-12 items-center gap-2 rounded-full bg-[var(--surface-2)]
                 px-4 py-2.5 text-[var(--ink-2)]"
    >
      <Icon name="chevron_left" size={18} />
      Huddles
    </motion.button>
  );
}

/* ------------------------------------------------------------------ response */

/**
 * Three answers, all of them fine.
 *
 * "In" is already true when you get here — tapping it is just saying so out
 * loud. "Nudge" never touches the time; it is a counter-offer, and the huddle
 * stays exactly where it was until someone actively moves it. "Can't" demands
 * a reason, because a bare no is the thing that makes scheduling adversarial.
 */
function ResponseBar({
  huddleId,
  startsAt,
  mine,
}: {
  huddleId: string;
  startsAt: number;
  mine?: 'in' | 'nudge' | 'out';
}) {
  const [mode, setMode] = useState<'none' | 'nudge' | 'out'>('none');
  const [note, setNote] = useState('');
  const [proposed, setProposed] = useState(() => toLocalInput(startsAt + 60 * 60_000));

  const close = () => {
    setMode('none');
    setNote('');
  };

  return (
    <section className="mb-9">
      {/* Three across is right at normal text. At large system font sizes the
          columns collapse to ~90px and the labels wrap one word per line into
          221px-tall slivers — technically not overflow, but unusable. Stack. */}
      <div
        className="grid grid-cols-3 items-stretch gap-2.5
                   [html[data-text-scale='huge']_&]:grid-cols-1"
      >
        <Answer
          label="In"
          sub="Already assumed"
          active={mine === 'in' && mode === 'none'}
          onClick={() => {
            close();
            void respondToHuddle(huddleId, { status: 'in' });
          }}
        />
        <Answer
          label="Nudge"
          sub="Offer another time"
          active={mode === 'nudge' || (mine === 'nudge' && mode === 'none')}
          onClick={() => setMode(mode === 'nudge' ? 'none' : 'nudge')}
        />
        <Answer
          label="Can't"
          sub="Say why"
          active={mode === 'out' || (mine === 'out' && mode === 'none')}
          onClick={() => setMode(mode === 'out' ? 'none' : 'out')}
        />
      </div>

      <AnimatePresence initial={false}>
        {mode !== 'none' && (
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={settle}
            className="mt-3"
          >
            <Slab tone="sunken">
              <div className="space-y-4 px-5 py-5">
                {mode === 'nudge' ? (
                  <>
                    <p className="editorial text-lg leading-snug text-[var(--ink-2)]">
                      Still on for {timeOfDay(startsAt)} — this just floats another time.
                    </p>
                    <input
                      type="datetime-local"
                      value={proposed}
                      onChange={e => setProposed(e.target.value)}
                      className="min-h-12 w-full rounded-[var(--r-md)] bg-[var(--surface)] px-4 py-3
                                 text-[var(--ink)]"
                      style={{ fontVariationSettings: "'wght' 560" }}
                    />
                  </>
                ) : (
                  <p className="editorial text-lg leading-snug text-[var(--ink-2)]">
                    A reason takes ten seconds and saves the whole conversation.
                  </p>
                )}

                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={2}
                  placeholder={mode === 'nudge' ? 'Why the move? (optional)' : 'What came up?'}
                  className="min-h-[72px] w-full resize-none rounded-[var(--r-md)] bg-[var(--surface)]
                             px-4 py-3 text-lg text-[var(--ink)] placeholder:text-[var(--ink-3)]"
                  style={{ fontVariationSettings: "'wght' 520" }}
                />

                <div className="flex gap-2.5">
                  <SmallButton onClick={close} tone="quiet">
                    Never mind
                  </SmallButton>
                  <SmallButton
                    tone="ink"
                    disabled={mode === 'out' && !note.trim()}
                    onClick={() => {
                      if (mode === 'nudge') {
                        const ms = new Date(proposed).getTime();
                        void respondToHuddle(huddleId, {
                          status: 'nudge',
                          note: note.trim() || undefined,
                          proposedAt: Number.isNaN(ms) ? undefined : ms,
                        });
                      } else {
                        if (!note.trim()) return;
                        void respondToHuddle(huddleId, { status: 'out', note: note.trim() });
                      }
                      close();
                    }}
                  >
                    {mode === 'nudge' ? 'Float it' : "Can't make it"}
                  </SmallButton>
                </div>
              </div>
            </Slab>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Answer({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    // h-full through the button and Slab so all three stay the same height when
    // one of the sub-labels wraps to an extra line.
    <button type="button" onClick={onClick} className="h-full text-left">
      <Slab
        tone={active ? 'raised' : 'sunken'}
        interactive
        className={`h-full ${active ? 'ring-2 ring-[var(--ink)]' : ''}`}
      >
        <div
          className="flex h-full min-h-[86px] flex-col justify-between px-4 py-4
                     [html[data-text-scale='huge']_&]:min-h-0"
        >
          <p className="display text-xl text-[var(--ink)]">{label}</p>
          <p className="meta mt-2 leading-tight text-[var(--ink-3)]">{sub}</p>
        </div>
      </Slab>
    </button>
  );
}

/** The counter-offer, made actionable — otherwise a nudge is a dead end. */
function TheirResponse({
  who,
  status,
  note,
  proposedAt,
  startsAt,
  onTakeIt,
}: {
  who: string;
  status: 'nudge' | 'out';
  note?: string;
  proposedAt?: number;
  startsAt: number;
  onTakeIt: (ms: number) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={settle}
      className="mb-6"
    >
      <Slab tone="quiet">
        <div className="px-5 py-4">
          <p className="meta text-[var(--ink-3)] uppercase">
            {status === 'nudge' ? `${who} nudged` : `${who} can't`}
          </p>
          {status === 'nudge' && proposedAt !== undefined && (
            <p className="mt-1.5 text-[var(--ink)]" style={{ fontVariationSettings: "'wght' 620" }}>
              Could we do {whenPhrase(proposedAt)}?
            </p>
          )}
          {note && (
            <p className="editorial mt-1.5 text-lg leading-snug text-[var(--ink-2)]">“{note}”</p>
          )}
          {status === 'nudge' && proposedAt !== undefined && proposedAt !== startsAt && (
            <div className="mt-3.5">
              <SmallButton tone="ink" onClick={() => onTakeIt(proposedAt)}>
                Move it to {timeOfDay(proposedAt)}
              </SmallButton>
            </div>
          )}
        </div>
      </Slab>
    </motion.div>
  );
}

/* ---------------------------------------------------------------------- lanes */

function Lane({
  label,
  count,
  rows,
  editingId,
  draft,
  seed,
  onDraft,
  onOpenEditor,
  onCloseEditor,
  empty,
  children,
}: {
  label: string;
  count: number;
  rows: Row[];
  editingId: string | null;
  draft: string;
  /** What the decision said when the editor opened. */
  seed: string;
  onDraft: (value: string) => void;
  onOpenEditor: (id: string) => void;
  onCloseEditor: () => void;
  empty: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="mb-9">
      <h2 className="meta mb-3 px-2 text-[var(--ink-3)] uppercase">
        {label} · <span className="numeral">{count}</span>
      </h2>

      <div className="space-y-2.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {rows.map(row => {
            const editing = editingId === row.item.id;
            return (
              <motion.div
                key={row.item.id}
                // Position-only: the decision editor and the decision text both
                // change an item's height, and animating size would scale the
                // text inside it. Lane travel is a position change anyway.
                layout="position"
                layoutId={`hi-${row.item.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={laneSpring}
              >
                <ItemBody
                  row={row}
                  editing={editing}
                  draft={draft}
                  onDraft={onDraft}
                  // The decision moved while this draft was open, which only
                  // happens when the other person decided it first.
                  overtaken={editing && (row.item.decision ?? '') !== seed}
                  onOpenEditor={() => onOpenEditor(row.item.id)}
                  onCloseEditor={onCloseEditor}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>

        {rows.length === 0 && (
          <p className="editorial px-2 py-1 text-lg text-[var(--ink-3)]">{empty}</p>
        )}

        {children}
      </div>
    </section>
  );
}

function ItemBody({
  row,
  editing,
  draft,
  onDraft,
  overtaken,
  onOpenEditor,
  onCloseEditor,
}: {
  row: Row;
  editing: boolean;
  draft: string;
  onDraft: (value: string) => void;
  /** The decision changed under this draft — the other person got there first. */
  overtaken: boolean;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
}) {
  const { item, bullet, client } = row;
  const decidedLane = item.lane === 'decided';
  const title = bullet?.title ?? item.text ?? 'Untitled';

  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Focus only. The draft is seeded once, where it lives — re-seeding here is
  // what used to wipe a half-typed decision every time the board polled.
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => areaRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [editing]);

  const commit = () => {
    const d = draft.trim();
    if (!d) return;
    void decideItem(item.id, d);
    onCloseEditor();
  };

  return (
    <Slab
      hue={client?.hue}
      tone={decidedLane ? 'quiet' : 'default'}
      onClick={
        editing
          ? undefined
          : decidedLane
            ? () => void undecideItem(item.id)
            : onOpenEditor
      }
      interactive={!editing}
    >
      <div className={`px-5 py-5 ${client ? 'pl-7' : ''}`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-lg">
            <KindGlyph kind={bullet?.kind ?? 'note'} />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="display text-xl leading-tight text-[var(--ink)]"
              style={decidedLane ? { color: 'var(--ink-2)' } : undefined}
            >
              {title}
            </p>
            {client && (
              <span className="mt-1.5 block">
                <ClientDot hue={client.hue} name={client.name} />
              </span>
            )}
            {decidedLane && item.decision && (
              <p className="editorial mt-2.5 text-lg leading-snug text-[var(--ink)]">
                {item.decision}
              </p>
            )}
          </div>
          {decidedLane && (
            <span className="mt-0.5" style={{ color: 'var(--hit)' }}>
              <Icon name="check" size={18} />
            </span>
          )}
        </div>

        <AnimatePresence initial={false}>
          {editing && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={settle}
              className="mt-4"
              onClick={e => e.stopPropagation()}
            >
              {/* Their decision landed mid-sentence. Say so, keep what was
                  typed, and make the choice between the two explicit — the
                  alternative is a draft that vanishes with no explanation. */}
              {overtaken && (
                <div
                  className="mb-3.5 rounded-[var(--r-md)] px-4 py-3"
                  style={{ background: 'var(--surface-3)' }}
                >
                  <p className="meta text-[var(--ink-2)] uppercase">
                    Decided while you were typing
                  </p>
                  {!decidedLane && item.decision && (
                    <p className="editorial mt-1.5 text-lg leading-snug text-[var(--ink-2)]">
                      “{item.decision}”
                    </p>
                  )}
                  <p className="meta mt-1.5 leading-snug text-[var(--ink-3)]">
                    Yours is still here — keep theirs, or use yours instead.
                  </p>
                </div>
              )}
              <textarea
                ref={areaRef}
                value={draft}
                onChange={e => onDraft(e.target.value)}
                rows={2}
                placeholder="What did we decide?"
                className="min-h-[88px] w-full resize-none rounded-[var(--r-md)]
                           bg-[var(--surface-2)] px-4 py-3.5 text-xl leading-snug
                           text-[var(--ink)] placeholder:text-[var(--ink-3)]"
                style={{ fontVariationSettings: "'wght' 540" }}
              />
              <div className="mt-3 flex gap-2.5">
                <SmallButton tone="quiet" onClick={onCloseEditor}>
                  {overtaken ? 'Keep theirs' : 'Not yet'}
                </SmallButton>
                <SmallButton tone="ink" disabled={!draft.trim()} onClick={commit}>
                  {overtaken ? 'Use mine' : 'Decided'}
                </SmallButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Slab>
  );
}

/** Agenda keeps growing mid-conversation, so adding has to cost nothing. */
function AddItem({ huddleId }: { huddleId: string }) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const t = text.trim();
    if (!t) return;
    void addHuddleItem(huddleId, { text: t });
    setText('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex items-center gap-2.5 rounded-[var(--r-lg)] border border-dashed
                    border-[var(--line-strong)] px-5 py-3">
      <span aria-hidden className="text-xl text-[var(--ink-3)]">
        +
      </span>
      <input
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Add something to talk about"
        className="min-h-12 min-w-0 flex-1 text-[var(--ink)] placeholder:text-[var(--ink-3)]"
        style={{ fontVariationSettings: "'wght' 560" }}
      />
      {text.trim() && (
        <motion.button
          type="button"
          onClick={add}
          whileTap={{ scale: 0.94 }}
          transition={snap}
          className="meta shrink-0 rounded-full bg-[var(--ink)] px-4 py-2.5 text-[var(--bg)]"
          style={{ fontVariationSettings: "'wght' 700" }}
        >
          Add
        </motion.button>
      )}
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  tone = 'quiet',
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'ink' | 'quiet';
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={snap}
      className="min-h-12 flex-1 rounded-[var(--r-md)] px-5 py-3 disabled:opacity-35"
      style={{
        background: tone === 'ink' ? 'var(--ink)' : 'var(--surface-3)',
        color: tone === 'ink' ? 'var(--bg)' : 'var(--ink)',
        fontVariationSettings: "'wght' 680",
      }}
    >
      {children}
    </motion.button>
  );
}
