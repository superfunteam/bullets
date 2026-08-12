import { useState } from 'react';
import { motion } from 'motion/react';
import { BigButton } from '../design/bits';
import { settle, snap } from '../design/springs';
import { signIn } from '../sync/auth';
import { PEOPLE, personName, type Person } from '../data/types';

/** No email, no accounts. A shared phrase, then say which of the two you are. */
export function SignIn({ onDone }: { onDone: (p: Person) => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [person, setPerson] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!person || !passphrase.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await signIn(passphrase.trim(), person);
      if (ok) onDone(person);
      else setError('That phrase did not work.');
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
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
        <h1 className="display text-6xl text-[var(--ink)]">Bullets</h1>
        <p className="editorial mt-2 text-2xl text-[var(--ink-3)]">No more dodging.</p>

        <div className="mt-12">
          <p className="meta mb-3 text-[var(--ink-3)] uppercase">Who's this?</p>
          <div className="grid grid-cols-2 gap-3">
            {PEOPLE.map(p => {
              const active = person === p;
              return (
                <motion.button
                  key={p}
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  transition={snap}
                  onClick={() => setPerson(p)}
                  className="rounded-[var(--r-lg)] border py-8"
                  style={{
                    background: active ? 'var(--ink)' : 'var(--surface)',
                    color: active ? 'var(--bg)' : 'var(--ink)',
                    borderColor: active ? 'var(--ink)' : 'var(--line)',
                    boxShadow: active ? 'var(--shadow-2)' : 'var(--shadow-1)',
                  }}
                >
                  <span className="display text-3xl">{personName(p)}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="mt-7">
          <p className="meta mb-3 text-[var(--ink-3)] uppercase">Space phrase</p>
          <input
            type="password"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void go()}
            placeholder="••••••••"
            className="min-h-[var(--tap)] w-full rounded-[var(--r-md)] border
                       border-[var(--line)] bg-[var(--surface)] px-5 text-xl
                       text-[var(--ink)] placeholder:text-[var(--ink-3)]"
          />
        </div>

        {error && (
          <p className="meta mt-4 text-center" style={{ color: 'var(--wide)' }}>
            {error}
          </p>
        )}

        <div className="mt-7">
          <BigButton onClick={() => void go()} disabled={!person || !passphrase.trim() || busy}>
            {busy ? 'Checking…' : 'Come in'}
          </BigButton>
        </div>
      </motion.div>
    </div>
  );
}
