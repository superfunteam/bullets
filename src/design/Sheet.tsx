import { AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { settle } from './springs';
import { useDismissDrag } from './useDismissDrag';

const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 550;

/** Open sheets, oldest first. Only the last one answers Escape. */
const ESC_STACK: object[] = [];

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
  showScrim = true,
  layer = 'base',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /**
   * 'over' puts this sheet above another one and portals it to <body>.
   *
   * Both parts are needed. The z-index because the base layer is z-40/z-50, and
   * the portal because a sheet rendered inside another sheet's scrolling body
   * would sit inside the element useDismissDrag is managing — the outer sheet's
   * drag would fight the inner one's, which is the exact drag-versus-scroll
   * trap in AGENTS.md. Portalling to <body> takes it out of that subtree
   * entirely, so the two never share a gesture surface.
   */
  layer?: 'base' | 'over';
  /**
   * Set false for a sheet you keep working behind — the bulk sheet, where you
   * carry on ticking rows while it stands. The scrim is a `fixed inset-0` layer
   * with onClick={onClose}, so leaving it in makes ticking a second row
   * physically impossible. Dropping it also drops aria-modal and the body
   * scroll lock, because none of those are true of a non-modal sheet.
   */
  showScrim?: boolean;
}) {
  const over = layer === 'over';
  const zScrim = over ? 'z-[60]' : 'z-40';
  const zPanel = over ? 'z-[70]' : 'z-50';

  const y = useMotionValue(0);
  // The backdrop lightens as the sheet is pulled down, so the gesture feels
  // like it's moving the whole screen rather than one floating panel.
  const scrim = useTransform(y, [0, 400], [0.45, 0]);
  const { controls, scrollRef, handleProps, contentProps } = useDismissDrag();

  // Without this the page behind scrolls under the sheet on both platforms.
  // A non-modal sheet must NOT do it — you still need to scroll the list.
  useEffect(() => {
    if (!open || !showScrim) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, showScrim]);

  /**
   * Escape closes the TOPMOST sheet only.
   *
   * Both sheets listen on window, so without the stack one Escape closed the
   * picker and the capture sheet underneath it in the same keypress — you lose
   * the bullet you were typing because you wanted to back out of a list.
   */
  useEffect(() => {
    if (!open) return;
    const token = {};
    ESC_STACK.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (ESC_STACK[ESC_STACK.length - 1] !== token) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = ESC_STACK.indexOf(token);
      if (i >= 0) ESC_STACK.splice(i, 1);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) y.set(0);
  }, [open, y]);

  /**
   * Publish the panel height so the page can get out from under it.
   *
   * A non-modal sheet covers the bottom of a list you are still using — without
   * this the last few rows sit behind it, which is exactly when you are trying
   * to tick them. The toast reads the same variable so it never lands on the
   * sheet either.
   */
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panelRef.current;
    const root = document.documentElement;
    if (!open || !el) {
      root.style.removeProperty('--bulk-sheet-h');
      return;
    }
    const publish = () => root.style.setProperty('--bulk-sheet-h', `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--bulk-sheet-h');
    };
  }, [open]);

  const tree = (
    <AnimatePresence>
      {open && (
        <>
          {showScrim && (
            <motion.div
              className={`fixed inset-0 ${zScrim} bg-black`}
              style={{ opacity: scrim }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.45 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={onClose}
            />
          )}

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal={showScrim ? 'true' : undefined}
            aria-label={title}
            className={`fixed inset-x-0 bottom-0 ${zPanel} flex max-h-[92dvh] flex-col
                       rounded-t-[var(--r-xl)] border-t border-[var(--line)]
                       bg-[var(--surface)] shadow-[var(--shadow-3)]`}
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

  return over ? createPortal(tree, document.body) : tree;
}
