export type Vibe = 'chat' | 'connect' | 'ignite';

export const VIBE_COLORS: Record<Vibe, string> = {
  chat: '#4ade80',
  connect: '#facc15',
  ignite: '#ef4444',
};

export const VIBE_LABELS: Record<Vibe, string> = {
  chat: 'Chat',
  connect: 'Connect',
  ignite: 'Ignite',
};

export type Profile = {
  id: string;
  phone: string;
  username: string | null;
  bio: string;
  trust_score: number;
  is_verified: boolean;
  is_shadow_banned: boolean;
  avatar_url: string | null;
  vibe: Vibe;
  vibe_points: number;
  data_light_mode: boolean;
  reverify_required: boolean;
  ghost_mode_until: string | null;
  created_at: string;
  updated_at: string;
};
