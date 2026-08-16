import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { RefreshGesture } from './RefreshGesture';

/**
 * The pill's copy during the drag.
 *
 * The reducer's `armed` latch is tested exhaustively next door in
 * pullGesture.test.ts; what is NOT covered there is whether crossing it ever
 * reaches the screen. It did not: the first version fired the haptic and
 * nothing else, so the pill read "Pull to sync" the whole way down and the only
 * signal that you had pulled far enough was a buzz — easy to miss in a warm
 * hand, and absent entirely on desktop and on a phone with haptics off. That is
 * a gesture with no visible commit point, which is the thing "pull to refresh"
 * is supposed to have.
 */

/** travelFor(dy) = 160 * (1 - e^-((dy-12)/160)); ARM is 64, so ~94px arms. */
const ARMING_DY = 120;
const SHORT_DY = 40;

function pull(dy: number) {
  const main = screen.getByTestId('inner').parentElement!.parentElement!;

  act(() => {
    main.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
      }),
    );
  });

  /**
   * Two samples, because `watching -> pulling` always hands back armed:false
   * and only a subsequent sample evaluates the latch. A finger emits samples at
   * 60-120Hz so this is invisible in the hand, but a single-move harness sits
   * exactly on that seam and reports "not armed" for a pull well past ARM.
   */
  for (const step of [dy / 2, dy]) {
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100 + step,
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
        }),
      );
    });
  }
}

afterEach(cleanup);

describe('the pull-to-refresh pill', () => {
  it('says what to do before the gesture has gone anywhere', () => {
    render(
      <RefreshGesture disabled={false} resetKey="today">
        <div data-testid="inner">list</div>
      </RefreshGesture>,
    );
    expect(screen.getByText('Pull to sync')).toBeTruthy();
  });

  it('switches to "Release to sync" once the pull is far enough to commit', () => {
    render(
      <RefreshGesture disabled={false} resetKey="today">
        <div data-testid="inner">list</div>
      </RefreshGesture>,
    );

    pull(ARMING_DY);

    expect(screen.queryByText('Pull to sync')).toBeNull();
    expect(screen.getByText('Release to sync')).toBeTruthy();
  });

  it('keeps saying "Pull to sync" while the pull is still short of arming', () => {
    render(
      <RefreshGesture disabled={false} resetKey="today">
        <div data-testid="inner">list</div>
      </RefreshGesture>,
    );

    pull(SHORT_DY);

    // Moved, and deliberately not promising a sync it would not run: releasing
    // here settles back and syncs nothing.
    expect(screen.getByText('Pull to sync')).toBeTruthy();
  });

  it('does not arm from a mouse, which scrolls rather than pulls', () => {
    render(
      <RefreshGesture disabled={false} resetKey="today">
        <div data-testid="inner">list</div>
      </RefreshGesture>,
    );

    const main = screen.getByTestId('inner').parentElement!.parentElement!;
    act(() => {
      main.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: 100,
          clientY: 100,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: 100,
          clientY: 100 + ARMING_DY,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        }),
      );
    });

    expect(screen.getByText('Pull to sync')).toBeTruthy();
  });
});
