import { useDragControls } from 'motion/react';
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Drag-to-dismiss that yields to scrolling.
 *
 * Putting `drag="y"` and `overflow-y-auto` on the same element is the bug this
 * exists to prevent: Motion captures the pointer, so the content never scrolls
 * and anything below the fold is unreachable.
 *
 * The native rule — the one that makes a sheet feel like a sheet — is that a
 * downward pull dismisses ONLY when the content is already scrolled to the top.
 * Anywhere else, the same gesture scrolls. Grab handles and headers are always
 * draggable, because that's the affordance people reach for.
 *
 * Usage:
 *   const { controls, scrollRef, handleProps, contentProps } = useDismissDrag();
 *   <motion.div drag="y" dragListener={false} dragControls={controls}>
 *     <div {...handleProps}>…grab handle…</div>
 *     <div ref={scrollRef} {...contentProps} className="overflow-y-auto">…</div>
 *   </motion.div>
 */
export function useDismissDrag() {
  const controls = useDragControls();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef(0);
  const armed = useRef(false);
  const engaged = useRef(false);

  /** Anything that should always drag: the grab handle, the sticky header. */
  const startDrag = useCallback(
    (event: ReactPointerEvent) => {
      // Touch only for the handle would be wrong — a desktop click-drag on the
      // handle is a legitimate way to dismiss too.
      controls.start(event);
    },
    [controls],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    startY.current = event.clientY;
    armed.current = true;
    engaged.current = false;
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!armed.current || engaged.current) return;

      const el = scrollRef.current;
      // Mid-scroll: the content owns this gesture.
      if (el && el.scrollTop > 0) {
        armed.current = false;
        return;
      }

      const dy = event.clientY - startY.current;
      // A small threshold so a tap or a horizontal drift never starts a dismiss.
      if (dy < 10) return;

      engaged.current = true;
      controls.start(event);
    },
    [controls],
  );

  const end = useCallback(() => {
    armed.current = false;
    engaged.current = false;
  }, []);

  return {
    controls,
    scrollRef,
    /** Spread onto the grab handle / header. */
    handleProps: {
      onPointerDown: startDrag,
      style: { touchAction: 'none' as const },
    },
    /** Spread onto the scrollable content wrapper. */
    contentProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      // pan-y keeps native scrolling fast; we only intercept at the top edge.
      style: {
        touchAction: 'pan-y' as const,
        overscrollBehavior: 'contain' as const,
      },
    },
  };
}
