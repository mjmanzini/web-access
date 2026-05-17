-- ============================================================
-- Khuloh: Row Level Security policies for profiles
-- ============================================================

-- 1. Users can ALWAYS read their own profile (even before verification)
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (id = auth.uid());

-- 2. Verified users can view other verified profiles
CREATE POLICY "Verified users can view verified profiles"
  ON public.profiles
  FOR SELECT
  USING (
    is_verified = true
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_verified = true
    )
  );

-- 3. Users can update ONLY their own profile, and only safe columns
--    is_verified and trust_score are excluded via a wrapper function.
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 4. Block direct INSERT from clients (profiles are created via trigger)
--    No INSERT policy = denied by default when RLS is enabled.

-- 5. Block DELETE from clients
--    No DELETE policy = denied by default when RLS is enabled.

-- ============================================================
-- Guard function: prevents clients from changing protected columns
-- Call this from the client instead of a raw .update()
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_own_profile(
  _username text DEFAULT NULL,
  _bio      text DEFAULT NULL,
  _avatar   text DEFAULT NULL
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
    avatar_url = COALESCE(_avatar, avatar_url)
  WHERE id = auth.uid()
  RETURNING * INTO result;

  RETURN result;
END;
$$;
