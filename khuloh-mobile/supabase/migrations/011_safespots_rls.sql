-- ============================================================
-- 011: RLS for Safe-Spots, Pair Check-ins, Reviews, Pending Reviews
-- ============================================================

-- ── safe_spots ──
ALTER TABLE safe_spots ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view active safe spots
CREATE POLICY "Authenticated users read safe spots"
  ON safe_spots FOR SELECT
  USING (auth.role() = 'authenticated' AND is_active = true);

-- ── pair_checkins ──
ALTER TABLE pair_checkins ENABLE ROW LEVEL SECURITY;

-- Users can read their own check-ins (initiator or partner)
CREATE POLICY "Users read own checkins"
  ON pair_checkins FOR SELECT
  USING (auth.uid() = initiator_id OR auth.uid() = partner_id);

-- Any verified user can initiate a check-in
CREATE POLICY "Verified users insert checkins"
  ON pair_checkins FOR INSERT
  WITH CHECK (
    auth.uid() = initiator_id
    AND EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND is_verified = true
    )
  );

-- ── post_meetup_reviews ──
ALTER TABLE post_meetup_reviews ENABLE ROW LEVEL SECURITY;

-- Users can read reviews about them or by them
CREATE POLICY "Users read own reviews"
  ON post_meetup_reviews FOR SELECT
  USING (auth.uid() = reviewer_id OR auth.uid() = reviewed_id);

-- Reviews inserted via submit_meetup_review() SECURITY DEFINER, no direct insert.

-- ── pending_reviews ──
ALTER TABLE pending_reviews ENABLE ROW LEVEL SECURITY;

-- Users can read their own pending reviews
CREATE POLICY "Users read own pending reviews"
  ON pending_reviews FOR SELECT
  USING (auth.uid() = user_id);
