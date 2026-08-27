# 07 — API & Server Action Structure

## 1. Choosing a mechanism

| Need | Mechanism |
|---|---|
| Read for a page | Server Component calling a `queries.ts` function directly |
| Mutation from a form | Server Action |
| File download | Route handler (streams, needs headers) |
| CSV / XLSX export | Route handler (streams, long-running, audited) |
| Cron job | Route handler with a shared-secret header |
| Future: mailbox webhook | Route handler with signature verification |
| Client-side incremental fetch | Route handler under `/api/internal/*` returning JSON |

There is **no general-purpose REST API in V1**. Supabase already exposes one, protected by
RLS; duplicating it in Next.js would double the surface to secure for no consumer. When an
external consumer appears, it gets a purpose-built, versioned, separately authenticated
endpoint — not a generic passthrough.

## 2. Server action contract

Actions are thin. They validate, delegate, and revalidate. Business logic lives in
`commands.ts`.

```ts
// src/app/(internal)/candidates/[candidateId]/applications/actions.ts
'use server';

export const createApplicationAction = mutation({
  name: 'application.create',
  permission: 'application.create',
  schema: ApplicationCreateSchema,
  revalidate: (input) => [
    `/candidates/${input.candidateId}/applications`,
    `/candidates/${input.candidateId}/timeline`,
  ],
  handler: (input, ctx) => applicationCommands.create(input, ctx),
});
```

### Result envelope

Every action returns the same discriminated union. No exceptions cross the boundary.

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string;
      fieldErrors?: Record<string, string[]>; requestId: string };

type ErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION'
  | 'CONFLICT' | 'PRECONDITION_FAILED' | 'RATE_LIMITED' | 'INTERNAL';
```

`FORBIDDEN` vs `NOT_FOUND` is a deliberate choice per resource: for records the user has no
business knowing exist, we return `NOT_FOUND`, because `FORBIDDEN` confirms existence. For
actions on records they can see, `FORBIDDEN` is clearer and better UX.

### Idempotency

Actions that create records accept an optional `idempotencyKey`. The command stores it on the
record and retries return the original result instead of a duplicate. This matters for double
submits on slow connections, and it matters much more later when the ingestion pipeline
replays events.

### Rate limiting

Applied to authentication, portal invites, exports and search. Fixed-window counters in
Postgres in V1 — an extra dependency is not justified at this volume, and the counters are
themselves auditable.

## 3. Actor context

Resolved once per request, passed explicitly. Nothing reads the session from a global.

```ts
type ActorContext = {
  userId: string;
  roles: RoleCode[];
  permissions: Set<PermissionCode>;
  candidateId: string | null;   // set only for portal users
  requestId: string;
  ip?: string;
  userAgent?: string;
};
```

Explicit passing over `AsyncLocalStorage`: it makes every command's dependencies visible in
its signature, and it makes commands trivially unit-testable with a fabricated actor.

## 4. Query conventions

All list queries share a shape so tables, filters and URLs behave identically everywhere.

```ts
type ListParams<TFilters, TSort extends string> = {
  filters: TFilters;
  sort: { field: TSort; dir: 'asc' | 'desc' };
  cursor?: string;      // keyset
  limit: number;        // default 25, max 100
};

type ListResult<T> = { items: T[]; nextCursor: string | null; totalEstimate?: number };
```

**Keyset pagination, not `OFFSET`.** Offset pagination degrades linearly and, worse, skips
and duplicates rows when data changes between pages — which it constantly will on an
operational board that several recruiters are editing at once. The cursor encodes the sort
field plus the id tiebreaker.

Exact counts are not returned by default. `count: 'exact'` forces a full scan through the RLS
predicate on every page load. The UI shows "25 of many" with an on-demand exact count, or an
`estimated` count from statistics.

Filter state lives in URL search params, parsed by one shared Zod schema per list. Shareable
links, working back button, no client filter store.

## 5. Route handlers

```
src/app/api/
├── documents/[documentId]/download/route.ts   permission + scope check → signed URL redirect
├── exports/candidates/route.ts                streamed CSV, audited with row count
├── cron/aggregate-daily-reports/route.ts      shared-secret header
├── cron/escalate-review-items/route.ts
└── health/route.ts                            no auth, no data
```

Every handler: `runtime = 'nodejs'`, explicit `Cache-Control: private, no-store`, actor
resolution before anything else, and structured logging with the `request_id`.

Download handlers never proxy file bytes through the app. They verify, mint a 60-second signed
URL, and redirect. Proxying would put candidate résumés through the serverless function's
memory and logs for no benefit.

## 6. Validation

One Zod schema per operation, in `schemas.ts`, imported by both the form (client) and the
action (server). The server **always** re-validates — client validation is a UX affordance.

Rules encoded in schemas rather than prose: `applied_at` is not in the future; `ends_on >=
starts_on`; `score <= max_score`; email is `citext`-normalised lowercase and trimmed before it
reaches the database. Where a rule is also a data integrity invariant it is *additionally* a
database constraint, per doc 02. Duplicating a rule between Zod and Postgres is intentional:
Zod produces the good error message, Postgres produces the guarantee.

## 7. Type generation

```
npm run db:types    # supabase gen types typescript --local > src/types/database.ts
```

Committed, and CI fails if regenerating produces a diff. That check is what stops the
TypeScript model and the actual schema from drifting apart, which is the failure mode that
makes generated types feel untrustworthy and leads teams to abandon them.
