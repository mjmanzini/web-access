'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeToggle } from '../theme/ThemeProvider';

type NavItem = {
  href: string;
  label: string;
  icon: 'chat' | 'call' | 'remote' | 'settings';
};

const navItems: NavItem[] = [
  { href: '/chat', label: 'Chats', icon: 'chat' },
  { href: '/call', label: 'Calls', icon: 'call' },
  { href: '/remote', label: 'Remote Desktop', icon: 'remote' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

function Icon({ type }: { type: NavItem['icon'] }) {
  if (type === 'chat') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 6.5A4.5 4.5 0 0 1 9.5 2h5A4.5 4.5 0 0 1 19 6.5v4A4.5 4.5 0 0 1 14.5 15H11l-4.2 3.1A.5.5 0 0 1 6 17.7V15h-.5A4.5 4.5 0 0 1 1 10.5v-4Z" />
      </svg>
    );
  }
  if (type === 'call') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.2 3.1 9.5 8a1.7 1.7 0 0 1-.4 2l-1.3 1.2a11.8 11.8 0 0 0 5 5l1.2-1.3a1.7 1.7 0 0 1 2-.4l4.9 2.3a1.6 1.6 0 0 1 .9 1.8l-.7 3A2 2 0 0 1 19 23 18 18 0 0 1 1 5a2 2 0 0 1 1.4-2l3-.7a1.6 1.6 0 0 1 1.8.8Z" />
      </svg>
    );
  }
  if (type === 'remote') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 4h18a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-7v2h4a1 1 0 1 1 0 2H6a1 1 0 1 1 0-2h4v-2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v11h18V6H3Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8.4 4a7.8 7.8 0 0 0-.1-1.1l2-1.5-2-3.5-2.4 1a8.5 8.5 0 0 0-1.9-1.1L15.7 3h-4l-.4 2.8a8.5 8.5 0 0 0-1.9 1.1L7 5.9l-2 3.5 2 1.5A7.8 7.8 0 0 0 7 12c0 .4 0 .8.1 1.1l-2 1.5 2 3.5 2.4-1a8.5 8.5 0 0 0 1.9 1.1l.4 2.8h4l.4-2.8a8.5 8.5 0 0 0 1.9-1.1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1.1Z" />
    </svg>
  );
}

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname() ?? '';
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link className={`wa-nav-item${active ? ' active' : ''}`} href={item.href} aria-current={active ? 'page' : undefined}>
      <span className="wa-nav-icon"><Icon type={item.icon} /></span>
      <span className="wa-nav-label">{item.label}</span>
    </Link>
  );
}

export function AppShell({
  title,
  subtitle,
  list,
  children,
}: {
  title: string;
  subtitle?: string;
  list?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="wa-shell">
      <nav className="wa-rail" aria-label="Primary navigation">
        <Link href="/remote" className="wa-rail-brand" aria-label="Web-Access home">
          <span>W</span>
        </Link>
        <div className="wa-rail-items">
          {navItems.map((item) => <NavLink key={item.href} item={item} />)}
        </div>
        <ThemeToggle className="wa-theme-toggle" />
      </nav>

      <aside className="wa-list-pane">
        <div className="wa-list-head">
          <div>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <ThemeToggle className="wa-theme-toggle inline" />
        </div>
        {list ?? <div className="wa-list-empty">No recent activity</div>}
      </aside>

      <main className="wa-workspace">{children}</main>

      <nav className="wa-bottom-nav" aria-label="Primary navigation">
        {navItems.map((item) => <NavLink key={item.href} item={item} />)}
      </nav>
    </div>
  );
}