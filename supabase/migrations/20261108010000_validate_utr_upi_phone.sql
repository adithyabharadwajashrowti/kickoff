-- KICKOFF migration: server-side validation for UTR, UPI ID and phone numbers
--
-- What it changes:
--   1. submit_game_payment (the version the app uses) now also requires:
--        - the UTR to be exactly 12 digits
--        - the UTR not to be used already on another non-rejected request
--      Everything else in the function is unchanged.
--   2. Removes the OLD 3-input version of submit_game_payment. The app never
--      calls it, and it skipped the profile and pending-slot checks.
--   3. New games (or edits to host_upi_id) must use a valid UPI ID format.
--   4. Phone numbers saved in player_contacts must be +91 followed by a
--      valid 10-digit Indian mobile number; anything else is stored as empty.
--
-- What it does NOT change:
--   Existing games, payment requests, participants or phone numbers.

begin;

-- 1. Payment submission with UTR checks ---------------------------------
create or replace function public.submit_game_payment(
  p_game_id uuid,
  p_upi_reference text,
  p_slots_count integer,
  p_skill_level text
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
     or p_skill_level not in (
       'Beginner', 'Intermediate', 'Amateur', 'Professional'
     )
  then
    raise exception 'Choose a valid playing level for this match.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and length(trim(p.full_name)) between 2 and 60
      and p.skill_level in (
        'Beginner', 'Intermediate', 'Amateur', 'Professional'
      )
      and p.primary_position in (
        'Goalkeeper', 'Defender', 'Midfielder', 'Forward',
        'Flexible / Any'
      )
  )
  then
    raise exception
      'Complete your KICKOFF player card before requesting a slot.';
  end if;

  select *
  into v_game
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

  if v_game.host_upi_id is null
     or trim(v_game.host_upi_id) = ''
  then
    raise exception 'The host has not configured a UPI ID.';
  end if;

  if exists (
    select 1
    from public.game_participants gp
    where gp.game_id = p_game_id
      and gp.player_id = v_user_id
      and gp.status = 'joined'
  )
  then
    raise exception 'You have already joined this game.';
  end if;

  if exists (
    select 1
    from public.game_payment_requests r
    where r.game_id = p_game_id
      and r.player_id = v_user_id
      and upper(r.status) = 'PENDING'
  )
  then
    raise exception
      'You already have a pending payment request.';
  end if;

  select coalesce(sum(gp.slots_count), 0)::integer
  into v_occupied
  from public.game_participants gp
  where gp.game_id = p_game_id
    and gp.status = 'joined';

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
    game_id,
    player_id,
    amount_paise,
    slots_count,
    match_skill_level,
    upi_reference,
    status
  )
  values (
    p_game_id,
    v_user_id,
    v_game.price_per_player_paise * p_slots_count,
    p_slots_count,
    p_skill_level,
    v_reference,
    'PENDING'
  )
  returning id into v_request_id;

  return v_request_id;
end;
$function$;

-- 2. Remove the old, less strict version --------------------------------
drop function if exists public.submit_game_payment(uuid, text, integer);

-- 3. Valid UPI ID on games -----------------------------------------------
create or replace function public.kickoff_validate_host_upi_id()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.host_upi_id is not null then
    new.host_upi_id := lower(trim(new.host_upi_id));

    if new.host_upi_id = '' then
      new.host_upi_id := null;
    elsif new.host_upi_id !~ '^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$' then
      raise exception 'Enter a valid UPI ID, like yourname@okaxis.';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists kickoff_validate_host_upi_id_trigger on public.games;

create trigger kickoff_validate_host_upi_id_trigger
before insert or update of host_upi_id on public.games
for each row
execute function public.kickoff_validate_host_upi_id();

-- 4. Valid phone numbers in player_contacts --------------------------------
create or replace function public.kickoff_validate_contact_phone()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.phone is not null then
    new.phone := regexp_replace(new.phone, '\s', '', 'g');

    -- Invalid numbers are stored as empty rather than blocking signup.
    if new.phone !~ '^\+91[6-9][0-9]{9}$' then
      new.phone := null;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists kickoff_validate_contact_phone_trigger on public.player_contacts;

create trigger kickoff_validate_contact_phone_trigger
before insert or update of phone on public.player_contacts
for each row
execute function public.kickoff_validate_contact_phone();

commit;
