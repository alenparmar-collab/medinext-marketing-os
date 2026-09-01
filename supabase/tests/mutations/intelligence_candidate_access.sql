-- ---------------------------------------------------------------------------
-- MUTATION: let a candidate see interpretations that name them.
--
-- This is the version somebody writes with good intentions — "surely they can
-- see what we concluded about them". It exposes a model's unverified guesses
-- about a person to that person, including the ones held for review because
-- they are probably wrong.
-- ---------------------------------------------------------------------------
create policy email_intelligence_runs_select_candidate on public.email_intelligence_runs
  for select to authenticated
  using (proposed_candidate_id = (select util.own_candidate_id()));
