-- KICKOFF migration: only secured (non-guest) accounts can create games
--
-- Why: a guest account is lost forever if the host logs out, leaving players'
-- UPI payments stuck with no one able to approve them. Guests could also
-- create fake paid games. Hosts must first add an email + password
-- (the "Secure your account" panel on My profile).
--
-- What it changes:
--   Replaces the INSERT rule "Users can create games as themselves" with
--   "Secured hosts can create games": same check (you can only create games
--   as yourself) PLUS the account must not be anonymous.
-- What it does NOT change:
--   Existing games, including games created earlier by guests, and the rule
--   letting organisers update their own games.

begin;

drop policy if exists "Users can create games as themselves" on public.games;

create policy "Secured hosts can create games"
on public.games
for insert
to authenticated
with check (
  organiser_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

commit;
