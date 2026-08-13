import { afterEach, describe, expect, it } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SelectionProvider, useSelection } from './selection';

/**
 * These run inside StrictMode deliberately.
 *
 * The first version of this store called setIds() from inside the setSurface()
 * updater. React double-invokes updaters under StrictMode precisely to catch an
 * impure one, so the nested call ran twice and a toggle added an id and then
 * removed it. The FIRST tick still worked — its branch was idempotent — so the
 * bug only ever showed on the second, which is a nasty thing to leave untested.
 */

function Harness() {
  const { ids, surface, toggle, clear, has } = useSelection();
  return (
    <>
      <span data-testid="count">{ids.size}</span>
      <span data-testid="surface">{surface ?? 'none'}</span>
      <span data-testid="has-a">{String(has('a'))}</span>
      <button onClick={() => toggle('today', 'a')}>a</button>
      <button onClick={() => toggle('today', 'b')}>b</button>
      <button onClick={() => toggle('shelf', 'z')}>z</button>
      <button onClick={clear}>clear</button>
    </>
  );
}

const setup = () =>
  render(
    <StrictMode>
      <SelectionProvider>
        <Harness />
      </SelectionProvider>
    </StrictMode>,
  );

// No globals:true in the vitest config, so RTL's auto-cleanup never runs and
// each render would stack another copy of the harness in the same document.
afterEach(cleanup);

const click = (label: string) => act(() => void screen.getByText(label).click());
const count = () => Number(screen.getByTestId('count').textContent);

describe('selection', () => {
  it('accumulates across ticks', () => {
    setup();
    click('a');
    expect(count()).toBe(1);
    // The one that used to silently no-op.
    click('b');
    expect(count()).toBe(2);
  });

  it('unticks', () => {
    setup();
    click('a');
    click('b');
    click('a');
    expect(count()).toBe(1);
    expect(screen.getByTestId('has-a').textContent).toBe('false');
  });

  it('starts a new selection when the surface changes', () => {
    setup();
    click('a');
    click('b');
    expect(count()).toBe(2);

    // A Shelf row is a bullet; a Today row is a shot. A set holding both would
    // make the bulk sheet reason about two row kinds at once.
    click('z');
    expect(count()).toBe(1);
    expect(screen.getByTestId('surface').textContent).toBe('shelf');
  });

  it('clears', () => {
    setup();
    click('a');
    click('b');
    click('clear');
    expect(count()).toBe(0);
    expect(screen.getByTestId('surface').textContent).toBe('none');
  });
});
