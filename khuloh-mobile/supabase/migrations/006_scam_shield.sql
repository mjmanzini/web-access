-- ============================================================
-- Khuloh: Scam-Shield – flags, shadow-bans, reports,
--         emergency contacts, safety check-ins
-- ============================================================

-- 1. Shadow-ban flag on profiles
ALTER TABLE public.profiles
  ADD COLUMN is_shadow_banned boolean NOT NULL DEFAULT false;

-- 2. AI / system flags on messages
CREATE TABLE public.message_flags (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type  text        NOT NULL CHECK (message_type IN ('zone', 'whisper')),
  message_id    uuid        NOT NULL,
  flagged_user  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason        text        NOT NULL,               -- matched pattern / description
  pattern       text,                                -- the regex that matched (if AI)
  source        text        NOT NULL DEFAULT 'ai'    -- 'ai' or 'user_report'
                            CHECK (source IN ('ai', 'user_report')),
  reporter_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.message_flags ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_message_flags_user ON public.message_flags (flagged_user);

-- 3. User reports (verified users reporting other users)
CREATE TABLE public.user_reports (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason        text        NOT NULL CHECK (char_length(reason) <= 500),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (reporter_id, reported_id)               -- one report per pair
);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_user_reports_reported ON public.user_reports (reported_id);

-- 4. Auto shadow-ban: triggered when flag count >= 3 OR distinct reporter count >= 2
CREATE OR REPLACE FUNCTION public.check_shadow_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ai_flag_count  integer;
  report_count   integer;
  target_user    uuid;
BEGIN
  -- Determine который user to check depending on which table triggered
  IF TG_TABLE_NAME = 'message_flags' THEN
    target_user := NEW.flagged_user;
  ELSIF TG_TABLE_NAME = 'user_reports' THEN
    target_user := NEW.reported_id;
  ELSE
    RETURN NEW;
  END IF;

  -- Count AI flags
  SELECT COUNT(*) INTO ai_flag_count
  FROM public.message_flags
  WHERE flagged_user = target_user AND source = 'ai';

  -- Count distinct verified reporters
  SELECT COUNT(DISTINCT ur.reporter_id) INTO report_count
  FROM public.user_reports ur
  JOIN public.profiles p ON p.id = ur.reporter_id AND p.is_verified = true
  WHERE ur.reported_id = target_user;

  -- Shadow-ban if thresholds exceeded
  IF ai_flag_count >= 3 OR report_count >= 2 THEN
    UPDATE public.profiles
    SET is_shadow_banned = true
    WHERE id = target_user AND is_shadow_banned = false;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER check_shadow_ban_on_flag
  AFTER INSERT ON public.message_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.check_shadow_ban();

CREATE TRIGGER check_shadow_ban_on_report
  AFTER INSERT ON public.user_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.check_shadow_ban();

-- 5. Emergency contacts
CREATE TABLE public.emergency_contacts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (char_length(name) <= 100),
  phone       text        NOT NULL CHECK (char_length(phone) <= 20),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, phone)
);

ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_emergency_contacts_user ON public.emergency_contacts (user_id);

-- 6. Safety check-ins (panic button system)
CREATE TABLE public.safety_checkins (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  met_user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude          double precision,
  longitude         double precision,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'safe', 'alerted', 'expired')),
  check_at          timestamptz NOT NULL,             -- when to ask "are you safe?"
  responded_at      timestamptz,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE public.safety_checkins ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_safety_checkins_pending ON public.safety_checkins (status, check_at)
  WHERE status = 'pending';

-- 7. Function to mark checkin as safe
CREATE OR REPLACE FUNCTION public.respond_safe(checkin_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.safety_checkins
  SET status = 'safe', responded_at = now()
  WHERE id = checkin_id
    AND user_id = auth.uid()
    AND status = 'pending';
END;
$$;

-- 8. Function to alert emergency contacts (called by edge function / cron)
--    Returns check-ins that need alerting
CREATE OR REPLACE FUNCTION public.get_overdue_checkins()
RETURNS TABLE (
  checkin_id   uuid,
  user_id      uuid,
  met_user_id  uuid,
  latitude     double precision,
  longitude    double precision,
  contact_name text,
  contact_phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id AS checkin_id,
    sc.user_id,
    sc.met_user_id,
    sc.latitude,
    sc.longitude,
    ec.name AS contact_name,
    ec.phone AS contact_phone
  FROM public.safety_checkins sc
  JOIN public.emergency_contacts ec ON ec.user_id = sc.user_id
  WHERE sc.status = 'pending'
    AND sc.check_at < now();
END;
$$;

-- 9. Mark alerted check-ins
CREATE OR REPLACE FUNCTION public.mark_checkins_alerted(checkin_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.safety_checkins
  SET status = 'alerted'
  WHERE id = ANY(checkin_ids)
    AND status = 'pending';
END;
$$;
