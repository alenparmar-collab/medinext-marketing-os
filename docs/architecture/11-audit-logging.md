# 11 — Audit Logging Architecture

## 1. Two different things, deliberately separate

They are frequently conflated, and conflating them produces a log that is useless for both
purposes.

| | Audit log | Candidate timeline |
|---|---|---|
| Table | `audit.audit_logs` | `v_candidate_timeline` (view) |
| Audience | Admins, compliance | Recruiters, candidates |
| Content | Every row change, technically | Business events, narratively |
| Content of a status edit | old row, new row, changed fields, actor, IP | "Application moved to Interviewing" |
| Mutability | Append-only, forever | Derived, recomputable |
| Visibility | `audit.read` permission only | Scoped to the candidate |

The audit log is a technical record of *what changed in the database*. The timeline is a
business record of *what happened to the candidate*. A timeline built from audit rows is
unreadable; an audit log built from business events is incomplete.

## 2. Capture at the database, not the application

Triggers, not application code. Application-level auditing is always incomplete, because it
misses SQL functions, imports, admin corrections, and anything the next developer forgets to
wrap. A trigger cannot be forgotten by a code path it does not know about.

```sql
create or replace function audit.tg_audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_old jsonb; v_new jsonb; v_changed text[];
begin
  v_actor := coalesce(
    auth.uid(),
    nullif(current_setting('app.actor_id', true), '')::uuid
  );

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    select array_agg(key) into v_changed
      from jsonb_each(v_new)
      where v_new -> key is distinct from v_old -> key;

    -- nothing of substance changed (e.g. only updated_at): do not log noise
    if v_changed is null or v_changed <@ array['updated_at','updated_by'] then
      return coalesce(new, old);
    end if;
  end if;

  insert into audit.audit_logs (
    actor_id, actor_kind, action, table_schema, table_name,
    record_id, changed_fields, old_data, new_data, request_id
  ) values (
    v_actor,
    case when v_actor is null then 'system' else 'user' end,
    lower(tg_op), tg_table_schema, tg_table_name,
    coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid),
    v_changed, v_old, v_new,
    nullif(current_setting('app.request_id', true), '')::uuid
  );

  return coalesce(new, old);
end $$;
```

Attached `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` to every business table.

Two details worth keeping: skipping updates that only touch `updated_at` prevents the log
filling with noise from no-op saves, and taking the actor from `auth.uid()` **or** the
`app.actor_id` GUC means service-role and worker writes are attributed rather than anonymous.

The server sets the GUCs per transaction:

```sql
select set_config('app.actor_id',  $1, true);   -- true = transaction-local
select set_config('app.request_id', $2, true);
```

## 3. Immutability, enforced

Append-only is a claim that must be enforced at the database, or it is decoration.

```sql
revoke insert, update, delete on audit.audit_logs from authenticated, anon, service_role;
grant  insert on audit.audit_logs to postgres;   -- trigger owner only

create rule audit_logs_no_update as on update to audit.audit_logs do instead nothing;
create rule audit_logs_no_delete as on delete to audit.audit_logs do instead nothing;
```

Note the service role is included in the revoke. The whole point is that no application path,
however privileged, can amend the record. Only a superuser dropping the rules can — which is a
database-administration event, and out of the threat model per doc 05 §1.

## 4. Growth

Monthly range partitions on `occurred_at`. This table will be the largest in the system by an
order of magnitude — every field edit on every record forever — and an unpartitioned audit
table is a well-known way to make vacuum and archival painful two years in.

```sql
create table audit.audit_logs_2026_09 partition of audit.audit_logs
  for values from ('2026-09-01') to ('2026-10-01');
```

Partition creation is automated by a monthly cron job that creates the next two months ahead.
Old partitions are detached and archived to cold storage rather than deleted, on a retention
schedule that is **[DECISION NEEDED, D-10]**.

Indexes on `(table_name, record_id, occurred_at desc)`, `(actor_id, occurred_at desc)`, and
`occurred_at`. GIN on `new_data` only if search demand justifies it; jsonb GIN indexes on a
table this size are expensive and should be added on evidence, not in anticipation.

## 5. Non-row events

Triggers cannot see logins, exports, permission grants, failed authorization attempts, or
service-role usage. Those are written explicitly by the server layer through one helper:

```ts
await recordAuditEvent(ctx, {
  action: 'export',
  tableName: 'candidates',
  metadata: { filters, rowCount },
});
```

The list we commit to capturing in V1:

| Action | Why it matters |
|---|---|
| `login` / `login_failed` | Account compromise investigation |
| `export` (with row count) | The highest-impact insider risk in this product |
| `permission_change`, `role_grant`, `role_revoke` | Privilege escalation trail |
| `portal_invite`, `portal_revoke` | Who gave a candidate access to what, when |
| `service_role_use` (with reason) | RLS bypass must never be silent |
| `document_download` | Résumés and IDs leaving the system |
| `import_run` | Bulk mutation attribution |
| `review_resolution` | Who accepted which machine proposal |
| `forbidden_attempt` | Repeated denials are a signal |

## 6. Reading the log

Admin-only (`audit.read`), never exposed to the portal, never joined into an internal page's
default query. Filters: actor, record, table, action, date range. Two views that matter in
practice: **record history** (everything that happened to one record, rendered as a field-level
diff) and **actor activity** (everything one person did in a window).

Audit reads are themselves audited. That is standard for a log that contains personal data,
and it costs nothing to add now.
