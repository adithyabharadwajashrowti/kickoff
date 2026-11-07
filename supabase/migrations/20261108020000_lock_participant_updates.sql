-- KICKOFF migration: players can no longer edit their own game entry
--
-- Why: the rule "Players can update their own participation" let any player
-- change any column of their own row in game_participants, for example
-- raising slots_count without paying or switching team colour.
--
-- The app never updates these rows directly. Joining, payments, approvals
-- and team balancing all go through database functions and triggers, which
-- are not affected by this rule.
--
-- What it changes: removes that one UPDATE rule. Nothing else.

begin;

drop policy if exists "Players can update their own participation"
  on public.game_participants;

commit;
