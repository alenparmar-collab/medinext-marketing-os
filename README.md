# MediNext Marketing OS

Marketing operations platform for candidate marketing. Replaces an Excel-based
workflow with an auditable system, and gives each candidate a portal showing
only their own information.

**Current stage: Build 3 — candidate marketing core.** The foundation from
Build 2 plus applications, marketing activities, the candidate timeline,
internal notes and a candidate portal that shows a candidate their own
applications and activity. Interviews, assessments, daily reports,
notifications and the review queue remain navigation only.

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
| Interviews, assessments, daily reports, notifications, review queue | Navigation only |
| Document upload and download | Metadata and policies only — no file transfer yet |
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

121 assertions covering: anonymous access, role resolution, internal scope,
cross-tenant isolation, candidate isolation in both directions on candidates,
applications, activities and the timeline, internal-note isolation, document
authorization, write authorization, audit capture and immutability, the
automation that derives history and activities, derived counts, assignment and
account lifecycle, and structural guarantees generated from the catalogue (so a
table added in a later build fails the suite until it is classified).

**Proving the suite can fail:**

```bash
bash scripts/db-mutation-test.sh
```

Three probes, each deliberately breaking one guarantee — candidate isolation on
the candidate record, candidate isolation on applications, and internal notes
staying out of the portal — and asserting that a named assertion catches it. A
green suite that cannot go red is worthless; run this after any policy change.

### 2. Unit tests

```bash
npm test
```

59 assertions over validation schemas and the config/SQL sync — including that
the TypeScript permission catalogue matches the SQL seed, that the enums match,
that no sales role exists in either place, and that nothing anywhere implements
location-mismatch logic.

### 3. HTTP smoke test

```bash
npm run build && bash scripts/smoke-test.sh
```

Verifies at the request layer that every protected route refuses an
unauthenticated caller, that sign-out cannot be triggered by a GET, and that the
security headers are on the wire.

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

1. **No live Supabase verification.** Interactive sign-in, sign-out and Storage
   round trips have not been executed against a real project. The RLS policies
   are verified against real PostgreSQL; the Supabase-hosted round trip is not.
2. **`src/types/database.ts` is hand-maintained.** The Supabase CLI is not part
   of this environment. Regenerate with `npm run db:types` once a project
   exists, and add a CI check that fails on a diff.
3. **Document upload and download are not implemented.** The table, policies,
   bucket and storage path convention exist; the file transfer does not. The
   portal says so rather than listing a file it cannot serve.
4. **The candidate portal is read-only** (decision D-01). Candidates hold SELECT
   policies and nothing else, on any table.
5. **`visa_status` is free text.** Modelling it as an enum or lookup would mean
   inventing values the business has not supplied — open decision D-06.
6. **No rate limiting.** Planned for the build that adds portal invitations and
   exports.
7. **Marketing period creation has no UI.** The command, schema and policies
   exist and are tested; the form is not built. Periods are visible on the
   candidate's Marketing tab and in the seed.
8. **No pgTAP.** The RLS suite is plain SQL with a small assertion harness,
   which needs no extension and runs anywhere PostgreSQL does.
9. **Audit partitions are not auto-created.** `util.ensure_audit_partition()`
   exists and the `DEFAULT` partition catches everything meanwhile; a scheduled
   job should call it once monthly.
10. **Statuses are provisional.** The seven marketing statuses come from the
    Build 2 brief. Other status vocabularies await the workbook profiling
    exercise (open decision D-05).

---

## Next build

Build 4, per the plan in
[`docs/architecture/14-implementation-plan.md`](./docs/architecture/14-implementation-plan.md):
interviews and assessments as first-class records (currently they exist only as
activity types), promoted from `marketing_activities` into their own tables with
scheduling, reschedule history and outcomes — plus notifications, and the
document upload and download flow.
