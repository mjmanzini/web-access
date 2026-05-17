-- Migration 012: Enhanced Vibe Economy + Ghost Mode + Trust Badges
-- Daily Login +10, Verified Meetup +50, City Shout -20, Ghost Mode -100

-- ── Add new point reasons to the economy ──

-- Add ghost_mode_until timestamp to profiles
alter table profiles
  add column if not exists ghost_mode_until timestamptz default null;

-- ── Trust badges table for QR partner verification ──
create table if not exists trust_badges (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  partner_spot_id uuid references safe_spots(id) on delete cascade not null,
  qr_token text not null,
  discount_pct int not null default 0,
  points_awarded int not null default 0,
  verified_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Index for fast lookup
create index if not exists idx_trust_badges_user on trust_badges(user_id);
create index if not exists idx_trust_badges_qr on trust_badges(qr_token);

-- ── Daily login tracking table ──
create table if not exists daily_logins (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  login_date date not null default current_date,
  points_awarded int not null default 10,
  created_at timestamptz default now(),
  unique(user_id, login_date)
);

create index if not exists idx_daily_logins_user_date on daily_logins(user_id, login_date);

-- ── Function: award daily login points (idempotent) ──
create or replace function claim_daily_login(_user_id uuid)
returns json language plpgsql security definer as $$
declare
  _already_claimed boolean;
  _new_balance int;
  _points int := 10;
begin
  -- Check if already claimed today
  select exists(
    select 1 from daily_logins
    where user_id = _user_id and login_date = current_date
  ) into _already_claimed;

  if _already_claimed then
    select vibe_points into _new_balance from profiles where id = _user_id;
    return json_build_object('claimed', false, 'balance', _new_balance, 'message', 'Already claimed today');
  end if;

  -- Record login
  insert into daily_logins (user_id, login_date, points_awarded)
  values (_user_id, current_date, _points);

  -- Award points
  update profiles set vibe_points = vibe_points + _points where id = _user_id
  returning vibe_points into _new_balance;

  -- Record transaction
  insert into point_transactions (user_id, amount, reason)
  values (_user_id, _points, 'daily_login');

  return json_build_object('claimed', true, 'balance', _new_balance, 'awarded', _points);
end;
$$;

-- ── Function: activate ghost mode (-100 points, 30 min) ──
create or replace function activate_ghost_mode(_user_id uuid)
returns json language plpgsql security definer as $$
declare
  _balance int;
  _cost int := 100;
  _duration interval := '30 minutes';
  _until timestamptz;
begin
  select vibe_points into _balance from profiles where id = _user_id;

  if _balance < _cost then
    return json_build_object('success', false, 'error', 'Insufficient vibe points', 'balance', _balance, 'cost', _cost);
  end if;

  _until := now() + _duration;

  -- Deduct points and set ghost mode
  update profiles
  set vibe_points = vibe_points - _cost,
      ghost_mode_until = _until
  where id = _user_id;

  -- Record transaction
  insert into point_transactions (user_id, amount, reason)
  values (_user_id, -_cost, 'ghost_mode');

  return json_build_object('success', true, 'ghost_until', _until, 'balance', _balance - _cost);
end;
$$;

-- ── Function: check if user is in ghost mode ──
create or replace function is_ghost_active(_user_id uuid)
returns boolean language plpgsql security definer as $$
begin
  return exists(
    select 1 from profiles
    where id = _user_id
    and ghost_mode_until is not null
    and ghost_mode_until > now()
  );
end;
$$;

-- ── Update award_vibe_points to support new reasons ──
-- The existing function uses an enum-like check; we extend the point amounts
create or replace function award_vibe_points(_user_id uuid, _reason text, _amount int default null)
returns json language plpgsql security definer as $$
declare
  _pts int;
  _new_balance int;
begin
  -- Determine points amount based on reason (if not explicitly provided)
  if _amount is not null then
    _pts := _amount;
  else
    _pts := case _reason
      when 'bio_complete' then 20
      when 'safe_date_review' then 15
      when 'scammer_reported' then 10
      when 'shout_spent' then -5
      when 'guardian_bonus' then 10
      when 'checkin_complete' then 5
      when 'daily_login' then 10
      when 'verified_meetup' then 50
      when 'city_shout' then -20
      when 'ghost_mode' then -100
      else 0
    end;
  end if;

  -- Check sufficient balance for spends
  if _pts < 0 then
    select vibe_points into _new_balance from profiles where id = _user_id;
    if _new_balance + _pts < 0 then
      return json_build_object('success', false, 'error', 'Insufficient balance');
    end if;
  end if;

  -- Prevent duplicate earn for same reason in same hour (except daily_login handled separately)
  if _pts > 0 and _reason not in ('daily_login', 'verified_meetup') then
    if exists(
      select 1 from point_transactions
      where user_id = _user_id and reason = _reason
      and created_at > now() - interval '1 hour'
    ) then
      select vibe_points into _new_balance from profiles where id = _user_id;
      return json_build_object('success', false, 'error', 'Already earned recently', 'balance', _new_balance);
    end if;
  end if;

  -- Award/deduct
  update profiles set vibe_points = vibe_points + _pts where id = _user_id
  returning vibe_points into _new_balance;

  insert into point_transactions (user_id, amount, reason)
  values (_user_id, _pts, _reason);

  return json_build_object('success', true, 'balance', _new_balance, 'awarded', _pts);
end;
$$;
