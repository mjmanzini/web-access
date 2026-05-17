-- Migration 013: RLS policies for economy enhancements, trust badges, daily logins

-- ── Trust badges RLS ──
alter table trust_badges enable row level security;

create policy "Users can view own badges"
  on trust_badges for select
  using (auth.uid() = user_id);

create policy "Service role can insert badges"
  on trust_badges for insert
  with check (true);

-- ── Daily logins RLS ──
alter table daily_logins enable row level security;

create policy "Users can view own logins"
  on daily_logins for select
  using (auth.uid() = user_id);

create policy "System can insert logins"
  on daily_logins for insert
  with check (auth.uid() = user_id);

-- ── Ghost mode: hide profile from discovery when active ──
-- Update the existing profiles select policy to respect ghost mode
-- Users in ghost mode are hidden from other users' queries (except their own profile)
create or replace function is_visible_profile(_profile_id uuid)
returns boolean language plpgsql security definer as $$
begin
  -- Always visible to self
  if auth.uid() = _profile_id then return true; end if;

  -- Hidden if ghost mode is active
  return not exists(
    select 1 from profiles
    where id = _profile_id
    and ghost_mode_until is not null
    and ghost_mode_until > now()
  );
end;
$$;

-- ── Grant execute on new functions ──
grant execute on function claim_daily_login(uuid) to authenticated;
grant execute on function activate_ghost_mode(uuid) to authenticated;
grant execute on function is_ghost_active(uuid) to authenticated;
grant execute on function is_visible_profile(uuid) to authenticated;
grant execute on function award_vibe_points(uuid, text, int) to authenticated;

-- ── Enable realtime on new tables ──
alter publication supabase_realtime add table trust_badges;
