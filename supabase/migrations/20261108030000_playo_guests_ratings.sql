-- KICKOFF migration: Playo bridge, friends' names, guest players, ratings
--
-- What it adds:
--   1. "source" on payment requests and participants (kickoff / playo /
--      whatsapp / friend), so you can see where players come from.
--   2. game_guests: one row per extra person in a game who has no KICKOFF
--      account:
--        - kind 'friend': a friend booked by a player (named at payment)
--        - kind 'manual': a player the host added by hand (e.g. from Playo)
--   3. player_ratings: players rate others from the same game (1-5).
--      Ratings are private; only averages are used.
--   4. Team balancing now:
--        - balances every person separately (friends get their own team)
--        - includes host-added guests
--        - blends each player's chosen level with their recent ratings
--
-- Functions replaced (same behaviour plus the additions above):
--   submit_game_payment, join_game_with_level, review_game_payment,
--   balance_game_teams
-- New functions:
--   kickoff_occupied_slots, host_add_guest, host_remove_guest,
--   submit_player_ratings, games_to_rate, my_rating
--
-- What it does NOT change: existing games, payments, participants,
-- cancel_game, or any existing permission rule.

begin;

-- 1. Source columns ---------------------------------------------------------
alter table public.game_payment_requests
  add column if not exists source text not null default 'kickoff',
  add column if not exists guest_names jsonb not null default '[]'::jsonb;

alter table public.game_participants
  add column if not exists source text not null default 'kickoff';

alter table public.game_payment_requests
  drop constraint if exists game_payment_requests_source_check,
  add constraint game_payment_requests_source_check
    check (source in ('kickoff', 'playo', 'whatsapp', 'friend'));

alter table public.game_participants
  drop constraint if exists game_participants_source_check,
  add constraint game_participants_source_check
    check (source in ('kickoff', 'playo', 'whatsapp', 'friend'));

-- 2. Guests -----------------------------------------------------------------
create table if not exists public.game_guests (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  kind         text not null check (kind in ('friend', 'manual')),
  brought_by   uuid references public.profiles(id) on delete cascade,
  added_by     uuid references auth.users(id) on delete set null,
  full_name    text not null check (char_length(trim(full_name)) between 2 and 60),
  skill_level  text not null default 'Intermediate'
               check (skill_level in ('Beginner', 'Intermediate', 'Amateur', 'Professional')),
  source       text not null default 'kickoff'
               check (source in ('kickoff', 'playo', 'whatsapp', 'friend')),
  team_color   text check (team_color in ('BLACK', 'WHITE')),
  created_at   timestamptz not null default now()
);

create index if not exists game_guests_game_id_idx on public.game_guests (game_id);

alter table public.game_guests enable row level security;

revoke all on public.game_guests from anon;

drop policy if exists "View guests in visible games" on public.game_guests;

create policy "View guests in visible games"
on public.game_guests
for select
to authenticated
using (
  brought_by = (select auth.uid())
  or exists (
    select 1
    from public.games g
    where g.id = game_guests.game_id
      and (g.status = 'open' or g.organiser_id = (select auth.uid()))
  )
);
-- No insert/update/delete rules: guests are only written by the functions below.

-- 3. Ratings ----------------------------------------------------------------
create table if not exists public.player_ratings (
  game_id    uuid not null references public.games(id) on delete cascade,
  rater_id   uuid not null references public.profiles(id) on delete cascade,
  ratee_id   uuid not null references public.profiles(id) on delete cascade,
  score      smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (game_id, rater_id, ratee_id),
  check (rater_id <> ratee_id)
);

create index if not exists player_ratings_ratee_idx
  on public.player_ratings (ratee_id, created_at desc);

alter table public.player_ratings enable row level security;

revoke all on public.player_ratings from anon;
-- No rules at all: ratings are private and only read through functions.

-- 4. Occupied slots helper --------------------------------------------------
-- Joined participants (incl. their friends) + host-added guests.
create or replace function public.kickoff_occupied_slots(p_game_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select (
    coalesce((
      select sum(gp.slots_count)
      from public.game_participants gp
      where gp.game_id = p_game_id
        and gp.status = 'joined'
    ), 0)
    +
    (
      select count(*)
      from public.game_guests gg
      where gg.game_id = p_game_id
        and gg.kind = 'manual'
    )
  )::integer;
$function$;

-- 5. Payment submission: + friends' names + source ---------------------------
drop function if exists public.submit_game_payment(uuid, text, integer, text);

create or replace function public.submit_game_payment(
  p_game_id uuid,
  p_upi_reference text,
  p_slots_count integer,
  p_skill_level text,
  p_guest_names jsonb default '[]'::jsonb,
  p_source text default 'kickoff'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_game public.games%rowtype;
  v_request_id uuid;
  v_occupied integer := 0;
  v_pending integer := 0;
  v_reference text := trim(coalesce(p_upi_reference, ''));
  v_source text := coalesce(nullif(trim(p_source), ''), 'kickoff');
  v_guests jsonb := '[]'::jsonb;
  v_item jsonb;
  v_name text;
  v_level text;
begin
  if v_user_id is null then
    raise exception 'You must be logged in.';
  end if;

  if v_reference !~ '^[0-9]{12}$' then
    raise exception 'Enter the 12-digit UTR (UPI Ref No.) from your UPI app.';
  end if;

  if exists (
    select 1
    from public.game_payment_requests r
    where r.upi_reference = v_reference
      and upper(r.status) <> 'REJECTED'
  ) then
    raise exception 'This UTR has already been used for another payment request.';
  end if;

  if p_slots_count is null
     or p_slots_count < 1
     or p_slots_count > 50
  then
    raise exception 'Choose between 1 and 50 slots.';
  end if;

  if p_skill_level is null
     or p_skill_level not in ('Beginner', 'Intermediate', 'Amateur', 'Professional')
  then
    raise exception 'Choose a valid playing level for this match.';
  end if;

  if v_source not in ('kickoff', 'playo', 'whatsapp', 'friend') then
    v_source := 'kickoff';
  end if;

  -- Friends' names: one per extra slot.
  if p_guest_names is null or jsonb_typeof(p_guest_names) <> 'array' then
    raise exception 'Friend names are missing.';
  end if;

  if jsonb_array_length(p_guest_names) <> p_slots_count - 1 then
    raise exception 'Enter a name for each friend (% needed).', p_slots_count - 1;
  end if;

  for v_item in select * from jsonb_array_elements(p_guest_names)
  loop
    v_name := trim(coalesce(v_item ->> 'name', ''));
    v_level := coalesce(nullif(v_item ->> 'level', ''), 'Intermediate');

    if char_length(v_name) < 2 or char_length(v_name) > 60 then
      raise exception 'Each friend name must be 2-60 characters.';
    end if;

    if v_level not in ('Beginner', 'Intermediate', 'Amateur', 'Professional') then
      raise exception 'Choose a valid level for each friend.';
    end if;

    v_guests := v_guests || jsonb_build_array(
      jsonb_build_object('name', v_name, 'level', v_level)
    );
  end loop;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and length(trim(p.full_name)) between 2 and 60
      and p.skill_level in ('Beginner', 'Intermediate', 'Amateur', 'Professional')
      and p.primary_position in (
        'Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Flexible / Any'
      )
  ) then
    raise exception 'Complete your KICKOFF player card before requesting a slot.';
  end if;

  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if not found then
    raise exception 'Game not found.';
  end if;

  if v_game.status <> 'open'
     or v_game.cancelled_at is not null
     or v_game.starts_at <= now()
     or coalesce(v_game.ends_at, v_game.starts_at) <= now()
  then
    raise exception 'This game is not open for joining.';
  end if;

  if v_game.organiser_id = v_user_id then
    raise exception 'The host cannot buy slots in their own game.';
  end if;

  if coalesce(v_game.price_per_player_paise, 0) <= 0 then
    raise exception 'This game does not require payment.';
  end if;

  if v_game.host_upi_id is null or trim(v_game.host_upi_id) = '' then
    raise exception 'The host has not configured a UPI ID.';
  end if;

  if exists (
    select 1
    from public.game_participants gp
    where gp.game_id = p_game_id
      and gp.player_id = v_user_id
      and gp.status = 'joined'
  ) then
    raise exception 'You have already joined this game.';
  end if;

  if exists (
    select 1
    from public.game_payment_requests r
    where r.game_id = p_game_id
      and r.player_id = v_user_id
      and upper(r.status) = 'PENDING'
  ) then
    raise exception 'You already have a pending payment request.';
  end if;

  v_occupied := public.kickoff_occupied_slots(p_game_id);

  select coalesce(sum(r.slots_count), 0)::integer
  into v_pending
  from public.game_payment_requests r
  where r.game_id = p_game_id
    and upper(r.status) = 'PENDING';

  if v_game.max_players is not null
     and v_occupied + v_pending + p_slots_count > v_game.max_players
  then
    raise exception 'Only % slot(s) left for this game.',
      greatest(v_game.max_players - v_occupied - v_pending, 0);
  end if;

  insert into public.game_payment_requests (
    game_id, player_id, amount_paise, slots_count,
    match_skill_level, upi_reference, status, source, guest_names
  )
  values (
    p_game_id, v_user_id,
    v_game.price_per_player_paise * p_slots_count,
    p_slots_count, p_skill_level, v_reference, 'PENDING',
    v_source, v_guests
  )
  returning id into v_request_id;

  return v_request_id;
end;
$function$;

-- 6. Free-game join: + source + host guests count towards capacity --------
drop function if exists public.join_game_with_level(uuid, text);

create or replace function public.join_game_with_level(
  p_game_id uuid,
  p_skill_level text,
  p_source text default 'kickoff'
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_game public.games%rowtype;
  v_occupied integer := 0;
  v_pending integer := 0;
  v_source text := coalesce(nullif(trim(p_source), ''), 'kickoff');
begin
  if v_user_id is null then
    raise exception 'Sign in before joining a game.';
  end if;

  if p_skill_level is null
     or p_skill_level not in ('Beginner', 'Intermediate', 'Amateur', 'Professional')
  then
    raise exception 'Choose a valid playing level for this match.';
  end if;

  if v_source not in ('kickoff', 'playo', 'whatsapp', 'friend') then
    v_source := 'kickoff';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and length(trim(p.full_name)) between 2 and 60
      and p.skill_level in ('Beginner', 'Intermediate', 'Amateur', 'Professional')
      and p.primary_position in (
        'Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Flexible / Any'
      )
  ) then
    raise exception 'Complete your KICKOFF player card before joining a game.';
  end if;

  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if not found then
    raise exception 'Game not found.';
  end if;

  if v_game.status <> 'open'
     or v_game.cancelled_at is not null
     or v_game.starts_at <= now()
     or coalesce(v_game.ends_at, v_game.starts_at) <= now()
  then
    raise exception 'This game is no longer accepting players.';
  end if;

  if v_game.organiser_id = v_user_id then
    raise exception 'You are already the organiser of this game.';
  end if;

  if coalesce(v_game.price_per_player_paise, 0) > 0 then
    raise exception 'This game requires payment. Submit a payment request instead.';
  end if;

  if exists (
    select 1
    from public.game_participants gp
    where gp.game_id = p_game_id
      and gp.player_id = v_user_id
      and gp.status = 'joined'
  ) then
    raise exception 'You have already joined this game.';
  end if;

  v_occupied := public.kickoff_occupied_slots(p_game_id);

  select coalesce(sum(r.slots_count), 0)::integer
  into v_pending
  from public.game_payment_requests r
  where r.game_id = p_game_id
    and upper(r.status) = 'PENDING';

  if v_game.max_players is not null
     and v_occupied + v_pending + 1 > v_game.max_players
  then
    raise exception 'This game is full.';
  end if;

  update public.game_participants
  set status = 'joined',
      slots_count = 1,
      match_skill_level = p_skill_level,
      team_color = null,
      source = v_source
  where game_id = p_game_id
    and player_id = v_user_id;

  if not found then
    insert into public.game_participants (
      game_id, player_id, status, slots_count,
      match_skill_level, team_color, source
    )
    values (
      p_game_id, v_user_id, 'joined', 1,
      p_skill_level, null, v_source
    );
  end if;

  return true;
end;
$function$;

-- 7. Payment review: + create friend guests on approval -------------------
create or replace function public.review_game_payment(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request public.game_payment_requests%rowtype;
  v_game public.games%rowtype;
  v_occupied integer := 0;
  v_own integer := 0;
  v_player_name text;
  v_index integer;
  v_names jsonb;
begin
  if v_user_id is null then
    raise exception 'You must be logged in.';
  end if;

  select * into v_request
  from public.game_payment_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Payment request not found.';
  end if;

  select * into v_game
  from public.games
  where id = v_request.game_id
  for update;

  if not found or v_game.organiser_id is distinct from v_user_id then
    raise exception 'Only the game host can review this payment request.';
  end if;

  if upper(v_request.status) <> 'PENDING' then
    raise exception 'This payment request has already been reviewed.';
  end if;

  if p_approve then
    if v_game.status <> 'open'
       or v_game.cancelled_at is not null
       or v_game.starts_at <= now()
       or coalesce(v_game.ends_at, v_game.starts_at) <= now()
    then
      raise exception 'This game is no longer accepting players.';
    end if;

    -- Slots already taken, not counting this player's own existing entry.
    select coalesce(sum(gp.slots_count), 0)::integer
    into v_own
    from public.game_participants gp
    where gp.game_id = v_game.id
      and gp.player_id = v_request.player_id
      and gp.status = 'joined';

    v_occupied := public.kickoff_occupied_slots(v_game.id) - v_own;

    if v_game.max_players is not null
       and v_occupied + v_request.slots_count > v_game.max_players
    then
      raise exception 'Not enough slots remain to approve this request.';
    end if;

    update public.game_payment_requests
    set status = 'APPROVED',
        reviewed_by = v_user_id,
        reviewed_at = now(),
        review_note = p_note
    where id = p_request_id;

    -- Replace this player's friend list for the game.
    delete from public.game_guests
    where game_id = v_request.game_id
      and kind = 'friend'
      and brought_by = v_request.player_id;

    update public.game_participants
    set status = 'joined',
        slots_count = v_request.slots_count,
        match_skill_level = v_request.match_skill_level,
        team_color = null,
        source = v_request.source
    where game_id = v_request.game_id
      and player_id = v_request.player_id;

    if not found then
      insert into public.game_participants (
        game_id, player_id, status, slots_count,
        match_skill_level, team_color, source
      )
      values (
        v_request.game_id, v_request.player_id, 'joined',
        v_request.slots_count, v_request.match_skill_level,
        null, v_request.source
      );
    end if;

    -- One guest row per friend slot (named, or "Name +n" for old requests).
    if v_request.slots_count > 1 then
      select coalesce(nullif(trim(p.full_name), ''), 'Player')
      into v_player_name
      from public.profiles p
      where p.id = v_request.player_id;

      v_names := coalesce(v_request.guest_names, '[]'::jsonb);

      for v_index in 1 .. v_request.slots_count - 1
      loop
        insert into public.game_guests (
          game_id, kind, brought_by, added_by,
          full_name, skill_level, source
        )
        values (
          v_request.game_id,
          'friend',
          v_request.player_id,
          v_user_id,
          coalesce(
            nullif(trim(v_names -> (v_index - 1) ->> 'name'), ''),
            left(coalesce(v_player_name, 'Player'), 50) || ' +' || v_index
          ),
          coalesce(
            nullif(v_names -> (v_index - 1) ->> 'level', ''),
            v_request.match_skill_level,
            'Intermediate'
          ),
          'friend'
        );
      end loop;
    end if;

    perform public.balance_game_teams(v_request.game_id);
  else
    update public.game_payment_requests
    set status = 'REJECTED',
        reviewed_by = v_user_id,
        reviewed_at = now(),
        review_note = p_note
    where id = p_request_id;
  end if;
end;
$function$;

-- 8. Host adds / removes a guest (e.g. a Playo player) ----------------------
create or replace function public.host_add_guest(
  p_game_id uuid,
  p_full_name text,
  p_skill_level text default 'Intermediate',
  p_source text default 'playo'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_game public.games%rowtype;
  v_pending integer := 0;
  v_name text := trim(coalesce(p_full_name, ''));
  v_level text := coalesce(nullif(p_skill_level, ''), 'Intermediate');
  v_source text := coalesce(nullif(trim(p_source), ''), 'playo');
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'You must be logged in.';
  end if;

  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if not found or v_game.organiser_id is distinct from v_user_id then
    raise exception 'Only the game host can add players.';
  end if;

  if v_game.cancelled_at is not null
     or coalesce(v_game.ends_at, v_game.starts_at) <= now()
  then
    raise exception 'This game has been cancelled or has ended.';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'Enter the player''s name (2-60 characters).';
  end if;

  if v_level not in ('Beginner', 'Intermediate', 'Amateur', 'Professional') then
    raise exception 'Choose a valid level.';
  end if;

  if v_source not in ('kickoff', 'playo', 'whatsapp', 'friend') then
    v_source := 'playo';
  end if;

  select coalesce(sum(r.slots_count), 0)::integer
  into v_pending
  from public.game_payment_requests r
  where r.game_id = p_game_id
    and upper(r.status) = 'PENDING';

  if v_game.max_players is not null
     and public.kickoff_occupied_slots(p_game_id) + v_pending + 1 > v_game.max_players
  then
    raise exception 'This game is full.';
  end if;

  insert into public.game_guests (
    game_id, kind, brought_by, added_by, full_name, skill_level, source
  )
  values (
    p_game_id, 'manual', null, v_user_id, v_name, v_level, v_source
  )
  returning id into v_id;

  perform public.balance_game_teams(p_game_id);

  return v_id;
end;
$function$;

create or replace function public.host_remove_guest(p_guest_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_game_id uuid;
begin
  if v_user_id is null then
    raise exception 'You must be logged in.';
  end if;

  select gg.game_id into v_game_id
  from public.game_guests gg
  join public.games g on g.id = gg.game_id
  where gg.id = p_guest_id
    and gg.kind = 'manual'
    and g.organiser_id = v_user_id;

  if v_game_id is null then
    raise exception 'Only the host can remove players they added.';
  end if;

  delete from public.game_guests where id = p_guest_id;

  perform public.balance_game_teams(v_game_id);

  return true;
end;
$function$;

-- 9. Team balancing: every person separately, ratings blended in ----------
create or replace function public.balance_game_teams(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_organiser_id uuid;
  v_unit record;
  v_team text;
  v_cap integer;
  v_black_score numeric := 0;
  v_white_score numeric := 0;
  v_black_slots integer := 0;
  v_white_slots integer := 0;
begin
  select g.organiser_id into v_organiser_id
  from public.games g
  where g.id = p_game_id;

  -- The game may be in the middle of being deleted.
  if not found then
    return;
  end if;

  if v_user_id is not null
     and v_user_id is distinct from v_organiser_id
     and not exists (
       select 1
       from public.game_participants gp
       where gp.game_id = p_game_id
         and gp.player_id = v_user_id
         and gp.status = 'joined'
     )
  then
    raise exception 'Only this game organiser or a joined player can balance teams.';
  end if;

  for v_unit in
    with units (unit_kind, unit_id, score, weight) as (
  select
        'player',
        gp.player_id,
        case
          when coalesce(r.n, 0) >= 3 then
            (1 - least(r.n, 10) / 10.0) * lvl.score
            + (least(r.n, 10) / 10.0) * (1 + (r.avg_score - 1) * 0.75)
          else lvl.score
        end,
        greatest(
          coalesce(gp.slots_count, 1) - coalesce(f.friends, 0),
          1
        )
      from public.game_participants gp
      left join public.profiles p on p.id = gp.player_id
      cross join lateral (
        select case coalesce(gp.match_skill_level, p.skill_level, 'Beginner')
          when 'Professional' then 4
          when 'Amateur' then 3
          when 'Intermediate' then 2
          else 1
        end::numeric as score
      ) lvl
      left join lateral (
        select avg(x.score)::numeric as avg_score, count(*)::integer as n
        from (
          select pr.score
          from public.player_ratings pr
          where pr.ratee_id = gp.player_id
          order by pr.created_at desc
          limit 30
        ) x
      ) r on true
      left join lateral (
        select count(*)::integer as friends
        from public.game_guests gg
        where gg.game_id = p_game_id
          and gg.kind = 'friend'
          and gg.brought_by = gp.player_id
      ) f on true
      where gp.game_id = p_game_id
        and gp.status = 'joined'

      union all

  select
        'guest',
        gg.id,
        case gg.skill_level
          when 'Professional' then 4
          when 'Amateur' then 3
          when 'Intermediate' then 2
          else 1
        end::numeric,
        1
      from public.game_guests gg
      where gg.game_id = p_game_id
    )
    select u.*, sum(u.weight) over () as total_weight
    from units u
    order by u.score desc, u.weight desc, u.unit_id::text
  loop
    v_cap := ceil(v_unit.total_weight / 2.0);

    if v_black_slots + v_unit.weight > v_cap
       and v_white_slots + v_unit.weight <= v_cap then
      v_team := 'WHITE';
    elsif v_white_slots + v_unit.weight > v_cap
       and v_black_slots + v_unit.weight <= v_cap then
      v_team := 'BLACK';
    elsif v_black_score < v_white_score
       or (v_black_score = v_white_score and v_black_slots <= v_white_slots) then
      v_team := 'BLACK';
    else
      v_team := 'WHITE';
    end if;

    if v_team = 'BLACK' then
      v_black_score := v_black_score + v_unit.score * v_unit.weight;
      v_black_slots := v_black_slots + v_unit.weight;
    else
      v_white_score := v_white_score + v_unit.score * v_unit.weight;
      v_white_slots := v_white_slots + v_unit.weight;
    end if;

    if v_unit.unit_kind = 'player' then
      update public.game_participants
      set team_color = v_team
      where game_id = p_game_id
        and player_id = v_unit.unit_id
        and team_color is distinct from v_team;
    else
      update public.game_guests
      set team_color = v_team
      where id = v_unit.unit_id
        and team_color is distinct from v_team;
    end if;
  end loop;
end;
$function$;

-- 10. Ratings ---------------------------------------------------------------
create or replace function public.submit_player_ratings(
  p_game_id uuid,
  p_ratings jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_game public.games%rowtype;
  v_item jsonb;
  v_ratee uuid;
  v_score integer;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'You must be logged in.';
  end if;

  select * into v_game from public.games where id = p_game_id;

  if not found then
    raise exception 'Game not found.';
  end if;

  if v_game.cancelled_at is not null then
    raise exception 'This game was cancelled.';
  end if;

  if v_game.starts_at > now() then
    raise exception 'You can rate players after kick-off.';
  end if;

  if coalesce(v_game.ends_at, v_game.starts_at) < now() - interval '7 days' then
    raise exception 'Ratings close 7 days after the game.';
  end if;

  if not exists (
    select 1 from public.game_participants gp
    where gp.game_id = p_game_id
      and gp.player_id = v_user_id
      and gp.status = 'joined'
  ) then
    raise exception 'Only players from this game can rate.';
  end if;

  if p_ratings is null or jsonb_typeof(p_ratings) <> 'array' then
    raise exception 'No ratings sent.';
  end if;

  for v_item in select * from jsonb_array_elements(p_ratings)
  loop
    begin
      v_ratee := (v_item ->> 'player_id')::uuid;
      v_score := (v_item ->> 'score')::integer;
    exception when others then
      raise exception 'A rating was not valid.';
    end;

    if v_score is null or v_score < 1 or v_score > 5 then
      raise exception 'Ratings must be between 1 and 5.';
    end if;

    if v_ratee = v_user_id then
      continue;
    end if;

    if not exists (
      select 1 from public.game_participants gp
      where gp.game_id = p_game_id
        and gp.player_id = v_ratee
        and gp.status = 'joined'
    ) then
      raise exception 'You can only rate players from the same game.';
    end if;

    insert into public.player_ratings (game_id, rater_id, ratee_id, score)
    values (p_game_id, v_user_id, v_ratee, v_score)
    on conflict (game_id, rater_id, ratee_id)
    do update set score = excluded.score, created_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- Games the current player can still rate, with the players to rate.
create or replace function public.games_to_rate()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(x order by x ->> 'starts_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'game_id', g.id,
      'title', g.title,
      'starts_at', g.starts_at,
      'players', (
        select coalesce(jsonb_agg(
          jsonb_build_object('id', other.player_id, 'name', coalesce(p.full_name, 'Player'))
          order by p.full_name
        ), '[]'::jsonb)
        from public.game_participants other
        left join public.profiles p on p.id = other.player_id
        where other.game_id = g.id
          and other.status = 'joined'
          and other.player_id <> auth.uid()
      )
    ) as x
    from public.games g
    join public.game_participants me
      on me.game_id = g.id
     and me.player_id = auth.uid()
     and me.status = 'joined'
    where auth.uid() is not null
      and g.cancelled_at is null
      and g.starts_at <= now()
      and coalesce(g.ends_at, g.starts_at) >= now() - interval '7 days'
      and not exists (
        select 1 from public.player_ratings pr
        where pr.game_id = g.id and pr.rater_id = auth.uid()
      )
      and exists (
        select 1 from public.game_participants o
        where o.game_id = g.id and o.status = 'joined' and o.player_id <> auth.uid()
      )
  ) t;
$function$;

-- The current player's own rating (average of their last 30 ratings).
create or replace function public.my_rating()
returns table (avg_score numeric, ratings_count integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select round(avg(x.score)::numeric, 1), count(*)::integer
  from (
    select pr.score
    from public.player_ratings pr
    where pr.ratee_id = auth.uid()
    order by pr.created_at desc
    limit 30
  ) x;
$function$;

-- Only logged-in users may call the new functions.
revoke execute on function public.kickoff_occupied_slots(uuid) from anon;
revoke execute on function public.host_add_guest(uuid, text, text, text) from anon;
revoke execute on function public.host_remove_guest(uuid) from anon;
revoke execute on function public.submit_player_ratings(uuid, jsonb) from anon;
revoke execute on function public.games_to_rate() from anon;
revoke execute on function public.my_rating() from anon;

commit;
