-- ============================================================
-- Khuloh: Vibe Toggle + Self-Destructing Whispers
-- ============================================================

-- 1. Create vibe enum type
CREATE TYPE public.vibe AS ENUM ('chat', 'connect', 'ignite');

-- 2. Add vibe column to profiles (default: 'chat')
ALTER TABLE public.profiles
  ADD COLUMN vibe public.vibe NOT NULL DEFAULT 'chat';

-- 3. Add self-destruct timestamp to whispers
--    Populated automatically when either user is in 'ignite' mode
ALTER TABLE public.whispers
  ADD COLUMN expires_at timestamptz;

-- 4. Index for efficient cleanup of expired whispers
CREATE INDEX idx_whispers_expires ON public.whispers (expires_at)
  WHERE expires_at IS NOT NULL;

-- 5. Auto-set expires_at when sender or receiver is in 'ignite' mode
CREATE OR REPLACE FUNCTION public.set_whisper_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_vibe  public.vibe;
  receiver_vibe public.vibe;
BEGIN
  SELECT vibe INTO sender_vibe  FROM public.profiles WHERE id = NEW.sender_id;
  SELECT vibe INTO receiver_vibe FROM public.profiles WHERE id = NEW.receiver_id;

  IF sender_vibe = 'ignite' OR receiver_vibe = 'ignite' THEN
    NEW.expires_at = NEW.created_at + INTERVAL '24 hours';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER whispers_set_expiry
  BEFORE INSERT ON public.whispers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_whisper_expiry();

-- 6. Cleanup function: delete expired whispers (call via pg_cron or edge function)
CREATE OR REPLACE FUNCTION public.cleanup_expired_whispers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.whispers
  WHERE expires_at IS NOT NULL AND expires_at < now();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- 7. Update the guard function to allow vibe changes
CREATE OR REPLACE FUNCTION public.update_own_profile(
  _username text DEFAULT NULL,
  _bio      text DEFAULT NULL,
  _avatar   text DEFAULT NULL,
  _vibe     text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.profiles;
BEGIN
  UPDATE public.profiles
  SET
    username   = COALESCE(_username, username),
    bio        = COALESCE(_bio, bio),
    avatar_url = COALESCE(_avatar, avatar_url),
    vibe       = COALESCE(_vibe::public.vibe, vibe)
  WHERE id = auth.uid()
  RETURNING * INTO result;

  RETURN result;
END;
$$;
