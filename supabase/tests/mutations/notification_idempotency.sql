-- MUTATION PROBE: remove the idempotency guarantee from notification emission.
--
-- Makes every dedupe key unique, so a re-observed event produces a fresh
-- notification. The suite must notice.
create or replace function util.emit_notification(
  p_business_unit_id uuid, p_recipient_id uuid, p_type notification_type,
  p_title text, p_message text, p_entity_type text, p_entity_id uuid, p_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  if p_recipient_id is null then
    return null;
  end if;

  insert into public.notifications (
    business_unit_id, recipient_id, notification_type,
    title, message, entity_type, entity_id, dedupe_key
  )
  values (
    p_business_unit_id, p_recipient_id, p_type,
    p_title, p_message, p_entity_type, p_entity_id,
    p_dedupe_key || ':' || clock_timestamp()::text
  )
  on conflict (recipient_id, dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$fn$;
