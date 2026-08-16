import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Profiles from './pages/Profiles';
import Rules from './pages/Rules';
import Activity from './pages/Activity';
import History from './pages/History';
import Requests from './pages/Requests';
import Login from './pages/Login';
import Invite from './pages/Invite';
import Account from './pages/Account';
import AlertsFeed from './components/AlertsFeed';
import ErrorBoundary from './components/ErrorBoundary';
import { auth } from './api/auth';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/devices', label: 'Devices' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/rules', label: 'Rules' },
  { to: '/requests', label: 'Requests' },
  { to: '/activity', label: 'Activity' },
  { to: '/history', label: 'History' },
  { to: '/account', label: 'Account' },
];

export default function App() {
  const [authed, setAuthed] = useState(auth.isAuthed);
  const { pathname } = useLocation();
  useEffect(() => auth.subscribe(setAuthed), []);

  // An invite link must work while signed out — that is its whole purpose.
  if (pathname.startsWith('/invite/')) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<Invite />} />
      </Routes>
    );
  }

  if (!authed) return <Login />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          Home<span>Guardian</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="ghost"
          style={{ marginTop: 20, width: '100%' }}
          onClick={() => auth.clear()}
        >
          Sign out
        </button>
        {/* Which code is this device actually running? Reading this off the
            screen settles "the feature isn't there" in one second. */}
        <div className="muted" style={{ fontSize: 10, marginTop: 10, textAlign: 'center' }}>
          build {__BUILD_ID__}
        </div>
      </aside>

      <main className="main">
        {/* Keyed on the route so navigating away from a crashed page clears it. */}
        <ErrorBoundary key={pathname}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/history" element={<History />} />
          <Route path="/account" element={<Account />} />
        </Routes>
        </ErrorBoundary>
      </main>

      <AlertsFeed />
    </div>
  );
}
