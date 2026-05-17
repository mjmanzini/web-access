-- ============================================================
-- Khuloh: RLS policies for Scam-Shield tables
-- ============================================================

-- ── message_flags ─────────────────────────────────────────
-- No client read/write – managed by edge functions & triggers only

-- ── user_reports ──────────────────────────────────────────
-- Verified users can submit a report
CREATE POLICY "Verified users can report"
  ON public.user_reports
  FOR INSERT
  WITH CHECK (
    reporter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_verified = true
    )
  );

-- Users can view their own submitted reports
CREATE POLICY "Users can view own reports"
  ON public.user_reports
  FOR SELECT
  USING (reporter_id = auth.uid());

-- ── emergency_contacts ────────────────────────────────────
-- Users can manage their own emergency contacts
CREATE POLICY "Users can view own emergency contacts"
  ON public.emergency_contacts
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can add emergency contacts"
  ON public.emergency_contacts
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own emergency contacts"
  ON public.emergency_contacts
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own emergency contacts"
  ON public.emergency_contacts
  FOR DELETE
  USING (user_id = auth.uid());

-- ── safety_checkins ───────────────────────────────────────
-- Users can view their own check-ins
CREATE POLICY "Users can view own checkins"
  ON public.safety_checkins
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can create check-ins for themselves
CREATE POLICY "Users can create checkins"
  ON public.safety_checkins
  FOR INSERT
  WITH CHECK (user_id = auth.uid());
