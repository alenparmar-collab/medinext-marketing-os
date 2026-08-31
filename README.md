# MediNext Marketing OS

Marketing operations platform for candidate marketing. Replaces an Excel-based
workflow with an auditable system, and gives each candidate a portal showing
only their own information.

**Current stage: Build 5.1 — ownership and attribution hardening.** Interviews and
assessments now have full scheduling and outcome screens; daily reports exist
and their figures are **counted from the records rather than typed in**; a
review queue surfaces records that need a human decision, in neutral language
that never accuses anybody; team administration and candidate assignment
management are in place, with role escalation closed off in the database rather
than in the interface. Build 5.1 then separated two things the reports had been
conflating: **who is responsible for a candidate's marketing** and **who created
the record**. They are not the same, and counting the second was making
recruiters' own reports wrong.

---

## Contents

- [What is built](#what-is-built)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Supabase setup](#supabase-setup)
- [Database migrations](#database-migrations)
- [Seed data](#seed-data)
- [Authentication](#authentication)
- [Role and permission model](#role-and-permission-model)
- [Security model](#security-model)
- [Testing](#testing)
- [Development commands](#development-commands)
- [Technical decisions](#technical-decisions)
- [Product rules](#product-rules)
- [Known limitations](#known-limitations)

---

## What is built

| Area | State |
|---|---|
| Project foundation, TypeScript strict, Tailwind, design tokens | Done |
| Supabase connection, three clients, environment validation | Done |
| Migrations: tenancy, users, roles, candidates, assignments, marketing periods, documents, audit | Done |
| Row Level Security on every table, verified by an executing test suite | Done |
| Audit infrastructure: trigger-based capture, append-only, partitioned | Done |
| Candidate list, detail and creation | Done |
| Marketing period listing | Done |
| Candidate portal: home, profile, marketing, documents, help | Done (read-only) |
| Application shell and full navigation structure | Done |
| Error, loading, empty, unauthorized and not-found states | Done |
| Demo seed data | Done |
| Applications: list, detail, create, edit, status change with history | Done |
| Marketing activities, manual logging, derived counts | Done |
| Candidate workspace with Overview / Applications / Marketing / Timeline / Documents | Done |
| Internal notes with author-only editing | Done |
| Candidate portal: own applications and activity | Done |
| Interviews with reschedule history, statuses and outcomes | Done |
| Assessments with deadlines, statuses and outcomes | Done |
| Notifications, idempotent, with a read/unread centre | Done |
| Document upload and signed-URL download, including candidate upload | Done |
| Recruiter "needs your attention" queue | Done |
| Candidate portal: interviews, assessments, notifications, documents | Done |
| Interview scheduling, rescheduling and outcome screens | Done |
| Assessment creation, editing, status and outcome screens | Done |
| Daily reports: derived figures, judgement fields, confirmation snapshot | Done |
| Historical report filters by recruiter and date range | Done |
| Review queue: deterministic checks, assignment, resolution with a note | Done |
| Team administration: accounts, status, roles, escalation guards | Done |
| Candidate assignment management with atomic transfer and full history | Done |
| Responsible recruiter recorded on every marketing record, separately from its creator | Done |
| Daily report figures attributed by responsibility, not by keystrokes | Done |
| Recruiter workspace ("your day so far") and manager unit workspace | Done |
| Email ingestion, AI, payments, sales, WhatsApp, mobile | Out of scope |

---

## Architecture

The full proposal is in [`docs/architecture/`](./docs/architecture/). The parts
that matter for reading this codebase:

**Three layers, kept separate.** Source information, system interpretation and
verified business records are distinct. Build 2 contains only verified records
and the audit history, but the shape is what later builds extend into:
interpretation never silently overwrites a record.

**Authorization lives in the database.** RLS is the enforcement boundary. The
server layer fails fast with a clear error; the UI hides things for ergonomics.
Remove the UI checks and the system is still secure. Remove RLS and it is not.

**Candidate-visible rows carry no internal-only columns.** RLS is row-level, not
column-level: a candidate who can read a row reads every column of it. Internal
notes therefore live in `candidate_internal_notes`, never as a column on
`candidates`.

```
src/
├── app/
│   ├── (auth)/sign-in/         public
│   ├── (internal)/             internal CRM  — admin, manager, recruiter
│   ├── (portal)/               candidate portal — candidates only
│   ├── api/                    route handlers
│   └── auth/sign-out/
├── components/
│   ├── ui/                     primitives (button, field, card, table, badge)
│   └── patterns/               composed (shell, page header, states, badges)
├── server/
│   ├── auth/                   actor context, permissions, mutation pipeline
│   ├── modules/                data access, one directory per domain
│   └── privileged/             service-role, audited, import-restricted
├── lib/                        supabase clients, env, validation, formatting
├── config/                     permissions, statuses, navigation
└── types/                      database types

supabase/
├── migrations/                 forward-only SQL, 0001–0012
├── seed/                       demo data (development only)
└── tests/                      RLS suite and local auth shim
```

---

## Local setup

Requires Node 20.9+ and either a Supabase project or a local PostgreSQL 15+
instance for the database tests.

```bash
git clone <repo> && cd medinext-marketing-os
npm install
cp .env.example .env.local     # then fill in your Supabase values
npm run dev                    # http://localhost:3000
```

To run the database tests you do **not** need Supabase — a local PostgreSQL is
enough (see [Testing](#testing)).

---

## Environment variables

| Variable | Where it may appear | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Anywhere | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anywhere | Public by design; RLS is what protects the data |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypasses RLS entirely |
| `NEXT_PUBLIC_SITE_URL` | Anywhere | Public origin for auth redirects |

The service role key must never be prefixed `NEXT_PUBLIC_`, never imported into
a client component, and is reachable only through `withServiceRole()`, which
records an audit row on every use. An ESLint rule fails the build if any route
or component imports it.

Validation lives in `src/lib/env.ts` and splits public from server variables, so
the service key cannot be pulled into a browser bundle by an accidental import.

---

## Supabase setup

1. Create a Supabase project.
2. Copy the project URL, anon key and service role key into `.env.local`.
3. Apply the migrations (below).
4. Create a private storage bucket named `candidate-documents` — migration
   `0011_storage.sql` creates it and its policies automatically when run against
   a Supabase project. **Do not make it public.**
5. Disable public sign-ups in Auth settings. Accounts are created by an
   administrator; there is no self-registration path in this product.
6. Set the Site URL and redirect URLs to match `NEXT_PUBLIC_SITE_URL`.

---

## Database migrations

Forward-only SQL in `supabase/migrations/`, applied in filename order.

| File | Contents |
|---|---|
| `0001_foundation_schemas.sql` | Extensions, `audit` and `util` schemas, shared triggers |
| `0002_enums.sql` | Enumerated types |
| `0003_identity_and_tenancy.sql` | `business_units`, `users`, roles, permissions, `user_roles` |
| `0004_candidates.sql` | `candidates`, `candidate_internal_notes` |
| `0005_assignments_and_marketing.sql` | `candidate_assignments`, `marketing_periods` |
| `0006_documents.sql` | `document_types`, `documents` |
| `0007_audit.sql` | `audit.audit_logs`, generic audit trigger, `record_audit_event` |
| `0008_authz_helpers.sql` | `util.*` SECURITY DEFINER helpers |
| `0009_rls_policies.sql` | Row Level Security, per command, on every table |
| `0010_grants.sql` | Table privileges; `anon` gets nothing |
| `0011_storage.sql` | Private bucket and storage policies |
| `0012_reference_data.sql` | Roles, permissions, the role matrix, document types |
| `0013_applications_and_activities.sql` | `applications`, `application_status_history`, `marketing_activities`, visibility trigger |
| `0014_applications_rls.sql` | RLS and grants for the three new tables |
| `0015_application_automation.sql` | History and activity triggers, `candidate_counts`, `candidate_timeline` |
| `0016_build3_permissions.sql` | Application and activity permissions |
| `0017_status_change_rpc.sql` | Atomic `change_application_status` with an optional history note |
| `0018_interviews_and_assessments.sql` | `interviews`, `interview_schedule_history`, `assessments`, activity links |
| `0019_notifications.sql` | `notifications` with the dedupe key, `emit_notification`, `candidate_audience` |
| `0020_build4_rls.sql` | RLS and grants for the four new tables |
| `0021_build4_automation.sql` | Activity mirroring, schedule history, notification triggers, `reschedule_interview` |
| `0022_build4_permissions.sql` | Interview, assessment and document-download permissions |
| `0023_candidate_documents.sql` | Candidate upload — the single portal write path |

With the Supabase CLI:

```bash
supabase db push          # apply to the linked project
supabase db reset         # local: drop, re-apply migrations, run seed
```

Against a plain PostgreSQL instance:

```bash
npm run db:reset          # rebuilds a local scratch database from migrations + seed
```

`0011_storage.sql` and `0012_reference_data.sql` are idempotent, and
`0011_storage.sql` skips itself cleanly when the `storage` schema is absent, so
the same files run against Supabase and a bare PostgreSQL.

---

## Seed data

`supabase/seed/` — **development and demo only.** Every person is fictional and
no real candidate information appears anywhere in it.

| Who | Role | Email |
|---|---|---|
| Amara Osei | admin | `admin@demo.medinext.test` |
| Rosalind Vega | manager | `manager@demo.medinext.test` |
| Teodoro Salas | recruiter | `recruiter.salas@demo.medinext.test` |
| Ingrid Halvorsen | recruiter | `recruiter.halvorsen@demo.medinext.test` |
| Bianca Rossi | recruiter (other business unit) | `recruiter.rossi@demo.medinext.test` |
| Priya Raman | candidate portal | `priya.raman@demo.medinext.test` |
| Lucia Ferrari | candidate portal | `lucia.ferrari@demo.medinext.test` |

Password for every demo account: `DemoPass123!`

Six candidates and twelve applications across two business units, with
activities covering interviews, assessments, rejections, offers, follow-ups and
an internal note. The shape is chosen to make the permission model
**falsifiable**, not to look impressive:

- Salas is assigned Priya and Kwame; Halvorsen is assigned Lucia and Dmitri, so
  "a recruiter sees only their own" can fail.
- Naomi is assigned to nobody, so "a manager sees more than a recruiter" can fail.
- Two candidates have portal logins, so "candidate A cannot read candidate B"
  can fail.
- Hiroshi sits in a second business unit, so cross-tenant isolation can fail.
- Priya has one published and one internal-only document, so document visibility
  can fail.
- Two candidates with portal logins each have their own applications, so
  "candidate A cannot read candidate B's applications" can fail.
- One internal NOTE activity exists, so "a candidate can never read internal
  commentary" can fail.

Note what the seed does **not** insert: `application_submitted` activities,
`status_change` activities and every status-history row. Database triggers
produce those. If they are missing after a seed run, the automation is broken —
which is precisely what the seed should reveal.

---

## Authentication

Supabase Auth with cookie sessions via `@supabase/ssr`.

- `middleware.ts` refreshes the session and redirects anonymous visitors to
  `/sign-in`, preserving where they were going. It is a **redirect layer, not an
  authorization layer** — it knows only whether someone is signed in.
- `getActor()` resolves the acting user once per request, reading roles and
  permissions **from the tables rather than from JWT claims**. A JWT is a cache,
  and a revoked permission would otherwise live on inside an issued token until
  it expired.
- An auth identity with no profile row, or a non-`active` one, resolves to
  `null` so every downstream check fails closed.
- Sign-out is POST-only: a GET sign-out can be triggered by a prefetch or an
  `<img>` tag.
- The sign-in error is identical for a wrong password and an unknown address, so
  the form cannot be used to enumerate accounts.

---

## Role and permission model

Four roles: `admin`, `manager`, `recruiter`, `candidate`. **There is no sales
role and no sales functionality.**

A user may hold multiple *internal* roles. The `candidate` role is mutually
exclusive with all of them, enforced by a database trigger, so a portal account
cannot acquire internal reach laterally.

**Code checks capabilities, never role names.** The brief says a manager acts
"according to permissions", which means that boundary is expected to move.
Forty `if (role === 'manager')` checks make that a deploy; `can('report.view_all')`
makes it a seed row.

| Capability group | admin | manager | recruiter | candidate |
|---|:--:|:--:|:--:|:--:|
| View all candidates in unit | ✓ | ✓ | — | — |
| View assigned candidates | ✓ | ✓ | ✓ | — |
| Create candidates | ✓ | ✓ | — | — |
| Update candidates in scope | ✓ | ✓ | ✓ | — |
| Assign candidates | ✓ | ✓ | — | — |
| Manage marketing periods | ✓ | ✓ | ✓ | — |
| Upload documents | ✓ | ✓ | ✓ | — |
| Publish a document to the portal | ✓ | ✓ | — | — |
| View, create and update applications | ✓ | ✓ | ✓ | — |
| Delete an application | ✓ | ✓ | — | — |
| Schedule, reschedule and update interviews | ✓ | ✓ | ✓ | — |
| Record and update assessments | ✓ | ✓ | ✓ | — |
| Delete an interview or assessment | ✓ | ✓ | — | — |
| Download a candidate document | ✓ | ✓ | ✓ | own only |
| Upload a document | ✓ | ✓ | ✓ | own only |
| Record marketing activity | ✓ | ✓ | ✓ | — |
| Manage users, roles, permissions, audit | ✓ | — | — | — |
| Read across business units | ✓ | — | — | — |

The `candidate` role holds **no permissions at all**. Portal access is a
separate RLS path keyed on `candidates.user_id = auth.uid()`, so a mistake in
the permission matrix cannot grant a candidate internal data.

Recruiter scope is *current*, not historical: ending an assignment revokes
access immediately while the row is retained for audit.

---

## Security model

### The constraint that shapes everything

Supabase has three database roles — `anon`, `authenticated`, `service_role` —
and every logged-in user connects as `authenticated`. **`GRANT` therefore cannot
separate internal users from candidates.** All per-user separation comes from
RLS predicates, which makes RLS the mechanism rather than one layer among
several.

Consequences applied throughout:

- RLS is `ENABLE`d **and** `FORCE`d on every table, so a table with no matching
  policy returns zero rows rather than everything.
- Policies are written **per command**, never `FOR ALL` — which hides that
  `USING` gates reads and deletes while `WITH CHECK` gates writes.
- Helper calls are wrapped as `(select util.fn())` so Postgres evaluates them
  once per statement instead of once per row.
- `anon` holds no privileges on any table in `public`.
- The tenant gate lives *inside* `util.can_access_candidate()`, so every
  candidate-scoped table inherits business-unit isolation and cannot omit it.

### Candidate isolation

The most important guarantee in the system: a candidate can read their own
record and nothing else. It is asserted in both directions by the test suite,
along with the fact that a candidate cannot read internal notes about
themselves, cannot see who is assigned to them, and cannot enumerate staff.

### Audit

- Capture happens in **database triggers**, not application code. Application
  auditing always misses SQL functions, imports and admin corrections.
- `audit.audit_logs` is append-only, enforced by revoked grants and a trigger,
  **including against `service_role`**. No application path can rewrite history.
- Monthly range partitions with a `DEFAULT` partition, so a missing partition
  never causes a valid business write to fail.
- Updates that touch only `updated_at`/`updated_by` are not logged, so the trail
  stays readable.
- Non-row events (sign-in, export, service-role use) go through
  `public.record_audit_event()`.

### Storage

One private bucket. Path convention `{candidate_id}/{document_type}/{uuid}-{file}`,
with the first segment as the authorization key. A candidate can read a file
only if it is under their own candidate id **and** a staff member explicitly set
`visibility = 'candidate_visible'`. Uploading does not publish.

---

## Testing

Three suites, all runnable locally.

### 1. Database and RLS — the important one

Runs against a real PostgreSQL database with the real migrations, as the real
`authenticated` role, with real JWT claims. It is not a simulation of the
policies; it exercises them.

```bash
npm run db:test
```

292 assertions covering: anonymous access, role resolution, internal scope,
cross-tenant isolation, candidate isolation in both directions on candidates,
applications, activities, interviews, assessments, notifications, documents and
the timeline, internal-note isolation, storage-object authorization, write
authorization, audit capture and immutability, the automation that derives
history and activities, notification idempotency, cross-candidate attachment
attacks, derived counts, assignment and account lifecycle, and structural
guarantees generated from the catalogue (so a table added in a later build
fails the suite until it is classified), daily-report isolation between
recruiters and between units, the confirmed snapshot equalling the derived
figures, the review queue being invisible to candidates and undeletable, the
role-escalation guards, atomic candidate reassignment, and the ownership model:
that a supplied responsible recruiter is discarded rather than trusted, that
system- and email-created records still count towards the right recruiter, that
a reassignment does not rewrite historical attribution, and that a handover does
not erase the previous recruiter's own figures.

Where an assertion once hardcoded a count from the seed, it now compares the
RLS-filtered result against a superuser query implementing the intended rule.
That is both a stronger assertion and one that does not go stale as the seed
grows.

**Storage policies are executed, not assumed.** The local shim provides
`storage.buckets`, `storage.objects` and `storage.foldername`, so the real
policies from migrations 0011 and 0023 run against real rows. "Candidate A
cannot download candidate B's file" is an assertion, not a claim.

**Proving the suite can fail:**

```bash
bash scripts/db-mutation-test.sh
```

Twenty-two probes, each deliberately breaking one guarantee and asserting that a
named assertion catches it: candidate isolation on candidates, applications,
interviews, assessments, notifications and stored files; internal notes staying
out of the portal; notification idempotency; cross-candidate attachment;
daily-report privacy between recruiters; report figures being derived rather
than typed; the review queue staying internal; review history being
undeletable; a manager being unable to create an administrator; a user being
unable to change their own account status; and a transfer moving a candidate
rather than adding a second owner; report figures following responsibility
rather than keystrokes; ownership being derived rather than taken from the
payload; historical ownership surviving a reassignment; ownership being
uneditable after the event; a handover not erasing the previous recruiter's own
figures; and those figures staying private between recruiters.

A green suite that cannot go red is worthless. Several of these probes have
failed on first run, and every time they exposed a weak *test* rather than a
weak policy — most recently a section that was not re-runnable, so the second
pass aborted and silently dropped its assertions. Run this after any policy
change.

**One authorization condition, broken on purpose.** Build 5 asks for this
explicitly. Rewriting `daily_reports_select_own` to read

```sql
using ((select util.is_internal()) and recruiter_id is not null)
```

turns a recruiter's own-report policy into "every report in the unit". Three
assertions went red immediately:

```
 reports | recruiter Salas sees only their own reports           | expected 3, got 6
 reports | RECRUITER CANNOT READ THE REPORT OF ANOTHER RECRUITER | expected 0, got 1
 reports | cross-unit: EU manager cannot see the APAC report     | expected 0, got 1
```

Restoring `recruiter_id = (select auth.uid())` returned the suite to 253/253.

### 2. Unit tests

```bash
npm test
```

157 assertions over validation schemas, the config/SQL sync and the Build 5
and 5.1 guarantees — including that the TypeScript permission catalogue matches the SQL
seed, that the enums match, that no sales role exists in either place, that
nothing anywhere implements location-mismatch logic, that no schema or form
control accepts a report figure, that no review label or generated reason uses
accusatory language, that the role-escalation guards exist in the SQL, that no schema or command
accepts an owner from the caller, and that the portal never carries the
ownership column.

### 3. HTTP smoke test

```bash
npm run build && bash scripts/smoke-test.sh
```

Verifies at the request layer that every protected route refuses an
unauthenticated caller — including the Build 5 routes — that sign-out cannot be
triggered by a GET, and that the security headers are on the wire.

The script now stops its server **by port** rather than by command line.
`next start` execs a process whose title is `next-server (vX.Y.Z)`, so the old
`pkill -f` pattern never matched it: a stale server survived, held the port, and
the next run silently tested the previous build. The script also refuses to run
if it sees `EADDRINUSE`, because a green smoke test against the wrong build is
worse than a red one.

### What has been verified, and what has not

Verified by execution: RLS and candidate isolation, role resolution, write
authorization, audit creation and immutability, unauthorized access attempts,
validation, type checking, linting, architectural import boundaries, the
production build, and unauthenticated HTTP access.

**Not verified end to end:** interactive sign-in and sign-out against a live
Supabase project, and file upload/download through Storage. Both need Supabase
credentials this environment does not have. The logic is in place and the
policies are tested; the round trip is not.

---

## Development commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint, including the architectural boundaries |
| `npm test` | Unit tests |
| `npm run db:test` | Apply migrations + seed to a scratch DB and run the RLS suite |
| `npm run db:reset` | Rebuild a local scratch DB from migrations + seed |
| `npm run db:types` | Regenerate `src/types/database.ts` from a Supabase project |
| `npm run verify` | typecheck + lint + unit tests + database tests |

---

## Technical decisions

**Business-unit tenancy from the first migration.** Every business table carries
`business_unit_id NOT NULL` and the tenant gate is evaluated before any
permission or scope check. Adding this later would touch every table, policy,
query and row; adding it now cost one column and one predicate. V1 seeds a
single unit and the interface never mentions units until a second exists.

**Capabilities, not roles, at every call site.** Widening a role is a seed row.

**Permissions read from tables, not JWT claims.** One indexed query per request
removes the window where a revoked permission lives on inside an issued token.

**Assignments are a history, not a pointer.** Rows are never deleted. Ending one
revokes access immediately because every policy tests `ends_on IS NULL`, while
"who owned this candidate when X happened" stays answerable.

**Interfaces vs type aliases in `src/types/database.ts`.** Every shape there is
a `type` alias. Supabase constrains rows to `Record<string, unknown>`, and
TypeScript gives type aliases an implicit index signature but not interfaces —
declaring them as interfaces makes the whole schema silently resolve to `never`.

**`.select()` strings must be single literals.** Supabase infers the row shape
from the literal type, so `'a' + 'b'` widens to `string` and collapses the
result type. Long column lists are single-line constants for this reason.

**No caching of user-scoped data.** Next.js's data cache is global, not
per-user. Caching an RLS-scoped query would serve one user's candidates to
another, and it looks like a performance optimisation while you are writing it.
Both shells are `force-dynamic`; request-scoped `cache()` is used only for the
actor.

**Keyset pagination, not `OFFSET`.** Offset pagination degrades linearly and
skips or duplicates rows when the data changes between pages, which it will on a
board several recruiters are editing at once.

**Experience: empty means unknown, not zero.** `z.coerce.number()` turns `''`
into `0`, which would record a ten-year veteran as having no experience if the
field were left blank.

**Preferred locations are entered one per line, not comma separated.** Real
locations contain commas ("Manchester, UK"), and a comma-separated control
silently turns one location into two.

**Status history and activities are written by database triggers, not
application code.** Counts must be derived from records, and the guarantee has
to hold for every write path — including the email pipeline in a later build,
which is the path most likely to forget. A trigger cannot be forgotten by code
that does not know it exists.

**Only manually loggable activity types are offered in the UI.**
`application_submitted` and `status_change` are produced by the database.
Offering them by hand would let someone log an application that does not exist,
and the derived counts would stop matching the records they count.

**Internal notes cannot leak by omission.** A trigger forces
`activity_type = 'note'` to internal visibility regardless of what the caller
passes, so a missing argument at a call site cannot put staff commentary in
front of a candidate.

**Tenancy is resolved server-side, never accepted from a form.** Child records
read their `business_unit_id` from the candidate row under RLS. The composite
foreign key would reject a mismatch anyway, but a field that exists only to be
echoed back is a footgun.

**Interviews and assessments do not duplicate company or position.** Both are
derived from the application. Copying them onto the child record would create a
second place for the same fact to be wrong.

**Neither accepts a candidate id from the caller.** It is read from the
application server-side. A client-supplied candidate id could only ever agree
with that or be an attack, and the composite foreign key to
`applications(id, candidate_id)` makes a mismatch impossible at the database
level regardless.

**Notification idempotency is structural, not procedural.** Every notification
carries a `dedupe_key` describing the *event*, with a unique index per
recipient, and producers insert with `on conflict do nothing`. The email
pipeline in a later build will retry — a re-delivered message, a re-run
classifier, a restarted job — and this is what stops the first week of that
feature being noise.

**A trigger cannot leak an internal note.** Activity visibility is defaulted
from the activity type by a trigger that forces `note` to internal regardless of
what the caller passes.

**Download mints a signed URL rather than proxying bytes.** A 60-second URL and
a redirect, so résumés and identity documents never pass through the function's
memory or logs. Authorization is the database's: the metadata read and the
signing call both run under the caller's session, so RLS and the storage policy
each get a say.

**Uploaded file names are checked for path segments.** The name becomes part of
a storage key whose first segment is the authorization key, so a traversal
segment reaching it would place a file outside the candidate's own folder.

**Derived flags belong in the query layer.** `isUpcoming` and `isOverdue` are
computed once when the DTO is built, not recomputed in each page — two views
would otherwise be free to disagree, and reading the clock during render is
impure.

**Decision D-01 was narrowed, not abandoned.** The portal was strictly
read-only through Builds 2 and 3. Build 4 adds exactly one write path —
a candidate uploading their own document, at `candidate_visible` visibility
only, with no update or delete. Migration 0023 is the whole of that change, kept
in one file so the exception stays visible.

**Seed UUIDs must be RFC 4122 valid.** PostgreSQL accepts any 32 hex digits;
Zod's `.uuid()` enforces the version and variant nibbles. An id that Postgres
likes and Zod rejects passes every database test and then fails the first time a
real form submits it. A unit test now guards this.

**Placeholder pages instead of missing routes.** Build 2 is asked for the
navigation structure without the screens behind it. A link that 404s is worse
than one naming the build that delivers it.

**Architectural boundaries enforced by lint, not review.** Portal routes cannot
import internal data modules; routes and components cannot import service-role
code. Both were verified to actually fail a deliberate violation.

---

## Product rules

These are enforced, not merely documented:

1. **Not a sales CRM.** No sales role, no sales fields, no sales functionality.
   A test asserts no sales role exists in either the TypeScript config or the
   SQL.
2. **No payments.** Nothing financial anywhere in the schema.
3. **Preferred location is optional.** No `NOT NULL`, no minimum length, no
   default implying one is expected, and no workflow that treats a blank value
   as incomplete.
4. **No location-mismatch detection.** Nothing compares `preferred_locations`
   against `current_location` or against anything else. A test asserts the two
   columns never appear in the same expression.
5. **Email intelligence, AI and Hugging Face are future work.** Not present.
6. **Automated systems never silently overwrite historical records.** Audit is
   append-only against every role; assignments and status changes accumulate
   rather than being edited in place.
7. **Source data, interpretation and verified records stay separate.** Build 2
   contains verified records and history; the `ingest` and `staging` schemas are
   deliberately not created yet, and arrive with the builds that populate them.
8. **Candidate data is isolated at the database level**, not by frontend
   filtering.

---

## Known limitations

The list is renumbered here: it had drifted out of sequence as builds appended
to it, and item 11 ("interview and assessment creation has no UI form") is no
longer true — Build 5 delivers those forms.

1. **No live Supabase verification.** Interactive sign-in, sign-out and Storage
   round trips have not been executed against a real project. The RLS policies
   are verified against real PostgreSQL; the Supabase-hosted round trip is not.
2. **`src/types/database.ts` is hand-maintained.** The Supabase CLI is not part
   of this environment. Regenerate with `npm run db:types` once a project
   exists, and add a CI check that fails on a diff.
3. **Storage round trips are not executed against a live Supabase project.**
   The storage *policies* are executed locally against a shim and are asserted;
   the actual upload and signed-URL download call Supabase Storage and have not
   been exercised end to end here.
4. **The candidate portal is read-only apart from document upload** (decision
   D-01, narrowed by migration 0023).
5. **`visa_status` is free text.** Modelling it as an enum or lookup would mean
   inventing values the business has not supplied — open decision D-06.
6. **No rate limiting.** Planned for the build that adds portal invitations and
   exports.
7. **Marketing period creation has no UI.** The command, schema and policies
   exist and are tested; the form is not built. Periods are visible on the
   candidate's Marketing tab and in the seed.
8. **Notifications are in-app only.** `notification_deliveries` from the
   original architecture is not built; an email channel would slot in beneath
   the same producer.
9. **No pgTAP.** The RLS suite is plain SQL with a small assertion harness,
   which needs no extension and runs anywhere PostgreSQL does.
10. **Audit partitions are not auto-created.** `util.ensure_audit_partition()`
    exists and the `DEFAULT` partition catches everything meanwhile; a scheduled
    job should call it once monthly.
11. **Statuses are provisional.** The seven marketing statuses come from the
    Build 2 brief. Other status vocabularies await the workbook profiling
    exercise (open decision D-05).
12. **The review checks run on demand, not on a schedule.** `run_review_checks`
    is idempotent and safe to call repeatedly, and the Review Queue has a button
    for it. Wiring it to `pg_cron` is a deployment decision, not a code one.
13. **There is no user invitation flow.** Team administration can activate,
    suspend and disable existing accounts and change their roles; creating a new
    internal account still means creating the auth user in Supabase. The
    invitation flow belongs with the portal-invitation work.
14. **Records whose candidate had no primary recruiter are unattributed.**
    `responsible_recruiter_id` is NULL for them and they count towards nobody's
    report. This is deliberate — see "Who owns the work is not who typed it" —
    but it does mean assigning a recruiter late leaves earlier records
    unattributed until somebody with `candidate.assign` corrects them. There is
    no bulk re-attribution tool.
15. **Ownership is fixed at the event, including through a reschedule.** Moving
    an interview to a different day moves the figure to that day but leaves it
    with the recruiter who owned it when it was booked. Recomputing on every
    edit would let a reschedule quietly transfer somebody's work.
16. **A confirmed report cannot be reopened.** By design — confirmation freezes
    the figures. If a correction is genuinely needed, the current answer is a
    review item recording what changed, not an edit to the frozen snapshot.

---

## The two rules these builds exist to enforce

### 1. A daily report never accepts a number

If Dhrushil recorded 80 applications on 31 August, the report says 80 because
`public.daily_report_metrics` counted 80 rows. Dhrushil is asked for notes,
observations and exceptions — judgement the records cannot supply — and for
nothing else.

That is enforced in four independent places, so removing any one of them does
not open the door:

| Layer | What stops a typed figure |
|---|---|
| Schema | `DailyReportUpsertSchema` has no field for any count; an extra key is stripped by Zod before the command sees it. |
| Command | `upsertOwnDailyReport` writes `notes`, `observations` and `exceptions`. There is no code path that sets a snapshot column. |
| Database | The snapshot columns are written only by `confirm_daily_report`, which reads them from the metrics function in the same transaction. |
| Tests | `tests/build5.test.ts` asserts the schema shape, that only migration 0026 writes a snapshot column, and that no form control anywhere is named after a metric. |

The confirmed snapshot and the live count are both shown when they disagree.
Neither is edited to match the other: the snapshot is what was reported on the
day, the live count is what the records say now, and the difference is
information rather than an error.

### 2. Who owns the work is not who typed it

Build 5 counted `created_by`. That is only accidentally the same question, and
it comes apart the moment anything but the owning recruiter creates a record —
a manager entering an application on somebody's behalf, or, shortly, a pipeline
with no human actor at all.

So every marketing record now carries two independent facts:

| | Column | Answers |
|---|---|---|
| **Provenance** | `created_by`, `source_type`, `source_reference` | Who or what produced this row |
| **Ownership** | `responsible_recruiter_id` | Who was accountable for this candidate when it happened |

```
RESPONSIBLE RECRUITER   Dhrushil
CREATED BY              System
SOURCE                  From email
```

`candidate_assignments` is still the canonical ownership model; the column is a
materialisation of it, resolved at insert time from the assignment that was
active on the record's own business date, and then left alone. It is never
accepted from a caller: a BEFORE INSERT trigger overwrites whatever arrives, so
no client can attribute work to somebody else. Changing it afterwards needs
`candidate.assign`, which recruiters do not hold.

**Why stored rather than joined.** Deriving ownership live was the first design
and was rejected: reassigning a candidate would retroactively move every
historical record to the new recruiter and rewrite last month's figures. A
record created before a handover belongs to the recruiter who held the candidate
then, and only a stored value can say so.

**Why the metrics function is SECURITY DEFINER.** Access to a candidate follows
the *active* assignment, so a recruiter who has since handed a candidate on can
no longer read those rows — and their own historical figures silently fell to
zero. The function now authorises explicitly instead: your own figures always,
somebody else's only with `report.view_all` inside your business unit, anything
else refused. That is the same rule as the SELECT policies on `daily_reports`.

**What is deliberately not attributed.** Where the assignment history cannot
answer — a record whose candidate had no primary recruiter at the time — the
column is left NULL. Attributing it to its creator would be the exact
conflation being removed, and guessing would be worse than an honest gap. The
0030 backfill prints a count of any such rows.

---

## Next build

Build 6 has not been specified. The natural candidates, in the order the
architecture anticipates them:

- **Excel migration** (`docs/architecture/13-excel-migration.md`) — the `ingest`
  and `staging` schemas, and the importer that lands historical rows as
  `excel_import` source records awaiting verification.
- **Email intelligence** (`docs/architecture/10-email-intelligence.md`) — the
  pipeline the trigger-driven derivation and the review queue were designed to
  receive: source data, interpretation, and verified records kept separate.
  Build 5.1 is the precondition for it. A record arriving from an email has no
  human creator, and until the reports counted responsibility rather than
  keystrokes, every such record would have counted towards nobody. The
  attribution tests already simulate that pipeline; no mailbox is connected and
  no email code exists.
- **Portal invitations and rate limiting** — the remaining gap in account
  lifecycle.
