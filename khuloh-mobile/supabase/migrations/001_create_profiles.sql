-- ============================================================
-- Khuloh: Profiles table + auto-creation trigger
-- ============================================================

CREATE TABLE public.profiles (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone       text        NOT NULL UNIQUE,
  username    text        UNIQUE,
  bio         text        DEFAULT '',
  trust_score integer     DEFAULT 0 CHECK (trust_score >= 0),
  is_verified boolean     DEFAULT false,
  avatar_url  text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Enable RLS (policies defined in 002)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Index for discovery queries (verified profiles)
CREATE INDEX idx_profiles_verified ON public.profiles (is_verified) WHERE is_verified = true;

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Auto-create a profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, phone)
  VALUES (NEW.id, NEW.phone);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
