-- ============================================================
-- 009: RLS for Vibe Economy tables
-- ============================================================

-- ── point_transactions ──
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;

-- Users can read their own transactions
CREATE POLICY "Users read own transactions"
  ON point_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- Only server (SECURITY DEFINER functions) inserts; no direct insert policy needed.

-- ── shouts ──
ALTER TABLE shouts ENABLE ROW LEVEL SECURITY;

-- Everyone in the room can read shouts
CREATE POLICY "Authenticated users read shouts"
  ON shouts FOR SELECT
  USING (auth.role() = 'authenticated');

-- Shouts are inserted via send_shout() SECURITY DEFINER, no direct insert policy.

-- ── zone_guardians ──
ALTER TABLE zone_guardians ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can see who the guardians are
CREATE POLICY "Authenticated users read guardians"
  ON zone_guardians FOR SELECT
  USING (auth.role() = 'authenticated');

-- ── mutes ──
ALTER TABLE mutes ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read mutes (to know if they are muted)
CREATE POLICY "Authenticated users read mutes"
  ON mutes FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only guardians can insert mutes (checked via subquery)
CREATE POLICY "Guardians insert mutes"
  ON mutes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM zone_guardians zg
      WHERE zg.room_id = mutes.room_id
        AND zg.user_id = auth.uid()
    )
    AND muted_by = auth.uid()
  );
