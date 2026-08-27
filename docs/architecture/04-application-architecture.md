# 04 — Application Architecture

## 1. Stack

| Concern | Choice | Note |
|---|---|---|
| Framework | Next.js (App Router) | React Server Components by default |
| Language | TypeScript, `strict: true` | plus `noUncheckedIndexedAccess` |
| Styling | Tailwind CSS | design tokens as CSS variables, see design doc |
| Components | shadcn/ui | vendored into the repo, restyled to MediNext tokens |
| Database | Supabase Postgres | RLS is the authorization boundary |
| Auth | Supabase Auth | cookie sessions via `@supabase/ssr` |
| Files | Supabase Storage | one private bucket |
| Validation | Zod | one schema per action, shared client/server |
| Forms | React Hook Form + zodResolver | progressive-enhancement friendly |
| Tables | TanStack Table (headless) | server-driven pagination and sorting |
| Dates | `date-fns` + `@date-fns/tz` | explicit time zones everywhere |
| Testing | Vitest, Playwright, pgTAP | unit / e2e / database policy |
| Hosting | Vercel | Node runtime for anything touching Supabase |

## 2. Runtime shape

```
Browser
  │
  ├── RSC payloads / HTML ──► Next.js on Vercel
  │                             ├── middleware      session refresh + coarse route guard
  │                             ├── server components ── read via user-scoped client (RLS)
  │                             ├── server actions   ── write via mutation pipeline
  │                             └── route handlers   ── file streams, exports, webhooks
  │                                     │
  │                                     ▼
  └── Supabase Realtime ◄──────── Supabase Postgres (RLS)
                                        │
                                  Supabase Storage (private)

   [ future ] Ingestion worker ──► ingest schema     (separate deployable, service role)
```

## 3. Three clients, three purposes

```ts
// src/lib/supabase/server.ts    — cookie-bound, runs AS THE USER, RLS applies.
export async function createServerSupabase() { /* @supabase/ssr createServerClient */ }

// src/lib/supabase/browser.ts   — client components: realtime + a few reads only.
export function createBrowserSupabase() { /* createBrowserClient */ }

// src/server/privileged/service-client.ts — service_role, BYPASSES RLS.
export async function withServiceRole<T>(
  ctx: ActorContext, reason: string, fn: (db: ServiceClient) => Promise<T>
): Promise<T>
```

`withServiceRole` is the only export from that module, it takes a mandatory human-readable
`reason`, and it writes an `audit.audit_logs` row before invoking the callback. There are
exactly four legitimate uses in V1: creating auth users for portal invites, executing Excel
imports, running the daily-report aggregation job, and system-generated notifications. Anything
else is a design smell and should be reviewed.

## 4. The transaction problem, and how we solve it

**This is the most consequential technical constraint in the stack, so it is worth stating
plainly.** `supabase-js` speaks to PostgREST over HTTP. Each call is its own transaction.
There is no `begin` / `commit` across calls.

That matters immediately: "record a rejection" must insert into `rejections`, transition
`applications.status`, append to `application_status_history`, write `record_provenance`, and
create a notification. Five statements. If statement three fails, the naive implementation
leaves a rejection with no status change and a corrupted timeline — precisely the class of
inconsistency this product exists to eliminate.

**Rule: any mutation touching more than one table is a Postgres function invoked via `rpc()`.**

```sql
create or replace function public.record_rejection(
  p_application_id uuid, p_stage rejection_stage, p_reason_code text,
  p_reason_text text, p_rejected_at timestamptz
) returns uuid
language plpgsql
security invoker            -- deliberately: RLS still applies to the caller
set search_path = public as $$
declare v_candidate_id uuid; v_old application_status; v_rejection_id uuid;
begin
  select candidate_id, status into v_candidate_id, v_old
    from public.applications where id = p_application_id
    for update;                       -- RLS-filtered; not-found means not permitted

  if not found then
    raise exception 'application not found or not permitted' using errcode = '42501';
  end if;

  insert into public.rejections (candidate_id, application_id, stage, reason_code,
                                 reason_text, rejected_at, created_by)
  values (v_candidate_id, p_application_id, p_stage, p_reason_code,
          p_reason_text, p_rejected_at, auth.uid())
  returning id into v_rejection_id;

  update public.applications
     set status = 'rejected', closed_at = now(), updated_by = auth.uid()
   where id = p_application_id;

  insert into public.application_status_history
    (application_id, from_status, to_status, changed_by, source)
  values (p_application_id, v_old, 'rejected', auth.uid(), 'manual');

  perform util.notify_candidate_owners(v_candidate_id, 'application_rejected', v_rejection_id);

  return v_rejection_id;
end $$;
```

`security invoker` is the key detail: the function runs with the caller's privileges, so RLS
filters `applications` exactly as it would for a direct query. The function gives us
atomicity **without** giving away authorization. A `SECURITY DEFINER` version here would be a
privilege-escalation hole.

Single-table writes stay as ordinary `supabase-js` calls — introducing an RPC for every insert
would be ceremony without benefit.

**Rejected alternative:** a direct Postgres connection (Drizzle/postgres.js over the pooler)
with `set local request.jwt.claims`. It gives ergonomic transactions in TypeScript, but it
means we now maintain the claim-injection code that Supabase otherwise maintains for us, and
one mistake in it silently disables RLS for every query on that connection. Not worth it for
a team this size. Revisit if the RPC count exceeds roughly thirty.

## 5. The mutation pipeline

Every write in the product goes through one wrapper. Uniformity means audit, validation and
error shape cannot be forgotten in a hurry.

```ts
export async function mutation<TIn, TOut>(cfg: {
  name: string;                     // 'application.create'
  permission: PermissionCode;
  schema: z.ZodType<TIn>;
  handler: (input: TIn, ctx: ActorContext) => Promise<TOut>;
  revalidate?: (input: TIn, out: TOut) => string[];   // cache tags / paths
}): (raw: unknown) => Promise<Result<TOut>>
```

Order of operations, always:

1. Resolve the actor from the session. No session → `UNAUTHENTICATED`.
2. Check `users.status = 'active'` and the token-freshness rule from doc 03 §5.
3. `requirePermission(cfg.permission)` against the tables, not the JWT claim.
4. Parse with Zod. Failure → typed field errors, never a stack trace.
5. Attach `app.actor_id` and `app.request_id` for the audit trigger.
6. Run the handler (single write, or one `rpc()` call).
7. Write provenance where the record supports it.
8. `revalidatePath` / `revalidateTag`.
9. Return a discriminated `Result` — `{ ok: true, data }` or `{ ok: false, code, message, fieldErrors? }`.

Server actions never throw to the client. Thrown errors become opaque digests in production,
which is useless for a form.

## 6. Data access layer

Route files contain no queries. Every read lives in a module under `src/server/modules/`,
exported as a named function with an explicit return type.

```
src/server/modules/applications/
  queries.ts    listApplications, getApplication, getApplicationTimeline
  commands.ts   createApplication, updateApplicationStatus, recordRejection
  schemas.ts    Zod schemas, shared with forms
  types.ts      DTOs — not raw row types
  mappers.ts    row → DTO
```

Three rules that keep this from rotting:

- **Queries return DTOs, not database rows.** A DTO is a deliberate contract; leaking rows
  means a column rename becomes a UI change and internal columns drift into candidate payloads.
- **No query selects `*`.** Explicit column lists, so adding a sensitive column is a decision
  rather than an accident.
- **Portal modules are physically separate** (`src/server/modules/portal/`) and query only
  `portal_*` views. A portal page cannot import an internal query module; ESLint enforces it.

## 7. Caching

Next.js's data cache is **global, not per-user**. Caching an RLS-scoped query keyed only by
its arguments will serve one user's candidates to another. This is the single most likely way
to produce a data-leak bug in this stack, and it looks like a performance optimisation while
you are writing it.

Rules:

- **Never** `unstable_cache` / `fetch` caching for user-scoped data.
- Request-level dedupe with React `cache()` is fine — its lifetime is one request.
- Reference data with no user scope (`roles`, `permissions`, lookup tables, `organizations`)
  may be cached with tags.
- Authenticated pages are dynamic; `export const dynamic = 'force-dynamic'` on both app
  shells, with static rendering reintroduced only where provably scope-free.

## 8. Realtime

Used narrowly: the notification bell, and the review-item queue count. Realtime respects RLS
when enabled per publication, so a candidate subscribing to `notifications` receives only
their own — but we still constrain the subscription server-side rather than relying on the
filter the client sends.

Not used for the main data tables. Live-updating a dense operational table under a user's
cursor is worse UX than a manual refresh, and it multiplies the connection cost for no gain.

## 9. Errors, observability, jobs

- One `AppError` type with a stable `code` (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`,
  `VALIDATION`, `RATE_LIMITED`, `INTERNAL`). The UI maps codes to copy; messages are never
  concatenated into user-facing strings from database output.
- `request_id` generated in middleware, threaded through logs and audit rows, surfaced in the
  UI error state so a support conversation can start with an identifier.
- Structured JSON logs, no PII (doc 05 §9).
- **Scheduled work** in V1: nightly daily-report aggregation, review-item SLA escalation,
  storage orphan reconciliation. Vercel Cron → an authenticated route handler with a shared
  secret. When ingestion arrives, it becomes a separate long-running deployable, not a Vercel
  function, because mailbox polling and LLM calls do not fit a serverless request budget.

## 10. Environments

`local` (Supabase CLI, seeded) → `preview` (per-PR Vercel, shared preview database) →
`production`. Migrations are SQL files in `supabase/migrations`, forward-only, applied in CI.
No migration is merged without a corresponding pgTAP policy test for any table it creates.
