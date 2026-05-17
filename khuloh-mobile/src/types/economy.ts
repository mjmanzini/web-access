// ── Vibe Economy types ──

export type PointReason =
  | 'bio_complete'
  | 'safe_date_review'
  | 'scammer_reported'
  | 'shout_spent'
  | 'guardian_bonus'
  | 'checkin_complete'
  | 'daily_login'
  | 'verified_meetup'
  | 'city_shout'
  | 'ghost_mode';

export const POINT_REASON_LABELS: Record<PointReason, string> = {
  bio_complete: 'Bio completed',
  safe_date_review: 'Safe date review',
  scammer_reported: 'Scammer reported',
  shout_spent: 'Shout sent',
  guardian_bonus: 'Guardian bonus',
  checkin_complete: 'Check-in complete',
  daily_login: 'Daily login bonus',
  verified_meetup: 'Verified meetup',
  city_shout: 'City shout',
  ghost_mode: 'Ghost mode',
};

export const POINT_AMOUNTS: Record<PointReason, number> = {
  bio_complete: 20,
  safe_date_review: 15,
  scammer_reported: 10,
  shout_spent: -5,
  guardian_bonus: 10,
  checkin_complete: 5,
  daily_login: 10,
  verified_meetup: 50,
  city_shout: -20,
  ghost_mode: -100,
};

export type PointTransaction = {
  id: string;
  user_id: string;
  amount: number;
  reason: PointReason;
  created_at: string;
};

export type Shout = {
  id: string;
  room_id: string;
  sender_id: string;
  body: string;
  cost: number;
  created_at: string;
  // joined from profiles
  sender_username?: string;
  sender_vibe?: string;
};

export type ZoneGuardian = {
  id: string;
  room_id: string;
  user_id: string;
  granted_at: string;
};

export type Mute = {
  id: string;
  room_id: string;
  muted_user_id: string;
  muted_by: string;
  reason: string;
  expires_at: string;
  created_at: string;
};

export type TrustBadge = {
  id: string;
  user_id: string;
  partner_spot_id: string;
  qr_token: string;
  discount_pct: number;
  points_awarded: number;
  verified_at: string;
  created_at: string;
};

export type GhostModeState = {
  active: boolean;
  until: string | null;  // ISO timestamp
  remainingMs: number;
};

export type DailyLoginResult = {
  claimed: boolean;
  balance: number;
  awarded?: number;
  message?: string;
};
