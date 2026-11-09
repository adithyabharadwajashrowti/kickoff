-- KICKOFF migration: fix who can run the app's database functions
--
-- Why:
--   - Logged-in users got "permission denied for function cancel_game".
--   - A few helper functions could be called by visitors who are not logged in.
--
-- What it changes:
--   Every function the app calls can be run by logged-in users only.
--   Each function still checks inside who is allowed to do what
--   (e.g. only the organiser can cancel or approve).
--   Visitors who are not logged in (anon) cannot run any of them.

begin;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.cancel_game(uuid)',
    'public.submit_game_payment(uuid, text, integer, text, jsonb, text)',
    'public.join_game_with_level(uuid, text, text)',
    'public.review_game_payment(uuid, boolean, text)',
    'public.host_add_guest(uuid, text, text, text)',
    'public.host_remove_guest(uuid)',
    'public.submit_player_ratings(uuid, jsonb)',
    'public.games_to_rate()',
    'public.my_rating()',
    'public.kickoff_occupied_slots(uuid)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
