'use client';

import {
  Blocks,
  ChevronsUpDown,
  Clapperboard,
  Code,
  CreditCard,
  Gauge,
  LayoutDashboard,
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

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  badgeKind?: 'live' | 'count';
}

const CREATE_NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
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

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-[236px] flex-none flex-col border-r border-line-dark bg-ink text-sand">
      <div className="flex items-center gap-[11px] border-b border-carbon px-5 pt-5 pb-4">
        <Image src="/logo.png" alt="SurfGen logo" width={30} height={30} className="flex-none object-contain" />
        <div className="leading-none">
          <div className="font-display text-[17px] font-extrabold tracking-tight text-white">SurfGen</div>
          <div className="mt-[3px] text-[9.5px] font-medium tracking-[0.18em] text-camel">
            BBGNSURF · AI VIDEO
          </div>
        </div>
      </div>

      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-3 pt-4">
        <NavGroup title="CREATE" items={CREATE_NAV} pathname={pathname} />
        <div className="pt-5">
          <NavGroup title="ADMIN & OPS" items={ADMIN_NAV} pathname={pathname} />
        </div>
      </nav>

      <div className="border-t border-carbon p-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-espresso px-2.5 py-2">
          <div className="font-display flex size-8 flex-none items-center justify-center rounded-full bg-gradient-to-br from-camel to-primary text-[13px] font-bold text-white">
            AK
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-white">A. Kabir</div>
            <div className="text-[10.5px] text-taupe">Platform Engineer</div>
          </div>
          <ChevronsUpDown className="size-[15px] text-taupe" strokeWidth={1.6} />
        </div>
      </div>
    </aside>
  );
}
