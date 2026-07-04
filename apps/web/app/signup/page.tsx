'use client';

import { Check, KeyRound, Loader, Mail, MailCheck, ShieldCheck, User, UserPlus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, register, resendVerification } from '../../lib/api/client';

const MIN_PASSWORD_LENGTH = 12;
const RESEND_COOLDOWN_SECONDS = 30;

interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
}

/** Rule-based meter: length is the dominant factor, variety refines it. */
function passwordStrength(password: string): Strength {
  if (password.length === 0) return { score: 0, label: '', color: 'bg-line' };
  if (password.length < MIN_PASSWORD_LENGTH) return { score: 1, label: 'Too short', color: 'bg-danger' };
  let variety = 0;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) variety += 1;
  if (/\d/.test(password)) variety += 1;
  if (/[^a-zA-Z0-9]/.test(password)) variety += 1;
  const long = password.length >= 16 ? 1 : 0;
  const score = Math.min(4, 1 + variety + long) as Strength['score'];
  if (score >= 4) return { score: 4, label: 'Strong', color: 'bg-success' };
  if (score === 3) return { score: 3, label: 'Good', color: 'bg-success' };
  return { score: 2, label: 'Fair — add variety or length', color: 'bg-warn' };
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <label className="mb-2 block text-[11px] font-bold tracking-[0.08em] text-taupe">{label}</label>
      <div className="mb-4 flex h-11 items-center gap-2 rounded-[11px] border border-line bg-paper px-[13px]">
        {icon}
        {children}
      </div>
    </>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [resendWait, setResendWait] = useState(0);

  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await register({ name, email, password, ...(website && { website }) });
      if (result.verified) router.push('/');
      else setAwaitingVerification(true);
    } catch (caught) {
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
      // Deliberately quiet — the API never confirms account existence either.
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink p-6">
      <div className="w-[420px] max-w-full">
        <div className="mb-8 flex items-center justify-center gap-3">
          <Image src="/logo-white.png" alt="" width={36} height={36} className="object-contain" />
          <div className="leading-none">
            <div className="font-display text-xl font-extrabold tracking-tight text-white">SurfGen</div>
            <div className="mt-1 text-[10px] font-medium tracking-[0.18em] text-camel">BBGNSURF · AI VIDEO</div>
          </div>
        </div>

        {awaitingVerification ? (
          <div className="rounded-[20px] bg-card p-[26px] text-center shadow-[0_30px_80px_rgba(0,0,0,.4)]">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/10">
              <MailCheck className="size-7 text-success" strokeWidth={1.6} />
            </div>
            <div className="font-display text-lg font-bold">Check your inbox</div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-taupe">
              We sent a verification link to <span className="font-semibold text-ink">{email}</span>.
              It expires in 24 hours and works once. Nothing arrives? Check spam, then resend.
            </p>
            <button
              onClick={resend}
              disabled={resendWait > 0}
              className="mt-5 h-10 w-full rounded-full border border-line bg-cream text-[12.5px] font-bold text-primary disabled:opacity-50"
            >
              {resendWait > 0 ? `Resend available in ${resendWait}s` : 'Resend verification email'}
            </button>
            <Link href="/login" className="mt-3 block text-[12px] font-semibold text-stone hover:text-primary">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-[20px] bg-card p-[26px] shadow-[0_30px_80px_rgba(0,0,0,.4)]">
            <div className="font-display text-lg font-bold">Create your account</div>
            <div className="mt-1 mb-5 text-[12.5px] text-taupe">
              A personal workspace is provisioned automatically.
            </div>

            <Field label="NAME" icon={<User className="size-4 text-primary" strokeWidth={1.6} />}>
              <input
                required
                autoComplete="name"
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ada Lovelace"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-stone"
              />
            </Field>

            <Field label="EMAIL" icon={<Mail className="size-4 text-primary" strokeWidth={1.6} />}>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@studio.com"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-stone"
              />
            </Field>

            <Field label="PASSWORD" icon={<KeyRound className="size-4 text-primary" strokeWidth={1.6} />}>
              <input
                type="password"
                required
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={`${MIN_PASSWORD_LENGTH}+ characters`}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-stone"
              />
            </Field>
            {password.length > 0 && (
              <div className="-mt-2 mb-4">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((step) => (
                    <span
                      key={step}
                      className={`h-1 flex-1 rounded-full ${step <= strength.score ? strength.color : 'bg-line'}`}
                    />
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-taupe">
                  <ShieldCheck className="size-3 text-primary" strokeWidth={1.6} />
                  {strength.label}
                </div>
              </div>
            )}

            <Field label="CONFIRM PASSWORD" icon={<Check className="size-4 text-primary" strokeWidth={1.6} />}>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Repeat the password"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-stone"
              />
            </Field>
            {mismatch && (
              <div className="-mt-2 mb-4 text-[11.5px] font-semibold text-danger">Passwords do not match</div>
            )}

            {/* Honeypot: invisible to people, filled by naive bots. */}
            <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-0 w-0 overflow-hidden">
              <label htmlFor="website">Website</label>
              <input
                id="website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>

            {error && (
              <div className="mb-4 rounded-[11px] bg-danger/10 px-[13px] py-2.5 text-[12.5px] font-semibold text-danger">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || mismatch}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-bold text-white shadow-[0_6px_18px_rgba(122,79,34,.22)] disabled:opacity-60"
            >
              {busy ? (
                <Loader className="size-4 animate-[sg-spin_.8s_linear_infinite]" strokeWidth={1.6} />
              ) : (
                <UserPlus className="size-4" strokeWidth={1.6} />
              )}
              Create account
            </button>

            <div className="mt-4 text-center text-[12px] text-stone">
              Already have an account?{' '}
              <Link href="/login" className="font-bold text-primary hover:underline">
                Sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
