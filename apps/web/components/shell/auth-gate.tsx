'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ensureSession, isAuthed } from '../../lib/api/client';

/**
 * Everything inside the studio is real, org-scoped data — there is no
 * unauthenticated mode. On mount, restores the session via the httpOnly
 * refresh cookie (one silent refresh); redirects to /login when that fails
 * or the session later dies.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (isAuthed()) setReady(true);
      else router.replace('/login');
    };
    void ensureSession().then(() => {
      if (!cancelled) sync();
    });
    window.addEventListener('surfgen:auth', sync);
    return () => {
      cancelled = true;
      window.removeEventListener('surfgen:auth', sync);
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-paper text-[13px] font-semibold text-taupe">
        Checking session…
      </div>
    );
  }
  return <>{children}</>;
}
