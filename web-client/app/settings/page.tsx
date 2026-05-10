'use client';

import { AppShell } from '../../components/app/AppShell';

export default function SettingsPage() {
  return (
    <AppShell title="Settings" subtitle="Profile and app preferences">
      <div className="wa-hub">
        <div className="wa-hub-head">
          <span className="wa-kicker">Settings</span>
          <h2>Preferences</h2>
          <p>Profile, device, notification, and privacy controls will appear here.</p>
        </div>
        <section className="wa-waiting-room">
          <div className="wa-helper">The navigation route is ready for the unified app shell.</div>
        </section>
      </div>
    </AppShell>
  );
}