# MediNext Marketing OS

Internal marketing operations platform for candidate marketing — replacing an Excel-based
workflow with an auditable system, and adding a candidate-facing portal.

**Current stage: architecture proposal. No application code yet.**

## Start here

- [Architecture Overview](./docs/architecture/00-overview.md) — what this is and the principle
  everything follows from
- [Open Decisions & Risks](./docs/architecture/15-open-decisions-and-risks.md) — what we need
  answered before coding
- [V1 Implementation Order](./docs/architecture/14-implementation-plan.md) — the staged plan

## Full document set

| # | Document |
|---|---|
| 00 | [Overview](./docs/architecture/00-overview.md) |
| 01 | [Domain Model & Relationships](./docs/architecture/01-domain-model.md) |
| 02 | [Database Schema](./docs/architecture/02-database-schema.md) |
| 03 | [Roles, Permissions & Authorization](./docs/architecture/03-authorization-model.md) |
| 04 | [Application Architecture](./docs/architecture/04-application-architecture.md) |
| 05 | [Security Model](./docs/architecture/05-security-model.md) |
| 06 | [Folder Structure](./docs/architecture/06-folder-structure.md) |
| 07 | [API & Server Actions](./docs/architecture/07-api-and-server-actions.md) |
| 08 | [Candidate Portal](./docs/architecture/08-candidate-portal.md) |
| 09 | [Internal CRM](./docs/architecture/09-internal-crm.md) |
| 10 | [Email Intelligence (future)](./docs/architecture/10-email-intelligence.md) |
| 11 | [Audit Logging](./docs/architecture/11-audit-logging.md) |
| 12 | [Notifications](./docs/architecture/12-notifications.md) |
| 13 | [Excel Migration Strategy](./docs/architecture/13-excel-migration.md) |
| 14 | [V1 Implementation Order](./docs/architecture/14-implementation-plan.md) |
| 15 | [Open Decisions & Risks](./docs/architecture/15-open-decisions-and-risks.md) |
| — | [Design Language](./docs/design/design-language.md) |

## The organising principle

Source information, system interpretation, and verified business records are three separate
layers. Interpretation proposes; humans dispose; history is never rewritten. Authorization is
enforced in the database, not the interface.

## Scope fence for V1

Not being built now: email ingestion, AI/LLM processing, payments, sales functionality,
automatic job applications, WhatsApp, mobile apps.

The `ingest` schema is designed and created in V1 because its shape constrains the rest of the
model, but it stays empty until the ingestion phase.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Supabase (Postgres, Auth,
Storage) · Vercel.
