import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Profiles from './pages/Profiles';
import Rules from './pages/Rules';
import Activity from './pages/Activity';
import AlertsFeed from './components/AlertsFeed';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/devices', label: 'Devices' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/rules', label: 'Rules' },
  { to: '/activity', label: 'Activity' },
];

export default function App() {
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
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/activity" element={<Activity />} />
        </Routes>
      </main>

      <AlertsFeed />
    </div>
  );
}
