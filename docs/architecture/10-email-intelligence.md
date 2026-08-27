# 10 — Email Intelligence Architecture (Future)

> **Not built in V1.** No mailbox is connected, no model is called, no message is parsed.
> This document exists because the shape of this future capability constrains the schema we
> build now, and because the wrong V1 schema would make it unbuildable later without a
> migration that rewrites history.

## 1. The problem

A shared marketing mailbox receives everything: vendor replies, interview invitations,
assessment links, rejections, offers, scheduling churn, and a great deal of noise. Today a
human reads each one and updates a spreadsheet. The goal is to read them into the system,
propose what they mean, and let a human confirm.

## 2. The rule that governs the whole pipeline

> **Interpretation proposes. Humans dispose. History is never rewritten.**

Concretely, three prohibitions that are not negotiable:

1. An automated process may never `UPDATE` a verified record's business fields. It may create
   a proposal, and a promotion action may apply it.
2. An automated process may never delete anything, in any layer.
3. Every automated write carries `pipeline_version`, `classifier`, and `confidence`. An
   interpretation without provenance is not admissible.

If a classifier is later found to have been wrong for three months, we must be able to
identify every record it touched and reverse exactly those. That is only possible if
provenance is recorded at write time. It cannot be reconstructed afterwards.

## 3. Pipeline

```
 Mailbox (IMAP / Graph / Gmail API)
   │  poll or webhook
   ▼
 [1] CAPTURE ───────────────────────────────────────────  ingest.emails (append-only)
   store raw .eml in private storage; sha256; dedupe on (mailbox_id, message_id)
   │                                                       ingest.email_attachments
   ▼
 [2] PARSE ─────────────────────────────────────────────  ingest.email_processing_state
   MIME → text; strip quoted history and signatures;
   extract dates, links, names, phone numbers
   │
   ▼
 [3] IDENTIFY ──────────────────────────────────────────  email_events(identity_matched)
   candidate resolution: exact email → alias → name+context → fuzzy (pg_trgm)
   ambiguous or no match → review_items(ambiguous_identity)
   │
   ▼
 [4] CLASSIFY ──────────────────────────────────────────  ingest.email_events
   rules first, model second; every event carries a confidence
   │
   ▼
 [5] EXTRACT ───────────────────────────────────────────  email_events.extracted (jsonb)
   typed payload per event kind (interview → start, mode, panel, link)
   │
   ▼
 [6] RECONCILE ─────────────────────────────────────────  conflict detection
   does this contradict, duplicate, or update an existing verified record?
   │
   ├── high confidence + no conflict + creating-only ──► [7a] AUTO-CREATE (+ notification)
   └── anything else ─────────────────────────────────► [7b] review_items (human queue)
                                                              │
                                                     accept ──┴──► promotion service
                                                                    writes verified record
                                                                    + record_provenance
                                                                    + audit log
```

## 4. Staged rollout

Trust is earned in order. Each stage ships and runs for a period before the next begins.

| Stage | Behaviour |
|---|---|
| E0 | Capture only. Emails stored, linked to candidates, readable in the CRM. **No classification.** Proves ingestion, deduplication and identity matching in isolation. |
| E1 | Classification runs; **every** event becomes a review item. The system proposes, humans do all the work. This is where thresholds are calibrated against measured accuracy. |
| E2 | Auto-create for the narrowest, highest-precision category only — most likely interview scheduling — above a measured threshold. Everything else stays in review. |
| E3 | Widen category by category, each gated on its own measured precision. |

**No stage ever introduces auto-update or auto-delete.** Auto-*create* is defensible because a
wrongly created record is visible, attributable and removable. Auto-update destroys a fact
that a human asserted, which is exactly what the product principle forbids.

## 5. Confidence and thresholds

`confidence ∈ [0,1]`, stored per event. The threshold is **per event type**, stored in
configuration, tuned from observed precision on a labelled sample — never chosen by intuition
and never global.

Escalate to review regardless of confidence when any of these hold:

- the candidate match is ambiguous (more than one plausible candidate)
- an existing verified record contradicts the extraction
- the email suggests deleting or cancelling something that does not exist in our records
- the sender domain is unknown and the event would create a record
- the same fact was already extracted from a different email with different values

That last one is the duplicate/inconsistency detection the brief calls for, and it falls out
of the design naturally because interpretations are stored as first-class rows rather than
applied and discarded.

## 6. Identity resolution

Ordered, each step recording which rule matched:

1. Exact match on `candidates.primary_email`
2. Match on a known alias (`candidate_email_aliases` — a small table to be added at E0)
3. Message thread continuity: the thread already resolved to a candidate
4. Name in subject/body plus corroborating context (a known vendor, an open application)
5. Trigram similarity above a threshold → **always** review, never auto-accept

Rule 5 never auto-resolves. Attaching one candidate's interview to another candidate's record
is among the worst failures this system could produce, and fuzzy name matching in a domain
full of similar names is precisely where it would happen.

## 7. Third-party recruiter identification

Sender domain → `organizations.domains`. New domains create a low-severity review item to
classify the organization once; thereafter it is known. Over time this yields vendor-level
statistics (response rates, interview-to-offer ratios, reschedule frequency) which is likely
to be one of the more valuable by-products of ingestion — but only if organizations are a real
table from V1, which is why doc 02 proposes them now.

## 8. Operational requirements

- **Idempotent.** Re-processing an email produces no new records. Enforced by
  `(mailbox_id, message_id)` uniqueness and by natural-key hashes on promotions.
- **Replayable.** Because raw messages are retained, a corrected classifier can be re-run over
  history to produce *new proposals* — never to silently amend past decisions.
- **Versioned prompts and rules,** stored with each event. Reproducibility is impossible
  otherwise.
- **Separate deployable.** Polling and model calls do not fit a serverless request budget.
  A long-running worker with its own queue and backoff.
- **Rate and cost budgets** per run, with a circuit breaker. An ingestion loop that retries a
  poisoned message forever is the standard failure mode.
- **PII.** Full email bodies are the most sensitive data the system will hold. Private storage,
  no third-party logging of content, access to `ingest.*` restricted to admin plus the worker,
  and a retention policy agreed before the first message is stored (doc 05 §9, D-10).

## 9. What V1 must get right for this to work later

Small list, and everything on it is already in doc 02:

1. `ingest.emails` append-only, with the mutable processing state in a separate table.
2. `ingest.email_events` as a persistent interpretation layer, not a transient queue.
3. `review_items` generic enough to carry any proposal shape (hence `payload jsonb`).
4. `record_provenance` present from the first record ever created, so imported and
   manually-entered records are as attributable as generated ones.
5. `application_id` **nullable** on interviews, assessments, rejections and offers (doc 01
   §4.4) — without this, unlinked-but-true facts cannot be recorded.
6. `organizations.domains` populated as data arrives.

Get those six right and ingestion is an additive project. Get any of them wrong and it is a
migration of live history.
