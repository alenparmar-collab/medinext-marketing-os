# 08 — Candidate Portal Architecture

## 1. Purpose and posture

The portal answers one question for one person: *what is happening with my job search?*

It is a **separate experience sharing one database**, not a filtered view of the CRM. That
distinction drives every decision below. A filtered CRM leaks: someone adds a column, forgets
the filter, and internal commentary appears on a candidate's screen. A separate experience
with its own data path cannot leak that way, because the internal columns are not on the
query path at all.

**V1 posture: read-only.** Pending D-01 (doc 15), a candidate can see their information and
download documents marked visible to them. They cannot edit records, upload files, or confirm
attendance. Read-only is the safe default: adding write paths later is additive, while
removing one after candidates have used it is a support problem.

## 2. Isolation, in four independent layers

| Layer | Mechanism | What it stops |
|---|---|---|
| Routing | `(portal)` route group, middleware asserts the candidate claim | Internal URLs being loaded by a portal session |
| Data path | Portal pages import only `src/server/modules/portal/`, lint-enforced | A developer accidentally reusing an internal query |
| Projection | `portal_*` `security_invoker` views expose a narrow column set | Internal columns reaching a portal DTO |
| Database | RLS policies keyed on `candidates.user_id = auth.uid()` | Everything, including a hand-crafted REST call with a stolen token |

Only the fourth layer is load-bearing for security. The first three exist so that a mistake in
one of them is caught by another, and so the security-critical layer stays small enough to
audit line by line.

## 3. Screens

| Route | Content |
|---|---|
| `/` | Status summary: active marketing period, counts, next interview, open assessments |
| `/applications` | Role, company, location, mode, status, date. Grouped by status. |
| `/interviews` | Upcoming and past. Date/time in the candidate's zone, mode, joining details. |
| `/assessments` | Type, platform, due date, status, result if released |
| `/offers` | Offers and their status |
| `/documents` | Only `visibility = 'candidate_visible'`; download via signed URL |
| `/timeline` | Chronological, filtered to candidate-safe event kinds |
| `/profile` | Their profile as the system holds it. Read-only in V1. |

Rejections are **excluded by default** — D-02. This is a product and duty-of-care question,
not a technical one: rejection reasons entered as internal shorthand are frequently blunt, and
publishing them without review would be its own problem. The architecture supports either
answer; the view is one migration away.

## 4. Time zones

Interview times are the portal's highest-stakes data. A candidate who misreads a time misses
an interview, and that is a real business cost.

- Store `timestamptz` plus the `time_zone` the interview was **scheduled in**.
- Render in the candidate's own zone (from `candidate_profiles.time_zone`, falling back to the
  browser), and *always* label it: `Thu 4 Sep, 2:30 PM IST (your time)`.
- Where the scheduled zone differs from the candidate's, show both. Ambiguity here is not
  worth the visual tidiness of showing one.

## 5. Notifications

Candidates receive in-app notifications only in V1, for a deliberately short list: interview
scheduled, interview rescheduled or cancelled, assessment assigned, offer received, document
shared.

They do **not** receive notifications for application submissions or rejections by default —
volume and tone make those a decision rather than a default (D-02).

## 6. Empty and pending states

A portal for someone mid-job-search is often mostly empty, and empty screens read as "the
system is broken" or "nobody is working on me." Each empty state states what the section will
show and what has to happen first: *"No interviews scheduled yet. Your recruiter will add
them here as they're confirmed."* This is a UX requirement, not decoration — it directly
reduces inbound "is anything happening?" contact.

## 7. Access lifecycle

- No self-signup. Accounts exist only by staff invitation (doc 03 §6).
- Magic link plus password; **[DECISION NEEDED, D-11]** on whether password is offered at all
  or invitation links are the sole mechanism.
- Deactivation sets `users.status = 'disabled'`; RLS requires `active`, so access stops
  immediately without deleting the link between person and record.
- Archiving a candidate revokes portal access via the `archived_at` predicate in
  `util.own_candidate_id()`.
- Sessions are short-lived with refresh; portal sessions are configured shorter than internal
  ones, since candidates frequently sign in from shared or borrowed devices.

## 8. Performance

Every portal page is a handful of indexed reads on one `candidate_id`. There is no pagination
problem, no aggregation problem, and no need for caching — which is fortunate, because caching
user-scoped data is exactly the mistake doc 04 §7 forbids. The portal should stay simple
enough that this remains true.
