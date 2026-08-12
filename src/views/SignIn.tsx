import { useState } from 'react';
import { motion } from 'motion/react';
import { settle, snap, stagger } from '../design/springs';
import { Logo } from '../design/Logo';
import { signIn } from '../sync/auth';
import { PEOPLE, personName, type Person } from '../data/types';
import { currentVersion } from '../native/update';

/**
 * Two faces. Tap yours.
 *
 * No passphrase, no email, no accounts — this is a two-person space and the
 * only thing the app actually needs to know is which of you is holding the
 * phone, so huddle responses and presence are attributed to the right person.
 * That is a choice, not a gate.
 */
export function SignIn({ onDone }: { onDone: (p: Person) => void }) {
  const [busy, setBusy] = useState<Person | null>(null);

  const go = async (person: Person) => {
    if (busy) return;
    setBusy(person);
    await signIn(person);
    onDone(person);
  };

  return (
    <div
      className="flex min-h-dvh flex-col justify-center px-7"
      style={{ paddingTop: 'var(--inset-top)', paddingBottom: 'var(--inset-bottom)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={settle}
        className="mx-auto w-full max-w-md"
      >
        <div className="flex items-center gap-4">
          <Logo size={52} className="text-[var(--ink)]" />
          <h1 className="display text-6xl text-[var(--ink)]">Bullets</h1>
        </div>
        <p className="editorial mt-2 text-2xl text-[var(--ink-3)]">No more dodging.</p>

        <p className="meta mt-14 mb-4 text-[var(--ink-3)] uppercase">Who's holding the phone?</p>

        <div className="grid grid-cols-2 gap-3">
          {PEOPLE.map((p, i) => {
            const isBusy = busy === p;
            return (
              <motion.button
                key={p}
                type="button"
                onClick={() => void go(p)}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...settle, delay: stagger(i, 0.06) }}
                whileTap={{ scale: 0.96 }}
                className="rounded-[var(--r-lg)] border py-10"
                style={{
                  background: isBusy ? 'var(--ink)' : 'var(--surface)',
                  color: isBusy ? 'var(--bg)' : 'var(--ink)',
                  borderColor: isBusy ? 'var(--ink)' : 'var(--line)',
                  boxShadow: isBusy ? 'var(--shadow-2)' : 'var(--shadow-1)',
                }}
              >
                <motion.span className="display block text-4xl" transition={snap}>
                  {personName(p)}
                </motion.span>
              </motion.button>
            );
          })}
        </div>

        <p className="meta mt-8 text-center text-[var(--ink-3)]">
          You can switch later. Everything is shared either way.
        </p>

        <p className="meta mt-3 text-center text-[var(--ink-3)] opacity-70">
          v<span className="numeral">{currentVersion()}</span>
        </p>
      </motion.div>
    </div>
  );
}
