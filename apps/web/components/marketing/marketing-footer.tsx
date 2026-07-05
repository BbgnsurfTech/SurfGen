import Image from 'next/image';
import Link from 'next/link';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '#pipeline', label: 'How it works' },
      { href: '#capabilities', label: 'Capabilities' },
      { href: '#pricing', label: 'Pricing' },
      { href: '/signup', label: 'Start free' },
    ],
  },
  {
    title: 'Open source',
    links: [
      { href: 'https://github.com/BBGNSURF/SurfGen', label: 'GitHub' },
      { href: 'https://github.com/BBGNSURF/SurfGen#quick-start', label: 'Self-host guide' },
      { href: 'https://github.com/BBGNSURF/SurfGen/blob/main/docs/roadmap.md', label: 'Roadmap' },
    ],
  },
  {
    title: 'Account',
    links: [
      { href: '/login', label: 'Sign in' },
      { href: '/signup', label: 'Create account' },
      { href: '/billing', label: 'Billing' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="bg-ink text-stone">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <Image src="/logo-white.png" alt="" width={28} height={28} />
            <span className="font-display text-lg font-extrabold tracking-tight text-white">SurfGen</span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed">
            Studio-quality avatar video from a single pipeline — hosted for you, open source
            underneath.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={`${column.title} links`}>
            <h3 className="font-display text-sm font-bold uppercase tracking-wider text-camel">
              {column.title}
            </h3>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) =>
                link.href.startsWith('http') ? (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm transition-colors hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ) : (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line-dark">
        <p className="mx-auto w-full max-w-6xl px-5 py-6 text-xs">
          © {new Date().getFullYear()} SurfGen. Apache-2.0 licensed — no application code ever
          names a vendor.
        </p>
      </div>
    </footer>
  );
}
