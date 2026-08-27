# MediNext Marketing OS — Architecture Overview

**Status:** Proposal, pending sign-off
**Stage:** Pre-implementation (no application code yet)
**Owner:** Architecture

---

## 1. What this system is

MediNext Marketing OS is an internal marketing operations platform for a recruitment /
candidate-management business. It replaces a manually maintained Excel workflow that tracks
how candidates are marketed to the job market and what happens to them at each step.

It is **not** a CRM in the sales sense. There are no deals, quotas, pipelines-to-revenue,
invoices, or payments. The unit of work is a *candidate being marketed over a period of time*,
and the records are the *facts of what happened* to that candidate: applications submitted,
recruiters who responded, interviews held, assessments issued, rejections, offers.

Two experiences ship from one system:

| Experience | Users | Nature |
|---|---|---|
| Internal Marketing CRM | Admin, Manager, Recruiter | High-density operational tooling |
| Candidate Portal | Candidate | Narrow, read-scoped, self-service view |

## 2. The organising principle

Everything in this architecture follows from one rule:

> **Source information, system interpretation, and verified business records are three
> separate layers. Interpretation never silently mutates the other two.**

This is not an abstract preference. It is the constraint that makes the future email
intelligence safe to build, and it is the reason the schema has more tables than a naive
translation of the spreadsheet would produce.

```
  LAYER 1 — SOURCES (append-only, never edited)
    ingest.emails, ingest.email_attachments, staging.import_rows, uploaded documents
    "This is what arrived. Byte for byte. It is never rewritten."
                              |
                              v
  LAYER 2 — INTERPRETATIONS (machine output, confidence-scored, non-authoritative)
    ingest.email_events, staging.import_rows.normalized
    "This is what we *think* the source means. It may be wrong. It has a confidence."
                              |
                    promotion gate (human or rule)
                    public.review_items
                              |
                              v
  LAYER 3 — VERIFIED RECORDS (the business truth, mutable only by attributable action)
    applications, interviews, assessments, rejections, offers, marketing_activities
    "This is what the business asserts happened. Every change has an actor."
                              |
                              v
  LAYER 4 — HISTORY (immutable, technical)
    audit.audit_logs, *_status_history tables
    "This is how layer 3 got to be the way it is. Nothing can rewrite it."
```

A record in layer 3 always knows where it came from (`created_source`, `created_source_id`,
plus `record_provenance` for field-level enrichment). Nothing in layer 2 can write to layer 3
except through an explicit promotion action that is itself audited.

## 3. Architectural non-negotiables

1. **Authorization lives in the database.** Row Level Security is the enforcement floor.
   The UI hides things for ergonomics, not for safety. A leaked candidate JWT pointed at the
   REST API must return the same rows the portal shows and nothing more.
2. **Candidate-visible rows contain no internal-only columns.** RLS is row-level, not
   column-level. If a candidate can read a row, they can read every column of it. Internal
   notes therefore live in sibling tables, never as a `notes` column on a shared row.
3. **Append-only where history matters.** Audit logs, status histories, sources, and
   assignments are inserted, never updated or deleted.
4. **Every mutation has an actor.** Human, system, or service — recorded, never null by
   accident.
5. **Multi-table writes are transactional.** Which has a specific consequence for the
   Supabase client (see [04 — Application Architecture](./04-application-architecture.md)).

## 4. Scope fence for V1

Explicitly **not** being built now, though the schema is shaped to accept them:

- Email ingestion or any mailbox connection
- Any AI / LLM classification
- Payments, billing, invoicing
- Sales/CRM functionality (leads, opportunities)
- Automatic job application submission
- WhatsApp or any messaging channel
- Native mobile apps

`ingest.emails` and `ingest.email_events` **are** designed and created in V1 because their
shape constrains the rest of the model. They stay empty until the ingestion phase.

## 5. Document map

| # | Document |
|---|---|
| 01 | [Domain Model & Relationships](./01-domain-model.md) |
| 02 | [Database Schema](./02-database-schema.md) |
| 03 | [Roles, Permissions & Authorization Model](./03-authorization-model.md) |
| 04 | [Application Architecture](./04-application-architecture.md) |
| 05 | [Security Model & RLS](./05-security-model.md) |
| 06 | [Folder Structure](./06-folder-structure.md) |
| 07 | [API & Server Action Structure](./07-api-and-server-actions.md) |
| 08 | [Candidate Portal Architecture](./08-candidate-portal.md) |
| 09 | [Internal CRM Architecture](./09-internal-crm.md) |
| 10 | [Email Intelligence Architecture (future)](./10-email-intelligence.md) |
| 11 | [Audit Logging Architecture](./11-audit-logging.md) |
| 12 | [Notification Architecture](./12-notifications.md) |
| 13 | [Excel Migration Strategy](./13-excel-migration.md) |
| 14 | [V1 Implementation Order](./14-implementation-plan.md) |
| 15 | [Open Decisions & Risks](./15-open-decisions-and-risks.md) |
|  — | [Design Language](../design/design-language.md) |

## 6. How to read this proposal

Anything marked **[DECISION NEEDED]** is a genuine fork where I do not have enough
information about your business process to choose without guessing, and where guessing wrong
is expensive to undo. These are collected in document 15. Everything else is a
recommendation I am prepared to defend and implement as written.

Anything marked **[PROPOSED ADDITION]** is a table or concept not in the original entity
list. I have flagged rather than silently added them.
