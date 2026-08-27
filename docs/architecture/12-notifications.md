# 12 — Notification Architecture

## 1. Scope for V1

**In-app only.** `notifications` rows, a bell in the app shell, an unread count, a list page,
mark-read and archive. Email delivery is designed for — `notification_deliveries` carries a
`channel` column from day one — but the email channel is not processed until a later phase.

Reason for the fence: email introduces deliverability, sending reputation, unsubscribe
handling, template management and preference management. All real work, none of it needed to
replace a spreadsheet, and all of it much easier to add to a working notification model than
to bolt on alongside one.

## 2. Model

Two tables (full DDL in doc 02 §10):

- `notifications` — one row per recipient per event. **Not** one row per event with a join
  table. Per-recipient rows make read state, RLS and the inbox query trivially simple; the
  storage cost of duplication is irrelevant at this volume.
- `notification_deliveries` — one row per channel attempt. Adding email later means processing
  pending rows, not changing the notification model.

Content is stored resolved (`title`, `body` already rendered) rather than as a template key
plus parameters. A notification is a record of what the user was told at a point in time; if a
template changes later, historical notifications should not silently change meaning. Same
principle as the rest of the system.

## 3. Generation

Notifications are created inside the same transaction as the event that causes them, by the
SQL functions described in doc 04 §4:

```sql
create or replace function util.notify(
  p_recipient uuid, p_type text, p_title text, p_body text,
  p_entity_table text, p_entity_id uuid, p_action_path text, p_dedupe_key text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.notifications (recipient_id, type_code, title, body,
    entity_table, entity_id, action_path, dedupe_key, actor_id)
  values (p_recipient, p_type, p_title, p_body,
    p_entity_table, p_entity_id, p_action_path, p_dedupe_key, auth.uid())
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null
    do nothing
  returning id into v_id;

  if v_id is not null then
    insert into public.notification_deliveries (notification_id, channel, status)
    values (v_id, 'in_app', 'sent');
  end if;
  return v_id;
end $$;
```

Transactional generation means a notification never announces something that then rolls back —
a subtle bug class that is very hard to reproduce and very easy to avoid here.

Recipient resolution is one helper: `util.candidate_stakeholders(candidate_id)` returns active
assignees. Recipients are computed at send time, never stored as a rule, so an unassignment
takes effect immediately.

`dedupe_key` prevents the classic pathology where a record edited five times produces five
identical alerts. Example key: `interview:{id}:rescheduled:{new_start}`.

## 4. Catalogue (proposed)

Internal:

| Type | Recipients |
|---|---|
| `candidate.assigned` | the newly assigned user |
| `interview.scheduled` / `.rescheduled` / `.cancelled` | candidate's active assignees |
| `assessment.assigned` / `.due_soon` | assignees |
| `offer.received` | assignees + users with `report.view_all` |
| `application.no_response` | assignee (threshold D-12) |
| `review_item.assigned` / `.overdue` | assignee |
| `daily_report.missing` | the recruiter, plus managers on escalation |
| `import.completed` / `.failed` | the initiating admin |

Candidate portal (deliberately short, per doc 08 §5):
`interview.scheduled`, `interview.rescheduled`, `interview.cancelled`,
`assessment.assigned`, `offer.received`, `document.shared`.

Every type is a row in `notification_types`, so the catalogue is data.

## 5. Delivery and UI

In-app delivery is a Supabase Realtime subscription filtered by RLS
(`recipient_id = auth.uid()`), with a poll fallback every 60 s for reconnect gaps. The bell
shows an unread count from the partial index in doc 02 §10; the panel shows the last 20 with
a link to the full page.

Clicking a notification marks it read and navigates to `action_path`. Marking read is the one
place optimistic UI is unambiguously right (doc 09 §4).

## 6. Deferred, and why

- **Preferences.** A `notification_preferences` table is the natural next step, but preferences
  without a second channel is a setting that changes nothing. It arrives with email.
- **Digests.** Batched summaries only make sense once we can observe real volume.
- **Escalation chains.** The `daily_report.missing` case will want one; it needs a business
  rule about who escalates to whom that has not been specified, so it is not invented here.
