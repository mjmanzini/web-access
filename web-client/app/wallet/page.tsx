'use client';

import { useEffect, useMemo, useState } from 'react';
import { TopBar } from '../../components/theme/TopBar';
import {
  KhulohClient,
  type LedgerEntry,
  type TrustTier,
} from '../../lib/khuloh/client';
import { loadStoredUser, signalingUrl } from '../../lib/user-session';

const REASON_LABEL: Record<LedgerEntry['reason'], string> = {
  daily_login:    'Daily login',
  safe_meetup:    'Safe meetup',
  report_upheld:  'Report upheld',
  shout:          'Shout',
  ghost_mode:     'Ghost mode',
  guardian_bonus: 'Guardian bonus',
  refund:         'Refund',
  manual_grant:   'Manual grant',
};

const REASON_EMOJI: Record<LedgerEntry['reason'], string> = {
  daily_login: '☀️', safe_meetup: '🤝', report_upheld: '🛡️', shout: '📣',
  ghost_mode: '👻', guardian_bonus: '✨', refund: '↩️', manual_grant: '🎁',
};

// Mirror of trust.js tier thresholds.
const TIER_THRESHOLDS: Record<TrustTier, { min: number; next?: number; label: string; emoji: string }> = {
  new:      { min: 0,   next: 50,  label: 'New',      emoji: '🌱' },
  regular:  { min: 50,  next: 200, label: 'Regular',  emoji: '🙋' },
  trusted:  { min: 200, next: 500, label: 'Trusted',  emoji: '🤝' },
  guardian: { min: 500,            label: 'Guardian', emoji: '✨' },
};

const EARNING_TIPS: Array<{ reason: LedgerEntry['reason']; tip: string; value: string }> = [
  { reason: 'daily_login',    tip: 'Open Khuloh every day',           value: '+1' },
  { reason: 'safe_meetup',    tip: 'Check in & mark a meetup safe',   value: '+50' },
  { reason: 'report_upheld',  tip: 'Report scams — earn when upheld', value: '+15' },
  { reason: 'guardian_bonus', tip: 'Hit Guardian tier (≥500 trust)',  value: '+10' },
];

type Filter = 'all' | 'earned' | 'spent';

export default function WalletPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger]   = useState<LedgerEntry[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [client, setClient]   = useState<KhulohClient | null>(null);
  const [trust, setTrust]     = useState<{ score: number; tier: TrustTier } | null>(null);
  const [filter, setFilter]   = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);

  async function sync(c: KhulohClient) {
    setRefreshing(true);
    try {
      const [w, t] = await Promise.all([
        c.walletSync(),
        c.myTrust().catch(() => null),
      ]);
      setBalance(w.balance);
      setLedger(w.ledger);
      if (t) setTrust({ score: t.score, tier: t.tier });
    } catch (err) {
      setError((err as Error).message || 'sync_failed');
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const stored = loadStoredUser();
    if (!stored) { setError('Sign in to view your wallet.'); return; }
    const c = new KhulohClient(signalingUrl(), stored.token);
    setClient(c);
    void sync(c);
    return () => c.close();
  }, []);

  const filtered = useMemo(() => {
    const rows = ledger.slice().reverse();
    if (filter === 'earned') return rows.filter((r) => r.delta > 0);
    if (filter === 'spent')  return rows.filter((r) => r.delta < 0);
    return rows;
  }, [ledger, filter]);

  const spark = useMemo(() => buildSparkline(ledger, balance ?? 0), [ledger, balance]);

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <TopBar />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 16 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Vibe Wallet</h1>
        <button
          onClick={() => client && sync(client)}
          disabled={!client || refreshing}
          style={{ fontSize: 13 }}
        >
          {refreshing ? '⟳ Syncing…' : '⟳ Refresh'}
        </button>
      </div>

      {error ? (
        <p style={{ color: 'tomato' }}>{error}</p>
      ) : (
        <>
          <BalanceCard balance={balance} trust={trust} spark={spark} />

          <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
            <button
              disabled={!client || (balance ?? 0) < 100}
              onClick={async () => {
                if (!client) return;
                try {
                  const res = await client.ghostMode(30);
                  setBalance(res.balance);
                  void sync(client);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              👻 Ghost mode 30 min (−100)
            </button>
          </div>

          <EarningTips ledger={ledger} />

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '16px 0 8px' }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Recent activity</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', 'earned', 'spent'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 999,
                    background: filter === f ? 'var(--accent, #6366f1)' : 'transparent',
                    color: filter === f ? 'white' : 'inherit',
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p style={{ opacity: 0.7 }}>
              No activity yet. Earn points by daily logins, verified meetups, or upheld reports.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {filtered.map((row) => (
                <li
                  key={row.id}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span aria-hidden style={{ fontSize: 20 }}>{REASON_EMOJI[row.reason] ?? '•'}</span>
                    <div>
                      <div>{REASON_LABEL[row.reason] ?? row.reason}</div>
                      <div style={{ fontSize: 12, opacity: 0.6 }}>
                        {new Date(row.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ color: row.delta >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                    {row.delta >= 0 ? '+' : ''}{row.delta}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function BalanceCard({
  balance, trust, spark,
}: {
  balance: number | null;
  trust: { score: number; tier: TrustTier } | null;
  spark: { points: number[]; path: string };
}) {
  const tier = trust ? TIER_THRESHOLDS[trust.tier] : null;
  const pct = trust && tier?.next
    ? Math.min(100, Math.max(0, Math.round(((trust.score - tier.min) / (tier.next - tier.min)) * 100)))
    : trust ? 100 : 0;

  return (
    <section style={{ padding: 16, borderRadius: 12, background: 'var(--surface, #111)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Balance</div>
          <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1 }}>
            {balance == null ? '—' : balance.toLocaleString()}{' '}
            <span style={{ fontSize: 14, opacity: 0.7 }}>Vibe Points</span>
          </div>
        </div>
        {trust && tier && (
          <div
            title={`Trust score: ${trust.score}`}
            style={{
              fontSize: 12, padding: '6px 10px', borderRadius: 999,
              background: 'rgba(255,255,255,0.07)', whiteSpace: 'nowrap',
            }}
          >
            {tier.emoji} {tier.label}
          </div>
        )}
      </div>

      {trust && tier?.next && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
            {Math.max(0, tier.next - trust.score)} to next tier
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 999 }}>
            <div
              style={{
                width: `${pct}%`, height: '100%', borderRadius: 999,
                background: 'linear-gradient(90deg, #6366f1, #ec4899)',
              }}
            />
          </div>
        </div>
      )}

      {spark.points.length >= 2 && (
        <svg
          viewBox="0 0 200 40"
          width="100%" height="40"
          preserveAspectRatio="none"
          style={{ marginTop: 12, display: 'block' }}
          aria-hidden
        >
          <path d={spark.path} stroke="#4ade80" strokeWidth="1.5" fill="none" />
        </svg>
      )}
    </section>
  );
}

function EarningTips({ ledger }: { ledger: LedgerEntry[] }) {
  const counts: Partial<Record<LedgerEntry['reason'], number>> = {};
  for (const e of ledger) if (e.delta > 0) counts[e.reason] = (counts[e.reason] ?? 0) + 1;

  return (
    <section
      style={{
        marginTop: 12, padding: 12, borderRadius: 12,
        background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)',
      }}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>How to earn</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        {EARNING_TIPS.map((t) => (
          <li key={t.reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>{REASON_EMOJI[t.reason]} {t.tip}</span>
            <span style={{ opacity: 0.7 }}>
              {t.value}
              {counts[t.reason] ? ` · ${counts[t.reason]}×` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function buildSparkline(ledger: LedgerEntry[], currentBalance: number) {
  if (ledger.length === 0) return { points: [], path: '' };
  const sorted = ledger.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  let running = currentBalance;
  const series: number[] = [running];
  for (let i = sorted.length - 1; i >= 0; i--) {
    running -= sorted[i].delta;
    series.unshift(running);
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(1, max - min);
  const stepX = 200 / Math.max(1, series.length - 1);
  const path = series
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(40 - ((v - min) / span) * 36 - 2).toFixed(1)}`)
    .join(' ');
  return { points: series, path };
}
