'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ensureSession, isAuthed } from '../../lib/api/client';

const LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#pipeline', label: 'Pipeline' },
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function MarketingNav() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const sync = () => setAuthed(isAuthed());
    void ensureSession().then(sync);
    window.addEventListener('surfgen:auth', sync);
    return () => window.removeEventListener('surfgen:auth', sync);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/85 backdrop-blur-md">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-5"
      >
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo-brown.png" alt="SurfGen" width={28} height={28} />
          <span className="font-display text-lg font-extrabold tracking-tight text-ink">SurfGen</span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-semibold text-bark transition-colors hover:text-primary"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/BBGNSURF/SurfGen"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-sm font-semibold text-taupe transition-colors hover:text-primary sm:block"
          >
            GitHub
          </a>
          {authed ? (
            <Link
              href="/dashboard"
              className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-deep"
            >
              Open Studio
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-semibold text-bark transition-colors hover:text-primary"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-deep"
              >
                Start free
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
