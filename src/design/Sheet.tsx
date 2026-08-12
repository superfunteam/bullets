import { AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { settle } from './springs';
import { useDismissDrag } from './useDismissDrag';

const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 550;

/**
 * Bottom sheet.
 *
 * Sized to its content and capped at most of the viewport; past that the body
 * scrolls inside while the header stays put. A downward drag dismisses, but
 * only from the handle/header or when the body is already scrolled to the top —
 * see useDismissDrag for why that rule is the whole difference between this and
 * a div that traps its own content.
 */
export function Sheet({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}) {
  const y = useMotionValue(0);
  // The backdrop lightens as the sheet is pulled down, so the gesture feels
  // like it's moving the whole screen rather than one floating panel.
  const scrim = useTransform(y, [0, 400], [0.45, 0]);
  const { controls, scrollRef, handleProps, contentProps } = useDismissDrag();

  // Without this the page behind scrolls under the sheet on both platforms.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape is free on desktop and people expect it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) y.set(0);
  }, [open, y]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black"
            style={{ opacity: scrim }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.45 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col
                       rounded-t-[var(--r-xl)] border-t border-[var(--line)]
                       bg-[var(--surface)] shadow-[var(--shadow-3)]"
            style={{ y }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={settle}
            drag="y"
            // Controlled drag: the gesture only starts where we say it can, so
            // it never steals the scroll.
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) {
                onClose();
              }
            }}
          >
            {/* Header is fixed; it is also the always-draggable grab area. */}
            <div className="shrink-0 cursor-grab pt-3 active:cursor-grabbing" {...handleProps}>
              <div className="mx-auto h-1.5 w-11 rounded-full bg-[var(--ink-3)]/35" />
              {title && (
                <h2 className="display mt-4 px-6 pb-1 text-3xl text-[var(--ink)]">{title}</h2>
              )}
            </div>

            <div
              ref={scrollRef}
              className="hide-scrollbar min-h-0 flex-1 overflow-y-auto"
              {...contentProps}
            >
              {children}
              {/* Breathing room above the gesture bar so the last control is
                  never flush against the bottom of the screen. */}
              <div aria-hidden style={{ height: 'calc(var(--inset-bottom) + 1.5rem)' }} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
