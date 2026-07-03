'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { loadTokens } from '../../lib/api/client';

/**
 * Everything inside the studio is real, org-scoped data — there is no
 * unauthenticated mode. Redirects to /login until a token pair exists.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const check = () => {
      if (loadTokens()) setReady(true);
      else router.replace('/login');
    };
    check();
    window.addEventListener('surfgen:auth', check);
    return () => window.removeEventListener('surfgen:auth', check);
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
