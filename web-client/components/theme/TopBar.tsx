'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeProvider';

export function TopBar({ user }: { user?: { displayName: string; avatarUrl?: string | null } }) {
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
      {user && (
        <Link href="/settings" className="topbar-me" aria-label="Profile" title="Profile & settings">
          {user.avatarUrl
            ? <img src={user.avatarUrl} alt="" className="topbar-avatar" />
            : <span className="topbar-avatar topbar-avatar-fallback">{user.displayName?.[0]?.toUpperCase() ?? '?'}</span>}
          <span className="topbar-name">{user.displayName}</span>
        </Link>
      )}
      <ThemeToggle />
    </div>
  );
}
