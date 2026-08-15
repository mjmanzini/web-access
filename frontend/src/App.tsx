import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Profiles from './pages/Profiles';
import Rules from './pages/Rules';
import Activity from './pages/Activity';
import Requests from './pages/Requests';
import Login from './pages/Login';
import Account from './pages/Account';
import AlertsFeed from './components/AlertsFeed';
import { auth } from './api/auth';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/devices', label: 'Devices' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/rules', label: 'Rules' },
  { to: '/requests', label: 'Requests' },
  { to: '/activity', label: 'Activity' },
  { to: '/account', label: 'Account' },
];

export default function App() {
  const [authed, setAuthed] = useState(auth.isAuthed);
  useEffect(() => auth.subscribe(setAuthed), []);

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
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/account" element={<Account />} />
        </Routes>
      </main>

      <AlertsFeed />
    </div>
  );
}
