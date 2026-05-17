// ── Safe-Spots & Meetup types ──

export type SafeSpot = {
  id: string;
  name: string;
  category: 'cafe' | 'restaurant' | 'lounge' | 'bar';
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  discount_pct: number;
  is_active: boolean;
  image_url: string | null;
  created_at: string;
};

export type CheckinStatus = 'pending' | 'confirmed' | 'expired' | 'redeemed';

export type PairCheckin = {
  id: string;
  safe_spot_id: string;
  initiator_id: string;
  partner_id: string;
  checkin_code: string;
  status: CheckinStatus;
  discount_pct: number;
  created_at: string;
  confirmed_at: string | null;
  expires_at: string;
  // joined
  spot_name?: string;
  partner_username?: string;
};

export type MeetupRating = 'safe' | 'respectful' | 'unreliable';

export const RATING_LABELS: Record<MeetupRating, string> = {
  safe: '✅ Safe',
  respectful: '🤝 Respectful',
  unreliable: '⚠️ Unreliable',
};

export const RATING_DESCRIPTIONS: Record<MeetupRating, string> = {
  safe: 'I felt safe throughout the meetup',
  respectful: 'They were polite and respectful',
  unreliable: 'I had concerns about this person',
};

export type PostMeetupReview = {
  id: string;
  reviewer_id: string;
  reviewed_id: string;
  rating: MeetupRating;
  comment: string;
  pair_checkin_id: string | null;
  created_at: string;
};

export type PendingReview = {
  id: string;
  user_id: string;
  other_user_id: string;
  pair_checkin_id: string | null;
  prompted_at: string;
  reviewed: boolean;
  // joined
  other_username?: string;
};
