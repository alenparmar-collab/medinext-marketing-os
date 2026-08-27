# 15 — Open Decisions & Risks

## Part A — Decisions needed before coding

These are genuine forks. Each is either expensive to reverse later, or the answer depends on
business facts I do not have and should not guess. They are ordered by how much they cost if
we get them wrong.

---

### D-13 — Is this ever multi-entity? **(highest cost to retrofit)**
Does MediNext operate as one business unit, or will separate branches, regions or partner
companies need their data separated from each other inside this system?

Adding a tenant boundary later means touching every table, every policy, every query and every
existing row. Adding it now costs one column and one predicate.

- **If single-entity (assumed default):** proceed as designed. No tenant column.
- **If multi-entity ever:** add `organization_unit_id` to every business table in Stage 0 and
  include it in every RLS predicate from the first migration.

**My recommendation:** if there is any realistic chance within two years, add it now. It is the
cheapest insurance in this document.

---

### D-05 — What are the real statuses?
Every status enum in doc 02 is a placeholder: `candidate_status`, `application_status`,
`interview_status`, `assessment_status`, `offer_status`, `marketing_period_status`.

These must come from the actual spreadsheet — the values people really use, not the values the
process document says they use. Wrong enums mean either a data migration or, worse, staff
inventing workarounds inside a `notes` field.

**Blocks:** Stage 2, Stage 6. **Answered by:** the doc 13 P0 profiling exercise.

---

### D-01 — Is the candidate portal read-only?
The brief says candidates "see only their own information," which reads as read-only, but does
not say so explicitly.

Options: (a) strictly read-only; (b) profile edits only, which then need staff review; (c)
document upload allowed; (d) interview confirmation / availability responses.

Each write path adds validation, review workflow and abuse surface. **Recommendation: (a) for
V1**, revisit after real usage. Additive later; painful to withdraw.

---

### D-02 — How much does the portal show?
Specifically: do candidates see rejections and their reasons? Do they see every application,
including ones that went nowhere? Do they see the client company name, or only the role?

This is a duty-of-care and commercial question. Rejection reasons written as internal shorthand
are often blunt; client names are sometimes commercially sensitive between vendors.

**Recommendation:** show applications, interviews, assessments and offers; hide rejection
reasons and vendor identities in V1. Cheap to widen once real reactions are known.

---

### D-03 — Where exactly does the recruiter's authority end?
Marked cells in the doc 03 matrix. Concretely: may a recruiter create a candidate, or only
update assigned ones? May they archive? May they resolve review items or only view them? May
they see other recruiters' candidates read-only, or not at all?

**Recommendation:** the conservative reading in doc 03, widened after observing real friction.
Each is a single seed row.

---

### D-04 — Are managers org-wide or team-scoped?
Currently modelled as org-wide. If managers should only see their own team's recruiters and
those recruiters' candidates, we need a team structure (`teams`, `team_members`) and a third
scope branch in `util.can_access_candidate()`.

Retrofitting this touches every policy, so it is worth deciding now even if the answer is "not
yet."

---

### D-06 — Which candidate fields are actually required?
`candidate_profiles` is deliberately thin. Work authorisation, visa status, rate expectations,
availability, and similar fields are legally and commercially sensitive, and I will not invent
them. The full list must come from the spreadsheet, along with which are mandatory and who may
see each one.

Some may need to be internal-only, which per doc 05 §3 means a **separate table**, not a
column.

---

### D-07 — Can a candidate have overlapping marketing periods?
Doc 02 adds an exclusion constraint preventing overlap. If parallel tracks are legitimate
(different skill streams, different vendors), the constraint must be dropped and
`applications.marketing_period_id` becomes an explicit user choice rather than an inferred one.

**Recommendation:** keep the constraint unless there is a known case. It catches a common
data-entry error.

---

### D-08 — Do we store compensation?
Offers currently carry only `compensation_note` free text. Structured pay (amount, currency,
rate type, per-hour vs annual) is more useful for reporting but is sensitive, and payments are
explicitly out of scope.

If yes: structured columns plus a `offer.view_compensation` permission, and it must be excluded
from the portal views. **Recommendation:** free text in V1 unless reporting needs it now.

---

### D-09 — Is MFA mandatory for internal users?
Recommended for `admin` at minimum. Mandating it for all internal users is a small enrolment
friction and a large reduction in credential-stuffing risk for a system holding this much PII.

**Recommendation:** mandatory for admin and manager, optional for recruiter in V1.

---

### D-10 — Retention and erasure
How long do we keep candidate data after they go inactive? What happens on an erasure request,
given an append-only audit log?

The standard resolution is PII tombstoning in layer 1 with the audit record shape preserved,
or crypto-shredding. Both need to be designed before email ingestion stores full message
bodies. Needs a legal answer, not an engineering one.

**Blocks:** email ingestion. **Does not block:** V1.

---

### D-11 — How do candidates authenticate?
Magic link only, or magic link plus password? Magic links avoid password handling entirely and
suit infrequent access; passwords suit candidates checking daily on a shared device where
inbox access is awkward.

**Recommendation:** magic link for invitation, password optional afterwards.

---

### D-12 — What are the SLA thresholds?
"Application with no response after N days," "review item overdue after N hours," "daily report
missing after HH:MM." These drive dashboard queues and notifications and are pure business
rules. Placeholders will be wrong.

---

### D-14 — Approval for the proposed additions
Two tables sit outside the entity list you provided: `organizations` and
`organization_contacts` (doc 01 §4.8). They are what makes vendor identification and
third-party recruiter tracking possible later, and what stops client names from being
unmatchable free text.

Also proposed beyond the list: `record_provenance`, `application_status_history`,
`interview_schedule_history`, `candidate_internal_notes`, `notification_deliveries`, and the
lookup tables. Each is justified in place. Flagging them all here rather than adding them
quietly.

---

## Part B — Risks

### R-1 — RLS performance at scale *(likely, moderate impact)*
Every query carries a policy predicate. Naive policies that call a function per row are
catastrophic on large scans.
**Mitigation:** `(select util.fn())` wrapping everywhere; the partial index on active
assignments; `STABLE` helper functions; load testing with 50 000 candidates in Stage 8;
`EXPLAIN` reviewed on every list query before it merges.

### R-2 — Spreadsheet data is worse than expected *(near-certain, high impact)*
Every spreadsheet migration finds inconsistent dates, merged cells, colour-as-data, personal
side copies and columns whose meaning changed silently two years ago.
**Mitigation:** the staged pipeline exists precisely for this; P0 profiling early; budget the
review phase generously. **Do not compress P5–P6.**

### R-3 — Users go back to Excel *(moderate likelihood, fatal impact)*
If the product is slower for daily entry than the spreadsheet, it loses, regardless of its
other merits.
**Mitigation:** keyboard-first design; density; pre-populated daily reports; bulk actions; a
recruiter using the tool during Stages 1–3, not only at UAT. If a recruiter cannot log a full
day's work faster than in Excel, that is a release blocker.

### R-4 — Status model churn *(moderate, moderate)*
Statuses chosen before D-05 is answered will change, and status changes ripple into history
tables, filters and reports.
**Mitigation:** answer D-05 before Stage 2; keep statuses in `config/statuses.ts` and enum
types with an explicit widening migration pattern; do not build the Kanban board until settled.

### R-5 — Caching leaks user-scoped data *(low likelihood, severe impact)*
Next.js's data cache is global. One `unstable_cache` around a scoped query is a cross-account
leak that looks like an optimisation in review.
**Mitigation:** doc 04 §7 rules; a lint rule banning `unstable_cache` outside an allowlist;
covered explicitly in the Stage 7 security review.

### R-6 — Service-role key leakage *(low, severe)*
One import into a client component compromises the entire authorization model.
**Mitigation:** the `withServiceRole` wrapper as the sole entry point; import-boundary lint;
CI grep; audit row on every use.

### R-7 — The audit log becomes the biggest table *(certain, moderate)*
Unbounded growth degrades backups and vacuum.
**Mitigation:** monthly partitions from day one; automated partition creation; archival policy
once D-10 is answered.

### R-8 — Timeline view too slow *(possible, low)*
A six-way `UNION ALL` per candidate is fine for hundreds of events, not for tens of thousands.
**Mitigation:** it is per-candidate and indexed; if profiling demands it, materialise behind
the same interface. Deliberately deferred.

### R-9 — Notification fatigue *(likely, moderate)*
An ignored bell is worse than no bell, because it also hides the important ones.
**Mitigation:** deliberately short catalogue; `dedupe_key`; measure read rates and cut types
that are never opened rather than adding preferences to hide them.

### R-10 — Scope pull toward email and AI *(likely, high)*
The most interesting part of this product is explicitly out of V1 scope, which is exactly the
kind of thing that gets started "just as a prototype."
**Mitigation:** the E0–E3 staging in doc 10; ingestion does not begin until the review queue is
in daily use; the V1 fence in doc 00 §4 is a commitment, not a preference.

### R-11 — Two experiences, one codebase *(moderate, moderate)*
The portal accidentally inheriting an internal query is the most plausible route to a real data
leak in this design.
**Mitigation:** four independent isolation layers (doc 08 §2); lint-enforced import zones; the
pgTAP assertion that a candidate token reads zero rows from every internal table, generated
from `information_schema` so new tables fail the suite by default.

---

## Part C — What I need from you to start

**To begin Stage 0 today:** answers to **D-13** and **D-01**. Everything else in Stage 0 is
independent of the open decisions.

**To begin Stage 2:** **D-05**, **D-03**, **D-04**, **D-07**, and the doc 13 P0 profiling
output.

**Before go-live:** **D-02**, **D-09**, **D-11**, **D-12**.

**Before email ingestion:** **D-10**.

The single most valuable thing that can happen in parallel with Stage 0 is getting the real
workbook in front of us. It answers D-05, D-06 and most of D-12 at once, and it is the only
dependency on the critical path that engineering cannot resolve alone.
