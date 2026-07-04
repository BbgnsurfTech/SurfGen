'use client';

import { KeyRound, Loader, LogIn, Mail } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, login, resendVerification } from '../../lib/api/client';

const RESEND_COOLDOWN_SECONDS = 30;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendWait, setResendWait] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNeedsVerification(false);
    try {
      await login(email, password);
      router.push('/');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'FORBIDDEN') {
        // Login's only 403: correct credentials, unverified email.
        setNeedsVerification(true);
      }
      setError(caught instanceof ApiError ? caught.message : 'API unreachable — is the stack running?');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResendWait(RESEND_COOLDOWN_SECONDS);
    const timer = setInterval(
      () => setResendWait((s) => (s <= 1 ? (clearInterval(timer), 0) : s - 1)),
      1000,
    );
    try {
      await resendVerification(email);
    } catch {
      // Quiet by design — mirrors the enumeration-safe API.
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink p-6">
      <div className="w-[400px] max-w-full">
        <div className="mb-8 flex items-center justify-center gap-3">
          <Image src="/logo.png" alt="" width={36} height={36} className="object-contain" />
          <div className="leading-none">
            <div className="font-display text-xl font-extrabold tracking-tight text-white">SurfGen</div>
            <div className="mt-1 text-[10px] font-medium tracking-[0.18em] text-camel">BBGNSURF · AI VIDEO</div>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-[20px] bg-card p-[26px] shadow-[0_30px_80px_rgba(0,0,0,.4)]">
          <div className="font-display text-lg font-bold">Sign in</div>
          <div className="mt-1 mb-5 text-[12.5px] text-taupe">Welcome back — sign in to your workspace.</div>

          <label className="mb-2 block text-[11px] font-bold tracking-[0.08em] text-taupe">EMAIL</label>
          <div className="mb-4 flex h-11 items-center gap-2 rounded-[11px] border border-line bg-paper px-[13px]">
            <Mail className="size-4 text-primary" strokeWidth={1.6} />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@surfgen.local"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-stone"
            />
          </div>

          <label className="mb-2 block text-[11px] font-bold tracking-[0.08em] text-taupe">PASSWORD</label>
          <div className="mb-5 flex h-11 items-center gap-2 rounded-[11px] border border-line bg-paper px-[13px]">
            <KeyRound className="size-4 text-primary" strokeWidth={1.6} />
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-stone"
            />
          </div>

          {error && (
            <div className="mb-4 rounded-[11px] bg-danger/10 px-[13px] py-2.5 text-[12.5px] font-semibold text-danger">
              {error}
            </div>
          )}
          {needsVerification && (
            <button
              type="button"
              onClick={resend}
              disabled={resendWait > 0}
              className="mb-4 h-10 w-full rounded-full border border-line bg-cream text-[12.5px] font-bold text-primary disabled:opacity-50"
            >
              {resendWait > 0 ? `Resend available in ${resendWait}s` : 'Resend verification email'}
            </button>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-bold text-white shadow-[0_6px_18px_rgba(122,79,34,.22)] disabled:opacity-60"
          >
            {busy ? (
              <Loader className="size-4 animate-[sg-spin_.8s_linear_infinite]" strokeWidth={1.6} />
            ) : (
              <LogIn className="size-4" strokeWidth={1.6} />
            )}
            Sign in
          </button>

          <div className="mt-4 text-center text-[12px] text-stone">
            New to SurfGen?{' '}
            <Link href="/signup" className="font-bold text-primary hover:underline">
              Create an account
            </Link>
          </div>
        </form>

        <div className="mt-5 text-center text-[11.5px] leading-relaxed text-stone">
          Stack not running yet? Start it with <span className="font-mono text-camel">./scripts/install.sh</span> —
          the seed prints the admin credentials.
        </div>
      </div>
    </main>
  );
}
