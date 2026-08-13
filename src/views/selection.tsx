import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Which rows the user has ticked, and on which screen.
 *
 * Scoped to one surface at a time, deliberately. Today and Week rows are SHOTS
 * (a commitment on a date); Shelf rows are BULLETS (no commitment at all), and
 * the two take different actions — Unschedule means something on the first and
 * nothing on the second. Keying the set to a surface means the bulk sheet never
 * has to reason about a mixed selection, because one cannot exist.
 *
 * Not persisted. A selection is a sentence you are halfway through saying; it
 * should not survive a reload.
 */

export type Surface = 'today' | 'week' | 'shelf';

type Selection = {
  surface: Surface | null;
  ids: Set<string>;
  toggle: (surface: Surface, id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
};

const Ctx = createContext<Selection | null>(null);

/**
 * Surface and ids are ONE state atom, not two.
 *
 * They were two, and `toggle` called setIds() from inside the setSurface()
 * updater. React invokes updaters twice under StrictMode to surface exactly
 * this — an updater must be pure — so the nested setIds ran twice and a toggle
 * added the id and then removed it again. The first tick still worked, because
 * its branch happened to be idempotent (`new Set([id])`), which is what made
 * the bug look like "multi-select is broken" rather than "selection is broken".
 */
type State = { surface: Surface | null; ids: Set<string> };

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => ({ surface: null, ids: new Set() }));
  const { surface, ids } = state;

  const toggle = useCallback((next: Surface, id: string) => {
    setState(prev => {
      // Ticking a row on a different screen starts a new selection rather than
      // silently adding to one you can no longer see.
      if (prev.surface !== next) return { surface: next, ids: new Set([id]) };
      const out = new Set(prev.ids);
      if (out.has(id)) out.delete(id);
      else out.add(id);
      return { surface: next, ids: out };
    });
  }, []);

  const clear = useCallback(() => setState({ surface: null, ids: new Set() }), []);

  const has = useCallback((id: string) => ids.has(id), [ids]);

  const value = useMemo<Selection>(
    () => ({ surface, ids, toggle, clear, has }),
    [surface, ids, toggle, clear, has],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelection(): Selection {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSelection outside SelectionProvider');
  return v;
}
