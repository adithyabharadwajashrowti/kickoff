-- KICKOFF migration: security hardening (from live-site testing)
--
-- What it changes:
--   1. Players can no longer add themselves to a game directly (which
--      skipped the slot limit). Joining goes through join_game_with_level
--      or a host-approved payment. Hosts can still add themselves (1 slot)
--      to their own game when they choose "Host + play".
--   2. A participant can never hold fewer than 1 or more than 50 slots.
--   3. Only APPROVED HOSTS can create games. Everyone who has already
--      hosted a game (with a non-guest account) is approved automatically.
--      You approve new hosts with one line of SQL (see the bottom).
--   4. Hosts can approve payments until the game ENDS (not just until
--      kick-off), so late UPI payments can be approved at the turf.
--   5. Logged-out visitors lose all write permissions on app tables
--      (they were already blocked by the row rules; this is a second lock).
--   6. The unused turf-booking functions can no longer be called from
--      the app.
--
-- What it does NOT change: existing games, players, payments or ratings.

begin;

-- 1. Direct self-join only for the host of the game -----------------------
drop policy if exists "Players can join as themselves" on public.game_participants;
drop policy if exists "Hosts can add themselves to their own game" on public.game_participants;

create policy "Hosts can add themselves to their own game"
on public.game_participants
for insert
to authenticated
with check (
  player_id = (select auth.uid())
  and slots_count = 1
  and exists (
    select 1
    from public.games g
    where g.id = game_participants.game_id
      and g.organiser_id = (select auth.uid())
      and g.status = 'open'
      and g.cancelled_at is null
      and g.starts_at > now()
  )
);

-- 2. Slot count sanity -----------------------------------------------------
alter table public.game_participants
  drop constraint if exists game_participants_slots_count_check;

alter table public.game_participants
  add constraint game_participants_slots_count_check
  check (slots_count between 1 and 50) not valid;

-- 3. Approved hosts ----------------------------------------------------------
create table if not exists public.approved_hosts (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  note        text
);

alter table public.approved_hosts enable row level security;

revoke all on public.approved_hosts from anon;

drop policy if exists "Hosts can see their own approval" on public.approved_hosts;

create policy "Hosts can see their own approval"
on public.approved_hosts
for select
to authenticated
using (user_id = (select auth.uid()));

-- Everyone who already hosted with a non-guest account stays a host.
insert into public.approved_hosts (user_id, note)
select distinct g.organiser_id, 'Auto-approved: hosted before'
from public.games g
join auth.users u on u.id = g.organiser_id
where coalesce(u.is_anonymous, false) = false
on conflict (user_id) do nothing;

drop policy if exists "Secured hosts can create games" on public.games;
drop policy if exists "Approved hosts can create games" on public.games;

create policy "Approved hosts can create games"
on public.games
for insert
to authenticated
with check (
  organiser_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and exists (
    select 1 from public.approved_hosts h
    where h.user_id = (select auth.uid())
  )
);

-- 4. Approvals allowed until the game ends --------------------------------
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
    -- Hosts can approve until the game ends (e.g. at the turf),
    -- but not after it is cancelled or over.
    if v_game.status <> 'open'
       or v_game.cancelled_at is not null
       or coalesce(v_game.ends_at, v_game.starts_at) <= now()
    then
      raise exception 'This game has been cancelled or has already ended.';
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

grant execute on function public.review_game_payment(uuid, boolean, text) to authenticated;
revoke execute on function public.review_game_payment(uuid, boolean, text) from public, anon;

-- 5. No writes at all for logged-out visitors ------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'games', 'game_participants', 'game_payment_requests', 'venues',
    'profiles', 'player_contacts', 'game_guests', 'player_ratings',
    'approved_hosts'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete, truncate on public.%I from anon', t);
    end if;
  end loop;
end $$;

-- 6. Unused turf-booking functions -----------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_turf_booking(uuid, timestamp with time zone, timestamp with time zone)',
    'public.attach_payment_session(uuid, text)'
  ]
  loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- HOW TO APPROVE A NEW HOST (run separately, change the email):
--
--   insert into public.approved_hosts (user_id, note)
--   select id, 'Approved by Adithya'
--   from auth.users
--   where email = 'newhost@example.com'
--   on conflict do nothing;
--
-- HOW TO REMOVE A HOST:
--
--   delete from public.approved_hosts
--   where user_id = (select id from auth.users where email = 'newhost@example.com');
-- ---------------------------------------------------------------------------
