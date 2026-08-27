# 09 — Internal CRM Architecture

## 1. What the interface is for

Recruiters spend their day doing four things: seeing what needs attention, logging what
happened, moving records forward, and reporting. The interface optimises for those, in that
order. The dashboard is not a chart gallery — charts are a manager artefact and a small part
of the surface.

The workflow being replaced is a spreadsheet. A spreadsheet is fast, dense, keyboard-driven,
and always shows the whole row. Any replacement that is slower, sparser, or mouse-dependent
will be rejected by the people using it, whatever else it does well. That is the bar.

## 2. Shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ MEDINEXT   Candidates  Applications  Interviews  Reports  Review  ⌘K │  56px
├────────────┬─────────────────────────────────────────────────────────┤
│            │  Priya Sharma  MDX-00142            [Active] [Actions ▾] │
│  sidebar   │  Overview Timeline Marketing Applications … Notes        │
│  240px     ├─────────────────────────────────────────────────────────┤
│  collapse  │                                                          │
│  to 64px   │  content                                                 │
└────────────┴─────────────────────────────────────────────────────────┘
```

- Sidebar entries filter themselves by permission from `config/navigation.ts`.
- Command palette (⌘K / Ctrl-K) is a primary navigation mechanism, not a garnish: jump to
  candidate, create application, log activity, open today's report.
- The candidate header persists across all candidate tabs and is loaded once in the tab
  `layout.tsx`, so switching tabs never re-fetches identity.

## 3. Screens that carry the product

### Dashboard
Work queues, not vanity metrics: my candidates needing activity today, interviews in the next
48 hours, assessments due, applications with no response past N days, my open review items,
whether today's report is submitted. Managers additionally see team submission status and
unassigned candidates.

`N` in "no response past N days" is **[DECISION NEEDED, D-12]** — it is a business SLA, not
something I should pick.

### Candidate list
The workhorse. Server-driven table: search (trigram on name, exact on reference and email),
filters on status / assignee / marketing period state, saved views persisted per user, column
visibility, keyset pagination, bulk assign, CSV export (permissioned and audited).

### Candidate detail
Tabs from doc 06. The Overview tab is the one that must earn its place: identity, current
marketing period, live pipeline counts, next scheduled event, latest activity, quick actions.
If a recruiter has to leave Overview to answer "where is this person," the layout is wrong.

### Applications board
Cross-candidate pipeline, grouped by status, filterable by recruiter, period and date. Table
first; a Kanban view is deferred until the status set is settled (D-05), because a board makes
the status machine visible and a wrong status machine then becomes very expensive to change.

### Interview schedule
Day / week list with time zones surfaced. Reschedule is a first-class action that writes
`interview_schedule_history`, never a silent edit of `scheduled_start`.

### Daily reports
Pre-populated from verified records (doc 02 §6), recruiter edits only what diverges and must
give a reason. This inverts the spreadsheet workflow — from *type all the numbers* to *confirm
or correct the numbers* — which is both faster and the reason the data becomes trustworthy.

### Review queue
Sorted by severity then age. Each item shows the proposal, the source, the affected candidate,
and exactly two primary actions: accept or reject, with a note. Bulk accept is deliberately
**not** offered above a confidence floor — the queue exists to be read.

### Admin
Users and roles, permission matrix, lookup table editing, import runs, audit search.

## 4. Interaction rules

- **Keyboard first.** `/` search, `⌘K` palette, `j`/`k` row movement, `Enter` open, `e` edit,
  `n` new, `Esc` close. Every dialog is escapable; no focus traps without a visible exit.
- **Optimistic updates only for reversible, single-field changes** (mark read, toggle pin).
  Status transitions and record creation wait for the server. An optimistic status flip that
  silently reverts is worse than a 300 ms wait, because it destroys trust in what the screen
  says.
- **Confirmation only for genuinely destructive or outward-facing actions**: delete, archive,
  portal invite, lock report. Everything else is undoable and should not interrupt.
- **Inline editing** for single fields in detail views; dialogs for multi-field creation;
  full pages for anything over roughly eight fields.
- **Density toggle** (comfortable / compact) persisted per user. Recruiters working a list all
  day want compact; managers reviewing want comfortable.

## 5. Shared patterns

`components/patterns/` — built once, used everywhere:

`DataTable` (server-driven, keyset, selection, column visibility) · `PageHeader` ·
`StatusBadge` (single source of status colour, from `config/statuses.ts`) · `EmptyState` ·
`FilterBar` (search-param bound) · `Timeline` · `ActivityComposer` · `ConfirmDialog` ·
`PermissionGate` · `FormField` · `DateTimeDisplay` (never renders a time without a zone).

`StatusBadge` and `DateTimeDisplay` being single components is a correctness measure, not a
DRY preference: it is how status colour stays meaningful and how a bare local time never
reaches a screen.

## 6. Performance targets

| Metric | Target |
|---|---|
| Candidate list, first contentful paint | < 1.0 s |
| Candidate list, 10 000 rows, page turn | < 300 ms |
| Candidate detail overview | < 800 ms |
| Search keystroke → results | < 250 ms (debounced 200 ms) |
| Server action round trip | < 500 ms p95 |

The risks are known and named: RLS predicates on large scans (mitigated by
`(select util.fn())` wrapping and the assignment index), and `count: 'exact'` (avoided per doc
07 §4).

## 7. Accessibility

WCAG 2.1 AA as a build requirement, not a later audit. Semantic HTML, visible focus rings that
survive the design pass, 4.5:1 contrast on all text including muted secondary text and status
badges, full keyboard operability, `aria-live` for async results, respect for
`prefers-reduced-motion`. Every icon-only control has an accessible name. Colour never carries
meaning alone — status is always colour **plus** text.
