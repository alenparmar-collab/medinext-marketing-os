# 06 — Folder Structure

## 1. Shape

```
medinext-marketing-os/
├── docs/
│   ├── architecture/                 this proposal
│   └── design/                       design language, tokens
├── supabase/
│   ├── migrations/                   forward-only, timestamped SQL
│   ├── seed/                         roles, permissions, lookup tables, dev fixtures
│   ├── functions/                    SQL function definitions (kept readable, not inlined)
│   ├── policies/                     RLS policies, one file per table
│   └── tests/                        pgTAP suites
├── src/
│   ├── app/
│   │   ├── (auth)/                   sign-in, invite acceptance, password reset
│   │   ├── (internal)/               INTERNAL CRM — internal roles only
│   │   ├── (portal)/                 CANDIDATE PORTAL — candidate role only
│   │   ├── api/                      route handlers (downloads, exports, cron)
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                       shadcn primitives, MediNext-restyled
│   │   ├── patterns/                 composed app patterns (DataTable, PageHeader, …)
│   │   └── icons/
│   ├── server/
│   │   ├── auth/                     session, actor context, permission checks
│   │   ├── modules/                  data access, one directory per domain
│   │   ├── privileged/               service-role only — import boundary enforced
│   │   ├── notifications/
│   │   └── audit/
│   ├── lib/
│   │   ├── supabase/                 the three clients
│   │   ├── validation/               shared Zod primitives
│   │   ├── format/                   dates, names, numbers, time zones
│   │   └── utils/
│   ├── types/
│   │   ├── database.ts               generated — never edited by hand
│   │   └── domain.ts                 DTOs, enums, branded ids
│   ├── config/                       navigation, permissions catalogue, statuses
│   ├── hooks/
│   └── middleware.ts
├── e2e/                              Playwright, one spec per role
└── scripts/                          type generation, import CLI, checks
```

## 2. Route groups

Two shells with different layouts, navigation, guards and data paths. They share primitives
from `components/ui` and nothing else.

```
src/app/(internal)/
├── layout.tsx                        sidebar shell; asserts internal role
├── dashboard/page.tsx
├── candidates/
│   ├── page.tsx                      list + filters (search params as state)
│   ├── new/page.tsx
│   └── [candidateId]/
│       ├── layout.tsx                candidate header + tab nav; loads once
│       ├── page.tsx                  overview
│       ├── timeline/page.tsx
│       ├── marketing/page.tsx        periods + activities
│       ├── applications/page.tsx
│       ├── interviews/page.tsx
│       ├── assessments/page.tsx
│       ├── offers/page.tsx
│       ├── documents/page.tsx
│       └── notes/page.tsx            internal-only
├── applications/page.tsx             cross-candidate pipeline view
├── interviews/page.tsx               schedule view
├── reports/
│   ├── page.tsx                      my daily reports
│   ├── new/page.tsx
│   └── team/page.tsx                 report.view_all
├── review/
│   ├── page.tsx                      review queue
│   └── [reviewItemId]/page.tsx
├── organizations/                    [PROPOSED ADDITION]
├── notifications/page.tsx
└── admin/
    ├── users/page.tsx
    ├── roles/page.tsx
    ├── lookups/page.tsx
    ├── imports/page.tsx
    └── audit/page.tsx

src/app/(portal)/
├── layout.tsx                        minimal shell; asserts candidate role
├── page.tsx                          my status
├── applications/page.tsx
├── interviews/page.tsx
├── assessments/page.tsx
├── offers/page.tsx
├── documents/page.tsx
├── timeline/page.tsx
└── profile/page.tsx                  read-only in V1 pending D-01
```

The route groups mirror the security boundary. `(portal)` pages import only from
`src/server/modules/portal/`. That is checked by lint rather than left to discipline:

```jsonc
// eslint no-restricted-imports, illustrative
{ "zones": [
  { "target": "./src/app/(portal)", "from": "./src/server/modules",
    "except": ["./portal"],
    "message": "Portal routes must query portal modules only." },
  { "target": "./src/app", "from": "./src/server/privileged",
    "message": "Service-role code may not be imported from routes." }
]}
```

## 3. Module layout

Every domain module is the same five files. Sameness is the point — a new engineer opens any
module and already knows where the query is.

```
src/server/modules/applications/
├── queries.ts     reads; returns DTOs; no `select('*')`
├── commands.ts    writes; each wrapped in the mutation pipeline
├── schemas.ts     Zod; imported by both the action and the form
├── types.ts       DTOs and view models
└── mappers.ts     row → DTO
```

Domains: `candidates`, `assignments`, `marketing`, `applications`, `interviews`,
`assessments`, `rejections`, `offers`, `responses`, `documents`, `reports`, `notifications`,
`review`, `organizations`, `users`, `audit`, `timeline`, `portal`.

## 4. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Component files | PascalCase | `CandidateStatusBadge.tsx` |
| Route files | Next.js reserved names | `page.tsx`, `layout.tsx` |
| Server modules | camelCase | `queries.ts`, `commands.ts` |
| Server actions | `<verb><Noun>Action` | `createApplicationAction` |
| Zod schemas | `<Noun><Verb>Schema` | `ApplicationCreateSchema` |
| DB types | generated | `Database['public']['Tables']['applications']['Row']` |
| Branded ids | `<Noun>Id` | `type CandidateId = string & { __brand: 'CandidateId' }` |

Branded ids are worth the small friction: passing an `applicationId` where a `candidateId`
belongs is otherwise a compiling bug, and in this schema those two are adjacent on nearly
every function signature.

## 5. Configuration as data

`src/config/` holds the things that change more often than code:

- `navigation.ts` — nav trees per shell, each entry tagged with a required permission so the
  sidebar filters itself from one source of truth.
- `permissions.ts` — the permission code union, generated from the seed so TypeScript and the
  database cannot disagree.
- `statuses.ts` — status enums with label, tone and ordering; the only place a status colour
  is decided.
