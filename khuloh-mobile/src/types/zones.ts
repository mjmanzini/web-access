export type Room = {
  id: string;
  name: string;
  city: string;
  description: string;
  created_at: string;
};

export type RoomWithCount = Room & {
  online_count: number;
};

export type ZoneMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  // joined from profiles
  sender_username?: string;
  sender_avatar_url?: string | null;
  sender_vibe?: string;
};

export type Whisper = {
  id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  created_at: string;
  expires_at: string | null;
};

export type RoomMember = {
  room_id: string;
  user_id: string;
  joined_at: string;
  // joined from profiles
  username?: string | null;
  avatar_url?: string | null;
  vibe?: string;
};
