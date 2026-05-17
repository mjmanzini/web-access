-- ============================================================
-- 008: Vibe Economy — Vibe Points, Shouts, Zone Guardians, Mutes
-- ============================================================

-- 1. Add vibe_points column to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vibe_points integer NOT NULL DEFAULT 0;

-- 2. Point-transaction reason enum
CREATE TYPE point_reason AS ENUM (
  'bio_complete',
  'safe_date_review',
  'scammer_reported',
  'shout_spent',
  'guardian_bonus',
  'checkin_complete'
);

-- 3. Ledger of every point change
CREATE TABLE point_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount      integer NOT NULL,          -- positive = earn, negative = spend
  reason      point_reason NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pt_user ON point_transactions(user_id, created_at DESC);

-- 4. Shouts — broadcast messages in a zone (cost vibe points)
CREATE TABLE shouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
  cost        integer NOT NULL DEFAULT 5,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shouts_room ON shouts(room_id, created_at DESC);

-- 5. Zone Guardians — trusted moderators per room
CREATE TABLE zone_guardians (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(room_id, user_id)
);

-- 6. Mutes — guardians can temporarily mute users in a zone
CREATE TABLE mutes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  muted_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  muted_by      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason        text NOT NULL DEFAULT '',
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mutes_room ON mutes(room_id, muted_user_id, expires_at);

-- 7. Function to award points atomically
CREATE OR REPLACE FUNCTION award_vibe_points(
  _user_id uuid,
  _amount  integer,
  _reason  point_reason
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _new_balance integer;
BEGIN
  -- For spending (negative), check sufficient balance
  IF _amount < 0 THEN
    IF (SELECT vibe_points FROM profiles WHERE id = _user_id) + _amount < 0 THEN
      RAISE EXCEPTION 'Insufficient vibe points';
    END IF;
  END IF;

  -- Update balance
  UPDATE profiles
    SET vibe_points = vibe_points + _amount
    WHERE id = _user_id
    RETURNING vibe_points INTO _new_balance;

  -- Record transaction
  INSERT INTO point_transactions (user_id, amount, reason)
    VALUES (_user_id, _amount, _reason);

  RETURN _new_balance;
END;
$$;

-- 8. Function to send a shout (deducts points + inserts shout)
CREATE OR REPLACE FUNCTION send_shout(
  _room_id  uuid,
  _sender   uuid,
  _body     text,
  _cost     integer DEFAULT 5
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _shout_id uuid;
BEGIN
  -- Deduct points
  PERFORM award_vibe_points(_sender, -_cost, 'shout_spent');

  -- Insert shout
  INSERT INTO shouts (room_id, sender_id, body, cost)
    VALUES (_room_id, _sender, _body, _cost)
    RETURNING id INTO _shout_id;

  RETURN _shout_id;
END;
$$;

-- 9. Auto-grant guardian status to users with trust_score >= 80
--    (run periodically or call manually)
CREATE OR REPLACE FUNCTION refresh_zone_guardians()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Insert any qualifying user who is in a room and has trust_score >= 80
  INSERT INTO zone_guardians (room_id, user_id)
    SELECT DISTINCT rm.room_id, rm.user_id
    FROM room_members rm
    JOIN profiles p ON p.id = rm.user_id
    WHERE p.trust_score >= 80
      AND p.is_verified = true
      AND NOT EXISTS (
        SELECT 1 FROM zone_guardians zg
        WHERE zg.room_id = rm.room_id AND zg.user_id = rm.user_id
      )
  ON CONFLICT (room_id, user_id) DO NOTHING;

  -- Award bonus points to new guardians
  INSERT INTO point_transactions (user_id, amount, reason)
    SELECT zg.user_id, 10, 'guardian_bonus'
    FROM zone_guardians zg
    WHERE zg.granted_at > now() - interval '1 minute';
END;
$$;

-- 10. Enable realtime for shouts
ALTER PUBLICATION supabase_realtime ADD TABLE shouts;
