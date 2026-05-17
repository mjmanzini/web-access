'use client';

import { useEffect, useState } from 'react';
import {
  getPanicContacts,
  setPanicContacts,
  type PanicContact,
} from '../../lib/khuloh/client';
import { signalingUrl, loadStoredUser } from '../../lib/user-session';

const MAX = 3;

export function PanicContactsSettings() {
  const [contacts, setContacts] = useState<PanicContact[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [ok, setOk]             = useState(false);

  useEffect(() => {
    const u = loadStoredUser();
    if (!u) { setLoading(false); return; }
    getPanicContacts(signalingUrl(), u.token)
      .then((c) => setContacts(c.length ? c : [{ name: '', phone: '', email: '' }]))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  function update(i: number, patch: Partial<PanicContact>) {
    setContacts((arr) => arr.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    setOk(false);
  }

  function addRow() {
    setContacts((arr) => (arr.length >= MAX ? arr : [...arr, { name: '', phone: '', email: '' }]));
  }

  function removeRow(i: number) {
    setContacts((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function save() {
    const u = loadStoredUser();
    if (!u) return;
    setBusy(true); setErr(null); setOk(false);
    try {
      const clean = contacts
        .map((c) => ({ name: c.name.trim(), phone: c.phone?.trim() || null, email: c.email?.trim() || null }))
        .filter((c) => c.name && (c.phone || c.email));
      const saved = await setPanicContacts(signalingUrl(), u.token, clean);
      setContacts(saved.length ? saved : [{ name: '', phone: '', email: '' }]);
      setOk(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="wa-waiting-room"><h3 className="wa-settings-title">Panic contacts</h3><p>Loading…</p></section>;

  return (
    <section className="wa-waiting-room">
      <h3 className="wa-settings-title">Panic contacts</h3>
      <p style={{ color: 'var(--wa-muted)', fontSize: 13, marginBottom: 12 }}>
        Up to {MAX} trusted people we will alert when you trigger a panic check-in.
        Stored encrypted at rest.
      </p>
      {contacts.map((c, i) => (
        <div key={i} className="wa-settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Name"
            value={c.name}
            onChange={(e) => update(i, { name: e.target.value })}
            maxLength={80}
          />
          <input
            type="tel"
            placeholder="Phone (e.g. +27 …)"
            value={c.phone || ''}
            onChange={(e) => update(i, { phone: e.target.value })}
            maxLength={32}
          />
          <input
            type="email"
            placeholder="Email"
            value={c.email || ''}
            onChange={(e) => update(i, { email: e.target.value })}
            maxLength={200}
          />
          <button type="button" className="add-contact-secondary" onClick={() => removeRow(i)}>
            Remove
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        {contacts.length < MAX && (
          <button type="button" className="add-contact-secondary" onClick={addRow}>
            + Add contact
          </button>
        )}
        <button type="button" className="wa-primary-btn" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {err && <span className="profile-avatar-error">{err}</span>}
      {ok  && <span style={{ color: 'var(--wa-accent)', fontSize: 13 }}>Saved.</span>}
    </section>
  );
}
