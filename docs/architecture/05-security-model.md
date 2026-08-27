# 05 — Security Model

## 1. Threat model in one paragraph

The realistic threats are: a candidate reading another candidate's records; a recruiter
reading candidates they were never assigned; a candidate reading internal notes about
themselves; a compromised browser session replaying REST calls directly against the Supabase
API; and a service-role key leaking into client-side code. The design below targets each of
those specifically. It does not attempt to defend against a compromised database
administrator.

## 2. The constraint that shapes everything

Supabase has exactly three database roles: `anon`, `authenticated`, `service_role`. Every
logged-in user — admin and candidate alike — connects as `authenticated`.

**Consequence: `GRANT` cannot separate internal users from candidates.** You cannot grant
`SELECT ON daily_reports` to staff and withhold it from candidates at the grant level,
because they are the same database role. All per-user separation must come from RLS
predicates.

This makes RLS not one layer among several but *the* mechanism, and it means the default must
be deny:

```sql
alter table public.<every_table> enable row level security;
alter table public.<every_table> force row level security;   -- applies to table owner too
```

A table with RLS enabled and no matching policy returns zero rows. Every new table is
therefore secure at creation and becomes accessible only by deliberate policy. Adding this to
the migration checklist is not bureaucracy; it is the difference between a leak and a
non-event when someone adds a table on a Friday.

## 3. Row-level security is not column-level security

If a policy lets a candidate read a row, the candidate can read **every column of that row**,
including via a hand-crafted REST call that ignores our views.

Therefore: **no candidate-visible table contains an internal-only column.** Internal notes,
recruiter commentary, vendor rates, source metadata and confidence scores live in sibling
tables (`candidate_internal_notes`, `application_internal_notes`) that candidates have no
policy on at all.

The `portal_*` views project a narrow column set for ergonomics and for defence in depth, but
they are not the security boundary. A view can be bypassed; a missing policy cannot.

Postgres does support column-level `GRANT`, but per §2 it cannot vary by user, so it is not
usable here.

## 4. Helper functions

All are `SECURITY DEFINER`, `STABLE`, with a pinned empty `search_path`, living in the
unexposed `util` schema. They bypass RLS internally, which is exactly why they must be small,
audited, and take no user-controlled SQL.

```sql
create or replace function util.current_user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select auth.uid()
$$;

create or replace function util.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.status = 'active'
  )
$$;

create or replace function util.has_permission(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    where ur.user_id = auth.uid()
      and rp.permission_code = p_code
  )
$$;

create or replace function util.is_internal() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role_code in ('admin','manager','recruiter')
  )
$$;

-- The candidate row belonging to the signed-in portal user, or null.
create or replace function util.own_candidate_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.candidates c
  join public.users u on u.id = c.user_id
  where c.user_id = auth.uid() and u.status = 'active' and c.archived_at is null
$$;

-- The single scope predicate every internal policy funnels through.
create or replace function util.can_access_candidate(p_candidate_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    util.is_active_user() and (
      util.has_permission('candidate.view_all')
      or exists (
        select 1 from public.candidate_assignments ca
        where ca.candidate_id = p_candidate_id
          and ca.user_id = auth.uid()
          and ca.unassigned_at is null
      )
    )
$$;
```

Two implementation notes that matter in practice:

- **`SECURITY DEFINER` is required to avoid infinite recursion.** A policy on `candidates`
  that queries `candidate_assignments` would otherwise trigger that table's policies, which
  may query back. Definer functions read with the owner's rights and stop the loop.
- **Wrap calls as `(select util.fn())` inside policies.** Postgres then evaluates the function
  once per statement instead of once per row. On a 50 000-row scan the difference is roughly
  two orders of magnitude. This is the single most impactful RLS performance rule.

## 5. Policy patterns

Policies are written **per command**, never `FOR ALL`. `FOR ALL` hides the fact that
`USING` gates reads and deletes while `WITH CHECK` gates writes, and it is how tables end up
accidentally writable.

### Candidates

```sql
-- internal read
create policy candidates_select_internal on public.candidates
for select to authenticated
using ( (select util.can_access_candidate(id)) );

-- portal read: own row only
create policy candidates_select_own on public.candidates
for select to authenticated
using ( id = (select util.own_candidate_id()) );

create policy candidates_insert on public.candidates
for insert to authenticated
with check ( (select util.has_permission('candidate.create')) );

create policy candidates_update on public.candidates
for update to authenticated
using      ( (select util.has_permission('candidate.update'))
             and (select util.can_access_candidate(id)) )
with check ( (select util.has_permission('candidate.update'))
             and (select util.can_access_candidate(id)) );

create policy candidates_delete_admin on public.candidates
for delete to authenticated
using ( (select util.has_permission('user.manage')) );
```

Note there is **no candidate `UPDATE` policy**. In V1 the portal is read-only pending
D-01; if the answer is "candidates may edit their profile," it becomes one narrowly scoped
policy on `candidate_profiles` only — never on `candidates` itself, because status and
assignment must not be self-editable.

### Child records — the repeated shape

Every table that hangs off a candidate uses the same two-policy pair. Uniformity here is a
security property: a reviewer can verify a new table at a glance.

```sql
create policy applications_select_internal on public.applications
for select to authenticated
using ( (select util.can_access_candidate(candidate_id)) );

create policy applications_select_own on public.applications
for select to authenticated
using ( candidate_id = (select util.own_candidate_id()) );

create policy applications_write on public.applications
for insert to authenticated
with check ( (select util.has_permission('application.create'))
             and (select util.can_access_candidate(candidate_id)) );
```

### Internal-only tables

`candidate_internal_notes`, `marketing_activities`, `recruiter_responses`, `daily_reports`,
`review_items`, `record_provenance`, `organizations`:

```sql
create policy internal_only_select on public.candidate_internal_notes
for select to authenticated
using ( (select util.is_internal())
        and (select util.can_access_candidate(candidate_id)) );
```

No `_select_own` policy exists on these tables. A candidate reaching them gets zero rows, not
an error — which is also the correct behaviour for not leaking existence.

### Daily reports

```sql
create policy daily_reports_select on public.daily_reports
for select to authenticated
using ( user_id = auth.uid() or (select util.has_permission('report.view_all')) );

create policy daily_reports_update_own_draft on public.daily_reports
for update to authenticated
using      ( user_id = auth.uid() and status = 'draft' )
with check ( user_id = auth.uid() and status in ('draft','submitted') );
```

The `status = 'draft'` predicate in `USING` makes "a submitted report cannot be edited" a
database invariant rather than a UI convention.

### Notifications

```sql
create policy notifications_select_own on public.notifications
for select to authenticated using ( recipient_id = auth.uid() );

create policy notifications_update_own on public.notifications
for update to authenticated
using ( recipient_id = auth.uid() )
with check ( recipient_id = auth.uid() );
```

Users may only ever mark their own notifications read or archived. Insert is not granted to
`authenticated` at all — notifications are created by `SECURITY DEFINER` functions and the
server layer, so a client cannot forge one.

### Unexposed schemas

`ingest`, `staging`, `audit` have no grants to `authenticated`. They are reachable only from
the service role or from definer functions. There are no RLS policies to review because there
is no access path to review.

## 6. Storage

One private bucket, `candidate-documents`. No public buckets anywhere in the product.

Path convention: `{candidate_id}/{document_type}/{uuid}-{filename}`. The first path segment
is the authorization key, parsed by `storage.foldername(name)[1]`.

```sql
create policy documents_read_internal on storage.objects
for select to authenticated
using (
  bucket_id = 'candidate-documents'
  and (select util.can_access_candidate( (storage.foldername(name))[1]::uuid ))
);

create policy documents_read_own on storage.objects
for select to authenticated
using (
  bucket_id = 'candidate-documents'
  and (storage.foldername(name))[1]::uuid = (select util.own_candidate_id())
  and exists (
    select 1 from public.documents d
    where d.storage_path = storage.objects.name
      and d.visibility = 'candidate_visible'
      and d.deleted_at is null
  )
);
```

The second policy is the important one: a candidate can read only files that a staff member
has explicitly marked candidate-visible, and only under their own candidate id. Uploading a
file does not make it visible; that is a separate, permissioned action.

Downloads are served via short-lived signed URLs (60 s) generated server-side after the same
check. Signed URLs are never logged, never cached, never embedded in server-rendered HTML
that could be cached.

## 7. Key handling

| Key | Where it may appear |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / anon key | Anywhere. Safe by design because RLS gates everything. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only modules under `src/server/privileged/`, plus the future ingestion worker. Never in a client component, never in `NEXT_PUBLIC_*`, never in middleware. |

Enforcement, not intention:

- ESLint rule banning imports of `src/server/privileged/**` from any `"use client"` file or
  any path under `src/app/**` that is not a server action or route handler.
- A CI grep that fails the build if `SERVICE_ROLE` appears outside the allowlisted directory.
- Every privileged call goes through one `withServiceRole(actor, reason, fn)` wrapper that
  writes an audit row. If it is worth bypassing RLS, it is worth explaining why in the log.

## 8. Session and transport

- Cookie-based sessions via `@supabase/ssr`: `httpOnly`, `Secure`, `SameSite=Lax`.
- Middleware refreshes the session and performs a coarse route guard (`/portal/*` requires the
  candidate claim; `/app/*` requires an internal claim). Coarse only — middleware is not an
  authorization layer, it is a redirect layer.
- Server actions are POST-only with Next.js's built-in origin check; CSRF is covered by
  `SameSite` plus that check.
- Strict CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` denying camera/mic/geolocation.
- MFA: Supabase TOTP enrolment for `admin` at minimum. **[DECISION NEEDED, D-09]** whether it
  is mandatory for all internal users.

## 9. PII posture

Candidate data is personal data: names, emails, phone numbers, résumés, and eventually the
contents of an entire mailbox. Concretely:

- No PII in application logs. Log identifiers, never names or email addresses.
- No PII in URLs (they land in browser history, proxies and analytics). Use ids.
- Error reporting scrubbed; no request bodies captured.
- Exports are a permissioned, audited action (`action = 'export'` with a row count), because
  bulk export is the highest-impact insider risk in a system like this and the audit trail is
  the only control that survives an authorised user acting badly.
- Retention and right-to-erasure handling: **[DECISION NEEDED, D-10]**. Erasure conflicts with
  an append-only audit log; the standard resolution is crypto-shredding or PII tombstoning in
  layer 1 while preserving layer 4 record shape. This needs a legal answer before ingestion,
  not before V1.

## 10. Verification

Security claims that are not tested are wishes. The following are CI gates, not aspirations:

1. **pgTAP RLS suite.** For each table, assert: an admin JWT sees all rows; a recruiter JWT
   sees only assigned rows; a candidate JWT sees only own rows; a candidate JWT sees **zero**
   rows on every internal table. The last assertion runs over a list generated from
   `information_schema`, so a newly added table fails the suite until it is classified.
2. **RLS-enabled check.** A test that fails if any table in `public` lacks
   `rowsecurity = true`.
3. **Key-leak grep** in CI.
4. **Storage policy test** covering the `visibility` gate.

Test 1's generated table list is the piece that keeps this honest over time — it converts
"remember to add policies" from a review comment into a build failure.
