import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Toast } from './bits';

/**
 * The toast used to have no timer at all. It stayed up until something cleared
 * it, and the only thing that did was an "OK" button — so Clark got a toast
 * saying "Saved" that he had to acknowledge like a dialog.
 *
 * These tests pin the timing contract. They use fake timers rather than a real
 * browser because the exit animation is rAF-driven and a headless run never
 * paints, which is exactly the thing that made this hard to verify by hand.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('clears itself without anyone touching it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Saved to the Shelf" onDismiss={onDismiss} duration={3200} />);

    expect(screen.getByText('Saved to the Shelf')).toBeTruthy();

    act(() => void vi.advanceTimersByTime(3199));
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(2));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not ask to be acknowledged when there is nothing to act on', () => {
    render(<Toast message="Saved to NOW" onDismiss={() => {}} />);
    // The old build rendered an "OK" button here, and tapping it was the only
    // code path that cleared the toast.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('restarts the countdown when a second toast replaces the first', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast message="First" onDismiss={onDismiss} duration={3000} />);

    act(() => void vi.advanceTimersByTime(2500));
    rerender(<Toast message="Second" onDismiss={onDismiss} duration={3000} />);

    // The first toast's remaining 500ms must not carry over and cut the second
    // one short.
    act(() => void vi.advanceTimersByTime(2500));
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(600));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('survives re-renders that pass a fresh onDismiss each time', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    // This is the real failure mode the ref guards against: App.tsx passes an
    // inline arrow, so every unrelated re-render — and this app re-renders on
    // every sync tick — would restart the timer and the toast would never go.
    function Harness() {
      const [, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick(t => t + 1)}>tick</button>
          <Toast message="Saved" onDismiss={() => onDismiss()} duration={3000} />
        </>
      );
    }

    render(<Harness />);
    for (let i = 0; i < 5; i++) {
      act(() => void vi.advanceTimersByTime(500));
      act(() => void screen.getByText('tick').click());
    }

    act(() => void vi.advanceTimersByTime(600));
    expect(onDismiss).toHaveBeenCalled();
  });
});
