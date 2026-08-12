import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode } from 'react';
import { settle } from './springs';

/**
 * Bottom sheet that follows the finger and dismisses on velocity as well as
 * distance — a distance-only threshold is what makes web sheets feel like web.
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
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto
                       rounded-t-[var(--r-xl)] border-t border-[var(--line)]
                       bg-[var(--surface)] shadow-[var(--shadow-3)] hide-scrollbar"
            style={{ paddingBottom: 'calc(var(--inset-bottom) + 1.5rem)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={settle}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 550) onClose();
            }}
          >
            <div className="sticky top-0 z-10 bg-[var(--surface)] pt-3 pb-1">
              <div className="mx-auto h-1.5 w-11 rounded-full bg-[var(--ink-3)]/35" />
              {title && (
                <h2 className="display mt-4 px-6 text-3xl text-[var(--ink)]">{title}</h2>
              )}
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
