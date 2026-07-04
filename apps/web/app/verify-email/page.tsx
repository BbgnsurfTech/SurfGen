'use client';

import { CircleCheck, CircleX, Loader } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { ApiError, verifyEmail } from '../../lib/api/client';

const REDIRECT_DELAY_MS = 1500;

type Phase = 'verifying' | 'done' | 'failed';

function VerifyContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [phase, setPhase] = useState<Phase>('verifying');
  const [message, setMessage] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    // Single-use token — React strict-mode double effects must not burn it.
    if (attempted.current) return;
    attempted.current = true;
    if (!token) {
      setPhase('failed');
      setMessage('The link is missing its token — use the button from the email.');
      return;
    }
    verifyEmail(token)
      .then(() => {
        setPhase('done');
        setTimeout(() => router.replace('/'), REDIRECT_DELAY_MS);
      })
      .catch((caught) => {
        setPhase('failed');
        setMessage(
          caught instanceof ApiError
            ? caught.message
            : 'API unreachable — is the stack running?',
        );
      });
  }, [token, router]);

  return (
    <div className="rounded-[20px] bg-card p-[26px] text-center shadow-[0_30px_80px_rgba(0,0,0,.4)]">
      {phase === 'verifying' && (
        <>
          <Loader className="mx-auto size-8 animate-[sg-spin_.8s_linear_infinite] text-primary" strokeWidth={1.6} />
          <div className="mt-4 font-display text-lg font-bold">Verifying your email…</div>
        </>
      )}
      {phase === 'done' && (
        <>
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10">
            <CircleCheck className="size-7 text-success" strokeWidth={1.6} />
          </div>
          <div className="mt-4 font-display text-lg font-bold">Email verified</div>
          <p className="mt-2 text-[12.5px] text-taupe">You&apos;re signed in — taking you to the studio.</p>
        </>
      )}
      {phase === 'failed' && (
        <>
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-danger/10">
            <CircleX className="size-7 text-danger" strokeWidth={1.6} />
          </div>
          <div className="mt-4 font-display text-lg font-bold">Verification failed</div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-taupe">{message}</p>
          <p className="mt-2 text-[12px] text-stone">
            Links expire after 24 hours and work once. Request a fresh one from the sign-in page.
          </p>
          <Link
            href="/login"
            className="mt-5 block h-10 w-full rounded-full bg-primary text-center text-[12.5px] font-bold leading-10 text-white"
          >
            Go to sign in
          </Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
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
        <Suspense fallback={null}>
          <VerifyContent />
        </Suspense>
      </div>
    </main>
  );
}
