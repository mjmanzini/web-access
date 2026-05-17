-- ============================================================
-- 010: Safe-Spots, Pair Check-ins, Post-Meetup Reviews,
--      Data-Light mode, Auto Re-verification
-- ============================================================

-- 1. Verified Safe-Spot partner venues
CREATE TABLE safe_spots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  category    text NOT NULL DEFAULT 'cafe',         -- cafe, restaurant, lounge, bar
  address     text NOT NULL,
  city        text NOT NULL,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  phone       text,
  discount_pct integer NOT NULL DEFAULT 10,          -- e.g. 10 for 10%
  is_active   boolean NOT NULL DEFAULT true,
  image_url   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_safe_spots_city ON safe_spots(city);
CREATE INDEX idx_safe_spots_geo  ON safe_spots(latitude, longitude);

-- Seed popular SA venues
INSERT INTO safe_spots (name, category, address, city, latitude, longitude, discount_pct) VALUES
  ('Mug & Bean V&A',         'cafe',       'V&A Waterfront, Cape Town',       'Cape Town',     -33.9036, 18.4211, 10),
  ('Starbucks Sandton',      'cafe',       'Sandton City, Sandton',           'Johannesburg',  -26.1076, 28.0567, 10),
  ('Rocomamas Menlyn',       'restaurant', 'Menlyn Park, Pretoria',           'Pretoria',      -25.7825, 28.2762, 10),
  ('The Bungalow Clifton',   'lounge',     '3rd Beach, Clifton',             'Cape Town',     -33.9400, 18.3762, 10),
  ('Cafe Del Sol Umhlanga',  'cafe',       'Gateway Mall, Umhlanga',          'Durban',        -29.7280, 31.0680, 10),
  ('Tashas Rosebank',        'restaurant', 'The Zone, Rosebank',              'Johannesburg',  -26.1462, 28.0437, 10),
  ('Mugg & Bean Eastgate',   'cafe',       'Eastgate Shopping Centre',        'Johannesburg',  -26.1760, 28.1170, 10),
  ('The Lighthouse Bar',     'bar',        'Harbour Town, Durban',            'Durban',        -29.8567, 31.0292, 10),
  ('News Cafe Stellenbosch', 'lounge',     'Eikestad Mall, Stellenbosch',     'Stellenbosch',  -33.9341, 18.8602, 10),
  ('Ocean Basket Canal Walk', 'restaurant', 'Canal Walk, Century City',       'Cape Town',     -33.8942, 18.5123, 10),
  ('Kauai Green Point',      'cafe',       'Green Point, Cape Town',          'Cape Town',     -33.9117, 18.4133, 10),
  ('Bootlegger Coffee Woodstock', 'cafe',  'Albert Rd, Woodstock',           'Cape Town',     -33.9280, 18.4470, 10);

-- 2. Pair check-ins — two verified users check in together at a safe-spot
CREATE TYPE checkin_status AS ENUM ('pending', 'confirmed', 'expired', 'redeemed');

CREATE TABLE pair_checkins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  safe_spot_id  uuid NOT NULL REFERENCES safe_spots(id) ON DELETE CASCADE,
  initiator_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  partner_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  checkin_code  text NOT NULL DEFAULT substr(md5(random()::text), 1, 6),  -- 6-char code
  status        checkin_status NOT NULL DEFAULT 'pending',
  discount_pct  integer NOT NULL DEFAULT 10,
  created_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_at  timestamptz,
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '2 hours')
);

CREATE INDEX idx_pair_checkins_users ON pair_checkins(initiator_id, partner_id, status);

-- 3. Post-meetup reviews — triggered after GPS overlap > 1 hour
CREATE TYPE meetup_rating AS ENUM ('safe', 'respectful', 'unreliable');

CREATE TABLE post_meetup_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reviewed_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating        meetup_rating NOT NULL,
  comment       text DEFAULT '',
  pair_checkin_id uuid REFERENCES pair_checkins(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reviewer_id, reviewed_id, pair_checkin_id)
);

CREATE INDEX idx_reviews_reviewed ON post_meetup_reviews(reviewed_id, created_at DESC);

-- 4. Pending review prompts — tracks meetups that need reviews
CREATE TABLE pending_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  other_user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pair_checkin_id uuid REFERENCES pair_checkins(id) ON DELETE SET NULL,
  prompted_at    timestamptz NOT NULL DEFAULT now(),
  reviewed       boolean NOT NULL DEFAULT false,
  UNIQUE(user_id, other_user_id, pair_checkin_id)
);

-- 5. Data-light mode preference on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS data_light_mode boolean NOT NULL DEFAULT false;

-- 6. Re-verification tracking
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS reverify_required boolean NOT NULL DEFAULT false;

-- 7. Function: Confirm a pair check-in (partner confirms with code)
CREATE OR REPLACE FUNCTION confirm_pair_checkin(
  _checkin_id uuid,
  _confirmer  uuid,
  _code       text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _rec pair_checkins%ROWTYPE;
BEGIN
  SELECT * INTO _rec FROM pair_checkins WHERE id = _checkin_id;

  IF NOT FOUND THEN RETURN false; END IF;
  IF _rec.status != 'pending' THEN RETURN false; END IF;
  IF _rec.expires_at < now() THEN
    UPDATE pair_checkins SET status = 'expired' WHERE id = _checkin_id;
    RETURN false;
  END IF;
  IF _rec.partner_id != _confirmer THEN RETURN false; END IF;
  IF _rec.checkin_code != _code THEN RETURN false; END IF;

  UPDATE pair_checkins
    SET status = 'confirmed', confirmed_at = now()
    WHERE id = _checkin_id;

  -- Create pending reviews for both users
  INSERT INTO pending_reviews (user_id, other_user_id, pair_checkin_id)
    VALUES (_rec.initiator_id, _rec.partner_id, _checkin_id),
           (_rec.partner_id, _rec.initiator_id, _checkin_id)
    ON CONFLICT DO NOTHING;

  -- Award vibe points to both users for safe check-in
  PERFORM award_vibe_points(_rec.initiator_id, 5, 'checkin_complete');
  PERFORM award_vibe_points(_rec.partner_id, 5, 'checkin_complete');

  RETURN true;
END;
$$;

-- 8. Function: Submit a post-meetup review & update trust score
CREATE OR REPLACE FUNCTION submit_meetup_review(
  _reviewer   uuid,
  _reviewed   uuid,
  _rating     meetup_rating,
  _comment    text DEFAULT '',
  _checkin_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _delta integer;
BEGIN
  -- Map rating to trust-score delta
  _delta := CASE _rating
    WHEN 'safe'        THEN 3
    WHEN 'respectful'  THEN 2
    WHEN 'unreliable'  THEN -5
  END;

  INSERT INTO post_meetup_reviews (reviewer_id, reviewed_id, rating, comment, pair_checkin_id)
    VALUES (_reviewer, _reviewed, _rating, _comment, _checkin_id);

  -- Update reviewed user's trust score (clamp 0..100)
  UPDATE profiles
    SET trust_score = GREATEST(0, LEAST(100, trust_score + _delta))
    WHERE id = _reviewed;

  -- Mark pending review as done
  UPDATE pending_reviews
    SET reviewed = true
    WHERE user_id = _reviewer
      AND other_user_id = _reviewed
      AND (_checkin_id IS NULL OR pair_checkin_id = _checkin_id);

  -- Award reviewer points
  PERFORM award_vibe_points(_reviewer, 15, 'safe_date_review');
END;
$$;

-- 9. Auto re-verify trigger: if 3 trusted users report a profile
CREATE OR REPLACE FUNCTION check_reverify_on_report()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _trusted_count integer;
BEGIN
  -- Count reports from users with trust_score >= 60
  SELECT count(*) INTO _trusted_count
  FROM user_reports ur
  JOIN profiles p ON p.id = ur.reporter_id
  WHERE ur.reported_id = NEW.reported_id
    AND p.trust_score >= 60;

  IF _trusted_count >= 3 THEN
    UPDATE profiles
      SET reverify_required = true,
          is_verified = false
      WHERE id = NEW.reported_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reverify_on_report
  AFTER INSERT ON user_reports
  FOR EACH ROW
  EXECUTE FUNCTION check_reverify_on_report();
