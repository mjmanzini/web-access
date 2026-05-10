'use client';

import { AppShell } from '../../components/app/AppShell';
import { ThemeToggle } from '../../components/theme/ThemeProvider';

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
          <h3 className="wa-settings-title">Appearance</h3>
          <div className="wa-settings-row">
            <div>
              <strong>Theme</strong>
              <span>Switch between WhatsApp light, WhatsApp dark, and system mode.</span>
            </div>
            <ThemeToggle className="wa-theme-toggle settings" />
          </div>
        </section>
      </div>
    </AppShell>
  );
}