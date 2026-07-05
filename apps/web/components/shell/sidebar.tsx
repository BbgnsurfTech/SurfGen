'use client';

import {
  Blocks,
  ChevronsUpDown,
  Clapperboard,
  Code,
  CreditCard,
  Gauge,
  LayoutDashboard,
  LogOut,
  Palette,
  PlugZap,
  UserRoundCog,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logout } from '../../lib/api/client';
import { useMe, useOrg } from '../../lib/api/hooks';
import { useToast } from '../ui/toast';
import { useMobileNav } from './mobile-nav';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  badgeKind?: 'live' | 'count';
}

const CREATE_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/editor', label: 'Video Editor', icon: Clapperboard },
  { href: '/studio', label: 'Avatar & Voice', icon: UserRoundCog },
  { href: '/workflows', label: 'Workflows', icon: Workflow },
  { href: '/brands', label: 'Brand Kits', icon: Palette },
  { href: '/billing', label: 'Billing', icon: Wallet },
];

const ADMIN_NAV: NavItem[] = [
  { href: '/providers', label: 'Providers', icon: PlugZap, badge: '24', badgeKind: 'count' },
  { href: '/monitor', label: 'GPU & Queues', icon: Gauge, badge: '8', badgeKind: 'live' },
  { href: '/developer', label: 'Developer', icon: Code },
  { href: '/plugins', label: 'Plugins', icon: Blocks },
  { href: '/payments', label: 'Payments', icon: CreditCard },
];

function NavGroup({ title, items, pathname }: { title: string; items: NavItem[]; pathname: string }) {
  return (
    <>
      <div className="px-2.5 pb-2 text-[10px] font-bold tracking-[0.14em] text-taupe">{title}</div>
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`mb-0.5 flex w-full items-center gap-[11px] rounded-[11px] px-3 py-2.5 text-[13px] font-semibold transition-colors ${
              active
                ? 'bg-camel/15 text-white shadow-[inset_3px_0_0_var(--color-camel)]'
                : 'text-stone hover:bg-white/5 hover:text-shell'
            }`}
          >
            <item.icon className="size-[18px]" strokeWidth={1.6} />
            <span className="flex-1 text-left">{item.label}</span>
            {item.badge && (
              <span
                className={`rounded-full px-[7px] py-px text-[10px] font-bold ${
                  item.badgeKind === 'live' ? 'bg-danger text-white' : 'bg-shell text-primary'
                }`}
              >
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}

function initials(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?';
}

function AccountMenu() {
  const me = useMe();
  const org = useOrg();
  const flash = useToast();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div ref={rootRef} className="relative border-t border-carbon p-3">
      {open && (
        <div
          role="menu"
          className="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-xl border border-carbon bg-espresso shadow-[0_16px_40px_rgba(0,0,0,.35)]"
        >
          <div className="border-b border-carbon px-3 py-2.5">
            <div className="truncate text-[12.5px] font-semibold text-white">{me.data?.name ?? '—'}</div>
            <div className="truncate text-[10.5px] text-taupe">{me.data?.email ?? '—'}</div>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
              flash('Logged out');
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] font-semibold text-stone hover:bg-white/5 hover:text-shell"
          >
            <LogOut className="size-[15px]" strokeWidth={1.6} />
            Log out
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-xl bg-espresso px-2.5 py-2 text-left hover:bg-espresso/80"
      >
        <div className="font-display flex size-8 flex-none items-center justify-center rounded-full bg-gradient-to-br from-camel to-primary text-[13px] font-bold text-white">
          {me.data ? initials(me.data.name) : '···'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-white">{me.data?.name ?? 'Loading…'}</div>
          <div className="truncate text-[10.5px] text-taupe capitalize">{org.data?.role ?? '—'}</div>
        </div>
        <ChevronsUpDown className="size-[15px] flex-none text-taupe" strokeWidth={1.6} />
      </button>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { open, close } = useMobileNav();
  return (
    <>
      {open && (
        <div
          onClick={close}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-ink/60 backdrop-blur-sm lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[236px] flex-none flex-col border-r border-line-dark bg-ink text-sand transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-[11px] border-b border-carbon px-5 pt-5 pb-4">
          <Image src="/logo.png" alt="SurfGen logo" width={30} height={30} className="flex-none object-contain" />
          <div className="leading-none">
            <div className="font-display text-[17px] font-extrabold tracking-tight text-white">SurfGen</div>
            <div className="mt-[3px] text-[9.5px] font-medium tracking-[0.18em] text-camel">
              BBGNSURF · AI VIDEO
            </div>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-3 pt-4" onClick={close}>
          <NavGroup title="CREATE" items={CREATE_NAV} pathname={pathname} />
          <div className="pt-5">
            <NavGroup title="ADMIN & OPS" items={ADMIN_NAV} pathname={pathname} />
          </div>
        </nav>

        <AccountMenu />
      </aside>
    </>
  );
}
