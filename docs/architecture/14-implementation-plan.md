# 14 — V1 Implementation Order

## 1. Sequencing principle

Build in the order that **retires risk**, not the order that produces screenshots. The
expensive mistakes in this system are schema shape and authorization; both are hardest to
change once real data exists. So: schema and RLS first, verified by tests before any screen is
built.

The second principle: **every stage ends with something usable**. No stage is a pure
refactor with nothing to show, because that is how a staged plan quietly becomes a big-bang
one.

Estimates below are engineering effort for a small team, exclusive of review cycles and the
Excel profiling exercise, which is a business dependency (doc 13 §2).

---

## Stage 0 — Foundations
*Nothing user-visible. Everything downstream depends on it.*

- Next.js + TypeScript strict + Tailwind + shadcn/ui, vendored and restyled to MediNext tokens
- Design tokens, typography scale, dark/light, app shell skeleton
- Supabase project, three environments, migration and seed workflow
- Auth wiring: `@supabase/ssr`, cookie sessions, middleware, sign-in
- `users`, `roles`, `user_roles`, `permissions`, `role_permissions` + seeds
- Helper functions (`util.*`), custom access token hook
- Audit schema, generic trigger, partition job
- Mutation pipeline, `ActorContext`, `Result` envelope, error handling
- CI: typecheck, lint, generated-types drift check, key-leak grep, pgTAP harness

**Exit:** a user signs in, lands on an empty shell, sees only the nav their permissions allow;
a pgTAP suite runs green in CI.

**~2 weeks.**

---

## Stage 1 — Candidates
*The spine. Everything else references it.*

- `candidates`, `candidate_profiles`, `candidate_assignments`, `candidate_internal_notes`
- Full RLS for all four roles, with the pgTAP matrix
- Candidate list: search, filters, keyset pagination, saved views
- Candidate create / edit / archive
- Candidate detail shell with tab layout, Overview tab
- Assignment management, assignment history
- Internal notes
- `DataTable`, `PageHeader`, `StatusBadge`, `EmptyState`, `FilterBar` patterns

**Exit:** the business can manage its candidate roster in the product.

**~2.5 weeks.**

---

## Stage 2 — Marketing & applications
*The workflow the spreadsheet actually is.*

- `marketing_periods` with the overlap constraint
- `marketing_activities` + activity type lookup
- `organizations`, `organization_contacts` (subject to approval, doc 01 §4.8)
- `applications` + `application_status_history` + status transition RPC
- `recruiter_responses`
- Marketing tab, Applications tab, cross-candidate applications board
- Timeline view (the union view from doc 02 §14)

**Exit:** a recruiter can run a full marketing period without touching Excel.

**~3 weeks.**

---

## Stage 3 — Pipeline outcomes
- `interviews` + `interview_schedule_history` + reschedule/cancel as first-class actions
- `assessments`
- `rejections` (with the `record_rejection` RPC from doc 04 §4)
- `offers`
- Interview schedule screen with time-zone handling
- Notifications table + bell + in-app delivery + the internal catalogue

**Exit:** the entire candidate journey is recordable end to end.

**~2.5 weeks.**

---

## Stage 4 — Documents
- Private bucket, storage RLS, path convention
- Upload with checksum, versioning, `supersedes_document_id`
- Visibility control (`internal` / `candidate_visible`) as a permissioned action
- Signed-URL download route + `document_download` auditing

**Exit:** résumés live in the system rather than in inboxes.

**~1.5 weeks.**

---

## Stage 5 — Reports & review queue
- `daily_reports`, `daily_report_entries` with system-derived counts and override reasons
- Nightly aggregation cron
- My reports, team reports, lock action
- `review_items` and the review queue UI, seeded initially by system consistency checks
  (orphaned records, stale applications, duplicate suspicions) — this is how the queue earns
  its keep before ingestion exists
- Report and review notifications

**Exit:** managers get their daily picture; the review workflow is proven with real items
before any machine ever writes to it.

**~2 weeks.**

---

## Stage 6 — Excel migration
- Import UI, staging schema, mapping function
- Normalisation, identity resolution, dry run, reconciliation report
- Rollback tooling, tested
- Full rehearsal against a production-shaped copy
- **Go-live cutover** (doc 13 §10)

**Exit:** the spreadsheet is read-only. This is the real launch.

**~2.5 weeks**, plus business time for P0/P1 and the review queue in P6.

---

## Stage 7 — Candidate portal
- Portal shell, guards, `portal_*` views, portal modules
- All portal screens (doc 08 §3), read-only
- Portal invite / revoke flow
- Candidate notification subset
- A **dedicated portal security review** and a penetration pass against the REST API using a
  real candidate token

**Exit:** candidates can see their own status. Support load drops.

**~2 weeks.**

---

## Stage 8 — Hardening
- Performance pass: RLS predicate profiling, index review under realistic volume
- Accessibility audit against WCAG 2.1 AA
- Full pgTAP coverage review; Playwright suites per role
- Runbooks: backup/restore rehearsal, incident response, permission-change procedure
- Admin: audit search UI, lookup management, user administration polish

**~1.5 weeks.**

---

## 2. Deliberately after V1

Email intelligence stage E0 (capture only) is the first post-V1 project, and it should not
start until the review queue has been in daily use for a while — the queue's ergonomics decide
whether ingestion is a help or a burden, and that is better learned on system-generated items
than on a live mailbox.

Then E1 → E3 per doc 10 §4. Email notification channel. Analytics and vendor performance
reporting. Everything else on the "not now" list stays there until asked for.

## 3. Critical path and dependencies

```
Stage 0 ──► 1 ──► 2 ──► 3 ──► 4
                  └────► 5 ──► 6 (go-live)
                                 └► 7 ──► 8
```

The genuine external dependency is **Excel profiling (doc 13 P0–P1)**, which gates the final
status enums in Stage 2 and the whole of Stage 6. Start it during Stage 0. If it slips, Stage
2 ships with provisional enums and pays for a migration later — an avoidable cost, and the
single most useful thing the business can do early.

Roughly **17–18 weeks** to a candidate-portal-complete V1, with go-live at the end of Stage 6
around week 14.
