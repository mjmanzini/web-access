'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeProvider';

export function TopBar({ user }: { user?: { displayName: string } }) {
  const path = usePathname() ?? '';
  const tab = (href: string, label: string) => (
    <Link href={href} className={path.startsWith(href) ? 'active' : ''}>{label}</Link>
  );
  return (
    <div className="topbar">
      <div className="brand"><span className="dot" /> Web-Access</div>
      <nav style={{ display: 'flex', gap: 4 }}>
        {tab('/chat',   'Chat')}
        {tab('/remote', 'Remote')}
      </nav>
      <div className="grow" />
      {user && <span style={{ color: 'var(--wa-muted)', fontSize: 13 }}>{user.displayName}</span>}
      <ThemeToggle />
    </div>
  );
}
