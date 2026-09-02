import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from './support/fake-db';

/**
 * Build 7C — the operational layer.
 *
 * Two things are being tested, and they are the two ways an operations report
 * loses its credibility:
 *
 *   INFLATION   counting proposals, readings or emails as if they were records
 *   OPACITY     a figure nobody can open, explain, or trace back to a row
 *
 * So every assertion below either checks that a number counts ROWS THAT EXIST,
 * or that the records it counted come back with it.
 */

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => state.db,
}));

const { getOperationsSummary, getQueueStanding } = await import(
  '@/server/modules/operations/queries'
);
const { listProposals } = await import('@/server/modules/decisions/queries');

const UNIT = 'unit-1';
const DAY = '2026-09-02';
const IN_DAY = '2026-09-02T10:00:00.000Z';
const NEXT_DAY = '2026-09-03T10:00:00.000Z';

function baseRows() {
  return {
    candidates: [
      { id: 'cand-1', business_unit_id: UNIT, full_name: 'Vishnu Kumar', email: 'v@example.invalid', archived_at: null },
      { id: 'cand-2', business_unit_id: UNIT, full_name: 'Anita Desai', email: 'a@example.invalid', archived_at: null },
    ],
    applications: [] as Record<string, unknown>[],
    interviews: [] as Record<string, unknown>[],
    assessments: [] as Record<string, unknown>[],
    application_status_history: [] as Record<string, unknown>[],
    intelligence_review_items: [] as Record<string, unknown>[],
    email_messages: [] as Record<string, unknown>[],
    email_intelligence_runs: [] as Record<string, unknown>[],
    users: [{ id: 'user-1', full_name: 'Amara Okafor' }],
  };
}

function interview(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    business_unit_id: UNIT,
    candidate_id: 'cand-1',
    application_id: 'app-1',
    scheduled_at: '2026-09-15T19:00:00.000Z',
    source_type: 'email_event',
    verified_at: null,
    created_at: IN_DAY,
    ...overrides,
  };
}

function proposal(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    business_unit_id: UNIT,
    email_message_id: 'email-1',
    event_type: 'interview',
    outcome: 'review_required',
    status: 'open',
    priority: 'normal',
    reason_codes: [],
    proposed_candidate_id: 'cand-1',
    proposed_data: { company: 'Acme Recruiting', job_title: 'Senior Java Developer' },
    candidate_match_confidence: 0.95,
    event_confidence: 0.96,
    created_application_id: null,
    created_interview_id: null,
    created_assessment_id: null,
    supersedes_item_id: null,
    failure_code: null,
    claimed_by: null,
    claimed_at: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: IN_DAY,
    ...overrides,
  };
}

beforeEach(() => {
  state.db = new FakeDb(baseRows());
});

/* =========================================================================
 * COUNTS COME FROM RECORDS
 * ========================================================================= */
describe('the operational day', () => {
  it('COUNTS RECORDS, NOT PROPOSALS', async () => {
    // Four proposals, one interview. The day had one interview.
    state.db.rows('interviews').push(interview('iv-1'));
    state.db.rows('intelligence_review_items').push(
      proposal('p-1', { status: 'approved', created_interview_id: 'iv-1', reviewed_by: 'user-1' }),
      proposal('p-2'),
      proposal('p-3'),
      proposal('p-4', { status: 'ignored' }),
    );

    const summary = await getOperationsSummary(DAY);

    expect(summary.interviews.count).toBe(1);
    expect(summary.needsReview).toBe(2);
    expect(summary.ignored).toBe(1);
  });

  it('DOES NOT COUNT AN EMAIL AS CRM ACTIVITY', async () => {
    state.db.rows('email_messages').push(
      { id: 'e1', business_unit_id: UNIT, received_at: IN_DAY },
      { id: 'e2', business_unit_id: UNIT, received_at: IN_DAY },
      { id: 'e3', business_unit_id: UNIT, received_at: IN_DAY },
    );

    const summary = await getOperationsSummary(DAY);

    expect(summary.emailsReceived).toBe(3);
    expect(summary.applications.count).toBe(0);
    expect(summary.interviews.count).toBe(0);
    expect(summary.assessments.count).toBe(0);
  });

  it('DOES NOT INFLATE WHEN ONE EMAIL IS READ SEVERAL TIMES', async () => {
    // Three readings of one email, one of which was acted on. One interview.
    state.db.rows('email_intelligence_runs').push(
      { id: 'run-1', business_unit_id: UNIT, created_at: IN_DAY },
      { id: 'run-2', business_unit_id: UNIT, created_at: IN_DAY },
      { id: 'run-3', business_unit_id: UNIT, created_at: IN_DAY },
    );
    state.db.rows('interviews').push(interview('iv-1'));
    state.db.rows('intelligence_review_items').push(
      proposal('p-1', { status: 'approved', created_interview_id: 'iv-1' }),
      proposal('p-2', { supersedes_item_id: 'p-1' }),
      proposal('p-3', { supersedes_item_id: 'p-2' }),
    );

    const summary = await getOperationsSummary(DAY);

    expect(summary.interpretations).toBe(3);
    expect(summary.interviews.count).toBe(1);
    expect(summary.interpretationChanges).toBe(2);
  });

  it('EVERY FIGURE CARRIES THE RECORDS IT COUNTED', async () => {
    state.db.rows('interviews').push(interview('iv-1'), interview('iv-2', { candidate_id: 'cand-2' }));

    const summary = await getOperationsSummary(DAY);

    expect(summary.interviews.count).toBe(summary.interviews.records.length);
    expect(summary.interviews.records.map((r) => r.id).sort()).toEqual(['iv-1', 'iv-2']);
    expect(summary.interviews.records[0]?.href).toBe('/interviews/iv-1');
    // The names come from one lookup, not one per record.
    expect(summary.interviews.records.map((r) => r.candidateName).sort()).toEqual([
      'Anita Desai',
      'Vishnu Kumar',
    ]);
  });

  it('attributes each record to email or to a person', async () => {
    state.db.rows('interviews').push(
      interview('iv-1', { source_type: 'email_event', verified_at: null }),
      interview('iv-2', { source_type: 'manual', verified_at: IN_DAY }),
    );

    const summary = await getOperationsSummary(DAY);

    expect(summary.fromEmail).toBe(1);
    expect(summary.fromPerson).toBe(1);
    const automatic = summary.interviews.records.find((r) => r.id === 'iv-1');
    expect(automatic?.source).toBe('email');
    expect(automatic?.verified).toBe(false);
    const typed = summary.interviews.records.find((r) => r.id === 'iv-2');
    expect(typed?.source).toBe('manual');
    expect(typed?.verified).toBe(true);
  });

  it('FILTERS BY DATE, AND THE NEXT DAY IS A DIFFERENT DAY', async () => {
    state.db.rows('interviews').push(
      interview('iv-today'),
      interview('iv-tomorrow', { created_at: NEXT_DAY }),
    );

    const today = await getOperationsSummary(DAY);
    const tomorrow = await getOperationsSummary('2026-09-03');

    expect(today.interviews.records.map((r) => r.id)).toEqual(['iv-today']);
    expect(tomorrow.interviews.records.map((r) => r.id)).toEqual(['iv-tomorrow']);
  });

  it('separates what the machine did from what a person did', async () => {
    state.db.rows('intelligence_review_items').push(
      proposal('p-1', { status: 'approved', outcome: 'auto_approve', reviewed_by: null }),
      proposal('p-2', { status: 'approved', reviewed_by: 'user-1' }),
    );

    const summary = await getOperationsSummary(DAY);

    expect(summary.autoApproved).toBe(1);
    expect(summary.humanApproved).toBe(1);
  });

  it('counts a rejection from the status history, not from a row that does not exist', async () => {
    state.db.rows('application_status_history').push({
      id: 'h-1',
      application_id: 'app-1',
      to_status: 'rejected',
      source_type: 'email_event',
      changed_at: IN_DAY,
    });
    state.db.rows('application_status_history').push({
      id: 'h-2',
      application_id: 'app-2',
      to_status: 'submitted',
      source_type: 'manual',
      changed_at: IN_DAY,
    });

    const summary = await getOperationsSummary(DAY);

    expect(summary.rejections.count).toBe(1);
    expect(summary.rejections.records[0]?.href).toBe('/applications/app-1');
  });

  it('reports a partial failure rather than hiding it', async () => {
    state.db.rows('intelligence_review_items').push(
      proposal('p-1', { failure_code: 'partial_failure', status: 'in_review' }),
    );

    const summary = await getOperationsSummary(DAY);
    expect(summary.partialFailures).toBe(1);
  });

  it('an empty day is empty, not wrong', async () => {
    const summary = await getOperationsSummary(DAY);
    expect(summary.applications.count).toBe(0);
    expect(summary.interviews.count).toBe(0);
    expect(summary.needsReview).toBe(0);
    expect(summary.emailsReceived).toBe(0);
  });
});

/* =========================================================================
 * THE STANDING QUEUE
 * ========================================================================= */
describe('the queue as it stands', () => {
  it('counts what is waiting, whenever it was raised', async () => {
    state.db.rows('intelligence_review_items').push(
      proposal('p-1', { priority: 'high' }),
      proposal('p-2', { status: 'in_review', supersedes_item_id: 'p-1' }),
      proposal('p-3', { status: 'approved' }),
      proposal('p-4', { failure_code: 'partial_failure', status: 'approved' }),
    );

    const standing = await getQueueStanding();

    expect(standing.waiting).toBe(2);
    expect(standing.highPriority).toBe(1);
    expect(standing.interpretationChanges).toBe(1);
    // A partial failure counts even when the item is closed: the record it
    // created still needs somebody to look at it.
    expect(standing.partialFailures).toBe(1);
  });
});

/* =========================================================================
 * THE QUEUE ITSELF — filters, search, pagination
 * ========================================================================= */
describe('the review queue', () => {
  beforeEach(() => {
    state.db.rows('email_messages').push({
      id: 'email-1',
      business_unit_id: UNIT,
      subject: 'Interview invitation',
      from_address: 'recruiter@acmerecruiting.invalid',
      received_at: IN_DAY,
    });
  });

  it('filters to high priority without touching anything else', async () => {
    state.db.rows('intelligence_review_items').push(
      proposal('p-1', { priority: 'high' }),
      proposal('p-2', { priority: 'low' }),
    );

    const page = await listProposals({ priority: 'high', openOnly: true });
    expect(page.items.map((i) => i.id)).toEqual(['p-1']);
  });

  it('filters to interpretation changes', async () => {
    state.db.rows('intelligence_review_items').push(
      proposal('p-1'),
      proposal('p-2', { supersedes_item_id: 'p-1' }),
    );

    const page = await listProposals({ changedOnly: true });
    expect(page.items.map((i) => i.id)).toEqual(['p-2']);
    expect(page.items[0]?.interpretationChanged).toBe(true);
  });

  it('filters to partial failures', async () => {
    state.db.rows('intelligence_review_items').push(
      proposal('p-1'),
      proposal('p-2', { failure_code: 'partial_failure' }),
    );

    const page = await listProposals({ failedOnly: true });
    expect(page.items.map((i) => i.id)).toEqual(['p-2']);
  });

  it('SEARCHES BY COMPANY, CANDIDATE AND SUBJECT', async () => {
    // A second email, because search covers the SENDER too: two proposals on
    // one message from acmerecruiting.invalid would both match "acme", which
    // is correct behaviour and would make this test prove nothing.
    state.db.rows('email_messages').push({
      id: 'email-2',
      business_unit_id: UNIT,
      subject: 'Shift enquiry',
      from_address: 'staffing@northwind.invalid',
      received_at: IN_DAY,
    });
    state.db.rows('intelligence_review_items').push(
      proposal('p-acme', { proposed_data: { company: 'Acme Recruiting', job_title: 'Dev' } }),
      proposal('p-other', {
        email_message_id: 'email-2',
        proposed_candidate_id: 'cand-2',
        proposed_data: { company: 'Northwind Clinical', job_title: 'Nurse' },
      }),
    );

    expect((await listProposals({ search: 'acme' })).items.map((i) => i.id)).toEqual(['p-acme']);
    expect((await listProposals({ search: 'Anita' })).items.map((i) => i.id)).toEqual(['p-other']);
    expect((await listProposals({ search: 'Nurse' })).items.map((i) => i.id)).toEqual(['p-other']);
    // And by sender, which is how a reviewer finds "everything from this agency".
    expect((await listProposals({ search: 'northwind' })).items.map((i) => i.id)).toEqual([
      'p-other',
    ]);
  });

  it('a search that matches nothing returns nothing, not everything', async () => {
    state.db.rows('intelligence_review_items').push(proposal('p-1'));
    const page = await listProposals({ search: 'zzzznotacompany' });
    expect(page.items).toEqual([]);
  });

  it('PAGINATES, AND SAYS WHETHER THERE IS MORE', async () => {
    for (let i = 0; i < 7; i++) {
      state.db.rows('intelligence_review_items').push(proposal(`p-${i}`));
    }

    const first = await listProposals({ limit: 3, offset: 0 });
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);

    const last = await listProposals({ limit: 3, offset: 6 });
    expect(last.items).toHaveLength(1);
    expect(last.hasMore).toBe(false);
  });

  it('carries what a reviewer needs to triage without opening the row', async () => {
    state.db.rows('intelligence_review_items').push(
      proposal('p-1', {
        status: 'in_review',
        claimed_by: 'user-1',
        claimed_at: IN_DAY,
        created_interview_id: 'iv-1',
      }),
    );

    const page = await listProposals({ openOnly: true });
    const item = page.items[0]!;

    expect(item.company).toBe('Acme Recruiting');
    expect(item.emailSubject).toBe('Interview invitation');
    expect(item.emailReceivedAt).toBe(IN_DAY);
    expect(item.claimedByName).toBe('Amara Okafor');
    expect(item.createdRecordKind).toBe('interview');
    expect(item.createdRecordId).toBe('iv-1');
  });
});

/* =========================================================================
 * THE "OTHER" EVENT TYPE
 * ========================================================================= */
describe('an email that is not about anything we record', () => {
  it('CREATES NO CRM RECORD AND STAYS REVIEWABLE', async () => {
    state.db.rows('email_messages').push({
      id: 'email-1',
      business_unit_id: UNIT,
      subject: 'Newsletter',
      from_address: 'news@example.invalid',
      received_at: IN_DAY,
    });
    state.db.rows('intelligence_review_items').push(
      proposal('p-other', {
        event_type: 'other',
        outcome: 'ignore',
        status: 'open',
        proposed_data: {},
        proposed_candidate_id: null,
      }),
    );

    const summary = await getOperationsSummary(DAY);
    expect(summary.applications.count).toBe(0);
    expect(summary.interviews.count).toBe(0);
    expect(summary.assessments.count).toBe(0);

    // Still in the queue, still openable, not forced into a record type.
    const page = await listProposals({ eventType: 'other' });
    expect(page.items.map((i) => i.id)).toEqual(['p-other']);
    expect(page.items[0]?.createdRecordId).toBeNull();
  });
});
