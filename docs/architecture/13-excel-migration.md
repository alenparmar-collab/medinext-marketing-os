# 13 — Migration Strategy from the Excel Workflow

## 1. Position

The spreadsheet is not a legacy database to be dumped and loaded. It is a **source document**,
and it is treated exactly like every other source in this architecture: captured verbatim,
interpreted separately, promoted deliberately.

That gives one property that a direct import cannot: at any point after go-live, for any
record, we can answer *"which spreadsheet row and which cell did this come from, and who
approved it."*

## 2. The prerequisite nobody should skip

**Nothing can be built until the actual workbook has been read, column by column.** This
document describes the method; the content of the mapping is unknown until that exercise
happens, and several **[DECISION NEEDED]** items in doc 15 (statuses, candidate fields,
report fields) are answerable only from it.

What we need before writing the first migration:

1. The live workbook, all sheets, including sheets people think are unused.
2. For each column: meaning, who fills it, whether it is free text in practice, and its real
   value distribution.
3. The full set of values actually present in every status-like column — not the intended set.
   These always differ, and the difference is where the business rules are hiding.
4. Identification of the columns that carry more than one fact (a `Status` column that some
   rows use for a date, a `Notes` column carrying structured data by convention).
5. Any parallel workbooks or personal copies. There always are some.

## 3. Phases

```
 P0  PROFILE      read the workbook, catalogue columns, count distinct values
 P1  MAP          write a versioned mapping spec; agree enum sets; agree identity keys
 P2  CAPTURE      upload → staging.import_batches + staging.import_rows (raw jsonb, verbatim)
 P3  NORMALISE    raw → normalized jsonb; typing, trimming, enum coercion, per-cell issues
 P4  RESOLVE      identity resolution and deduplication across rows and sheets
 P5  DRY RUN      full promotion against a scratch database; produce a reconciliation report
 P6  REVIEW       humans work the exception queue until it is empty or explicitly accepted
 P7  PROMOTE      transactional promotion per batch; provenance on every record
 P8  RECONCILE    counts and spot checks vs the workbook; sign-off
 P9  FREEZE       workbook goes read-only; system becomes the source of truth
```

P5 and P6 are the phases that get cut under time pressure and are the two that determine
whether anyone trusts the result. The dry run is cheap; a bad import is not.

## 4. Capture (P2)

The uploaded file itself is stored in a private bucket with its checksum. Each row becomes one
`staging.import_rows` record with the **raw cell values as jsonb, unmodified** — no trimming,
no type coercion, no null normalisation. Column headers are preserved as keys exactly as they
appear, including trailing spaces and inconsistent casing.

Nothing about this layer is cleaned, because cleaning is interpretation and interpretation
belongs in the next layer where it can be reviewed and re-run.

## 5. Normalisation (P3)

A versioned, pure mapping function: `raw → { normalized, issues[] }`.

Deterministic and re-runnable. If the mapping is wrong we fix the function and re-run against
the same immutable raw rows — we never re-upload, and we never edit the spreadsheet to make
the import work.

Issue categories, each becoming a review item rather than a silent default:

| Issue | Handling |
|---|---|
| Unparseable date | flag; do not guess between DD/MM and MM/DD |
| Unknown status value | flag; propose the closest known enum, require confirmation |
| Missing required field | flag; may not be promoted |
| Malformed email/phone | keep raw, store normalised alongside, flag if unrecoverable |
| Multiple facts in one cell | flag for manual split |
| Contradictory rows for one candidate | flag as a conflict, never merge automatically |

Ambiguous dates deserve emphasis: `03/04/2026` is two different dates and a spreadsheet
maintained by several people over several years will contain both conventions. Guessing
produces interviews on the wrong day. Every ambiguous date is flagged.

## 6. Identity resolution (P4)

Candidate identity is the hard part of any spreadsheet migration, because a spreadsheet has no
primary key and the same person appears as "Priya Sharma", "priya sharma", "P. Sharma" and
"Priya S" across sheets and years.

Ordered rules, each recorded on the row:

1. Exact normalised email match
2. Exact phone match (digits only, last 10)
3. Exact normalised full name **plus** one corroborating field (city, primary skill)
4. Trigram similarity above threshold → **always** manual review

`natural_key_hash` is computed from the chosen identity key so that re-running a batch is
idempotent, and a partial unique index on promoted rows makes double-promotion impossible even
if someone clicks twice.

## 7. Promotion (P7)

Per batch, inside one transaction per row group, in dependency order:

```
organizations → candidates → candidate_profiles → users(portal, only if requested)
  → candidate_assignments → marketing_periods → applications
  → recruiter_responses → interviews → assessments → rejections → offers
  → documents(metadata; files migrated separately)
```

Every promoted record gets `created_source = 'excel_import'` and
`created_source_id = <import_row_id>`, plus a `record_provenance` row. The link is permanent
and queryable in both directions.

**Audit behaviour during import:** the actor is the admin who ran it, set via `app.actor_id`,
so the audit log shows a real person, not a null. The import is additionally logged as one
`import_run` event with batch id and row counts.

**Historical timestamps:** `created_at` is import time; the business date from the spreadsheet
goes in the business column (`applied_at`, `rejected_at`, `offered_at`). Backdating
`created_at` would corrupt the audit trail to make a report look tidier — not a trade worth
making. Where the spreadsheet has no business date, the field is null and flagged, not
back-filled with a plausible guess.

## 8. Rollback

Per batch, and it must be tested before P7 is run for real: because every promoted record
carries `created_source_id`, a batch can be reversed by deleting exactly the records it
created, in reverse dependency order, as an audited admin action. Rollback is only valid
before users have edited the imported records; after that, corrections are forward-only. That
window should be stated explicitly to the business before go-live.

## 9. Reconciliation (P8)

The report that determines sign-off:

- Row counts: workbook vs staged vs promoted vs rejected, per sheet.
- Entity counts: candidates, applications, interviews, offers — system vs manual workbook
  count.
- Distribution comparison per status column.
- Every unpromoted row listed with its reason.
- A random sample of 20 candidates traced cell-by-cell against the workbook, by a human.

Sign-off is a named person accepting this report, recorded. Not a Slack thumbs-up.

## 10. Cutover

Parallel running is a trap here: two sources of truth means both rot. Recommendation is a
short, hard cutover.

1. Announce a freeze window.
2. Final delta import (rows changed since the main import).
3. Reconcile.
4. Workbook set to read-only, retained as an archival record, never deleted.
5. All new work in the system from that moment.
6. A defined support window with someone available for corrections.

If the business insists on parallel running, cap it at a fixed number of days agreed in
advance, with the workbook explicitly read-only and a daily reconciliation. Open-ended
parallel running has one outcome, and it is the spreadsheet winning.
