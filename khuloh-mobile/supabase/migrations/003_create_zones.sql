-- ============================================================
-- Khuloh: Zones (Chat Rooms) – rooms, presence, messages, whispers
-- ============================================================

-- 1. Rooms – each room is tied to a South African city/area
CREATE TABLE public.rooms (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,          -- e.g. "Joburg-Central"
  city        text        NOT NULL,                 -- e.g. "Johannesburg"
  description text        DEFAULT '',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- 2. Room members (presence tracking)
CREATE TABLE public.room_members (
  room_id     uuid        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at   timestamptz DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;

-- Index for fast online count per room
CREATE INDEX idx_room_members_room ON public.room_members (room_id);

-- 3. Zone messages (group chat)
CREATE TABLE public.zone_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid        NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        text        NOT NULL CHECK (char_length(body) <= 2000),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.zone_messages ENABLE ROW LEVEL SECURITY;

-- Index for fetching messages by room in order
CREATE INDEX idx_zone_messages_room ON public.zone_messages (room_id, created_at DESC);

-- 4. Whispers (private 1-on-1 messages)
CREATE TABLE public.whispers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        text        NOT NULL CHECK (char_length(body) <= 2000),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.whispers ENABLE ROW LEVEL SECURITY;

-- Index for fetching conversation between two users
CREATE INDEX idx_whispers_pair ON public.whispers (
  LEAST(sender_id, receiver_id),
  GREATEST(sender_id, receiver_id),
  created_at DESC
);

-- 5. Enable Realtime on messages & whispers tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.zone_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whispers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;

-- 6. Seed default South African city rooms
INSERT INTO public.rooms (name, city, description) VALUES
  ('Joburg-Central',   'Johannesburg', 'The heartbeat of Jozi'),
  ('Soweto',           'Johannesburg', 'The soul of the city'),
  ('Sandton',          'Johannesburg', 'Where ambition meets style'),
  ('CPT-Waterfront',   'Cape Town',    'Ocean views & vibes'),
  ('CPT-Long-Street',  'Cape Town',    'The nightlife strip'),
  ('Khayelitsha',      'Cape Town',    'Community energy'),
  ('Durban-Beachfront','Durban',       'Warm waters, warm people'),
  ('Umhlanga',         'Durban',       'Coastal luxury'),
  ('Pretoria-Central', 'Pretoria',     'Jacaranda city'),
  ('Gqeberha-Central', 'Gqeberha',    'The windy city vibes'),
  ('Bloemfontein',     'Bloemfontein', 'City of roses'),
  ('Polokwane',        'Polokwane',    'Gateway to the north');

-- 7. View for room online counts (used by dashboard)
CREATE OR REPLACE VIEW public.rooms_with_counts AS
SELECT
  r.id,
  r.name,
  r.city,
  r.description,
  COUNT(rm.user_id)::int AS online_count
FROM public.rooms r
LEFT JOIN public.room_members rm ON rm.room_id = r.id
GROUP BY r.id, r.name, r.city, r.description;
