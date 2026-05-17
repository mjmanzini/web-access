-- ============================================================
-- Khuloh: RLS policies for Zones tables
-- ============================================================

-- ── rooms ─────────────────────────────────────────────────
-- All verified users can view rooms
CREATE POLICY "Verified users can view rooms"
  ON public.rooms
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_verified = true
    )
  );

-- No INSERT/UPDATE/DELETE from clients – rooms are admin-seeded

-- ── room_members ──────────────────────────────────────────
-- Verified users can see who is in a room
CREATE POLICY "Verified users can view room members"
  ON public.room_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_verified = true
    )
  );

-- Users can join a room (insert their own row)
CREATE POLICY "Users can join rooms"
  ON public.room_members
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_verified = true
    )
  );

-- Users can leave a room (delete their own row)
CREATE POLICY "Users can leave rooms"
  ON public.room_members
  FOR DELETE
  USING (user_id = auth.uid());

-- ── zone_messages ─────────────────────────────────────────
-- Members of a room can read its messages
CREATE POLICY "Room members can read messages"
  ON public.zone_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.room_members
      WHERE room_id = zone_messages.room_id
        AND user_id = auth.uid()
    )
  );

-- Members of a room can send messages
CREATE POLICY "Room members can send messages"
  ON public.zone_messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.room_members
      WHERE room_id = zone_messages.room_id
        AND user_id = auth.uid()
    )
  );

-- ── whispers ──────────────────────────────────────────────
-- Users can read whispers they sent or received
CREATE POLICY "Users can read own whispers"
  ON public.whispers
  FOR SELECT
  USING (
    sender_id = auth.uid() OR receiver_id = auth.uid()
  );

-- Users can send whispers (must be verified)
CREATE POLICY "Verified users can send whispers"
  ON public.whispers
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_verified = true
    )
  );
