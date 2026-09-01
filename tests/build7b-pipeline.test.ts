import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from './support/fake-db';

/**
 * The pipeline, not the engine.
 *
 * `build7b-decisions.test.ts` covers what the engine decides. This file covers
 * what happens around that decision: that a second reading of the same email
 * does not produce a second interview, that a failed CRM write leaves the item
 * open rather than approved, that the privileged path is only ever used for
 * bookkeeping, and that every use of it carries a reason for the audit trail.
 *
 * The CRM commands are stubbed rather than reimplemented. What is being
 * asserted here is that the pipeline CALLS them — with the acting user and the
 * right provenance — and never writes a CRM row itself; the commands' own
 * behaviour is covered where they are tested.
 */

const state = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  serviceReasons: [] as string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  calls: [] as { command: string; input: any; actor: any; provenance: any }[],
  failNextCrmWrite: false,
  failBookkeeping: 0,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => state.db,
}));

vi.mock('@/server/privileged/service-client', () => ({
  withServiceRole: async (
    _actor: unknown,
    reason: string,
    fn: (db: unknown) => Promise<unknown>,
  ) => {
    state.serviceReasons.push(reason);
    if (state.failBookkeeping > 0) {
      state.failBookkeeping -= 1;
      throw new Error('the bookkeeping write failed');
    }
    return fn(state.db);
  },
}));

function stubCommand(command: string, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (input: any, actor: any, provenance?: any) => {
    if (state.failNextCrmWrite) {
      state.failNextCrmWrite = false;
      throw new Error('the CRM write failed');
    }
    state.calls.push({ command, input, actor, provenance });
    return { id: `${id}-${state.calls.length}` };
  };
}

vi.mock('@/server/modules/applications/commands', () => ({
  createApplication: stubCommand('createApplication', 'application'),
  changeApplicationStatus: stubCommand('changeApplicationStatus', 'status'),
}));
vi.mock('@/server/modules/interviews/commands', () => ({
  createInterview: stubCommand('createInterview', 'interview'),
}));
vi.mock('@/server/modules/assessments/commands', () => ({
  createAssessment: stubCommand('createAssessment', 'assessment'),
}));

const { evaluateIntelligenceRun, approveProposal, resolveProposal } = await import(
  '@/server/modules/decisions/pipeline'
);
const { AppError } = await import('@/server/auth/errors');

const UNIT = 'unit-1';
const EMAIL = 'email-1';
const CANDIDATE = 'cand-1';
const APPLICATION = 'app-1';

const ACTOR = {
  userId: 'user-1',
  email: 'manager@medinext.invalid',
  fullName: 'Amara Okafor',
  businessUnitId: UNIT,
  roles: ['manager'],
  permissions: new Set([
    'application.create',
    'application.update',
    'interview.manage',
    'assessment.manage',
    'proposal.review',
    'proposal.approve',
  ]),
  candidateId: null,
  isInternal: true,
  isCandidate: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

/** A complete, high-confidence interview reading — the auto-approval case. */
const COMPLETE = {
  company: 'Acme Recruiting',
  job_title: 'Senior Java Developer',
  interview_date: '2999-01-15',
  interview_time: '15:00',
  timezone: 'America/New_York',
  meeting_url: 'https://example.invalid/interview',
};

/** The same email, read as something a person must look at. */
const VAGUE = { company: 'Acme Recruiting', job_title: 'Senior Java Developer' };

function seed(options: { extracted?: Record<string, unknown>; confidence?: number } = {}) {
  const receivedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  state.db = new FakeDb({
    email_messages: [
      {
        id: EMAIL,
        business_unit_id: UNIT,
        body_text: 'Interview invitation for Vishnu Kumar from Acme Recruiting.',
        from_address: 'recruiter@acmerecruiting.invalid',
        received_at: receivedAt,
      },
    ],
    candidates: [
      {
        id: CANDIDATE,
        business_unit_id: UNIT,
        full_name: 'Vishnu Kumar',
        email: 'vishnu.kumar@example.invalid',
      },
    ],
    applications: [
      {
        id: APPLICATION,
        candidate_id: CANDIDATE,
        company_name: 'Acme Recruiting',
        position_title: 'Senior Java Developer',
        job_id: 'ACME-77',
        status: 'submitted',
        application_date: '2026-09-01',
      },
    ],
    interviews: [],
    assessments: [],
    intelligence_review_items: [],
    email_intelligence_runs: [
      {
        id: 'run-1',
        business_unit_id: UNIT,
        email_message_id: EMAIL,
        status: 'completed',
        event_type: 'interview',
        event_confidence: options.confidence ?? 0.96,
        proposed_candidate_id: CANDIDATE,
        candidate_match_confidence: 0.95,
        extracted_data: options.extracted ?? COMPLETE,
      },
    ],
  });
}

/** A second reading of the same email: a new run, same message, same event. */
function addSecondRun(extracted: Record<string, unknown> = COMPLETE, confidence = 0.96) {
  state.db.rows('email_intelligence_runs').push({
    id: 'run-2',
    business_unit_id: UNIT,
    email_message_id: EMAIL,
    status: 'completed',
    event_type: 'interview',
    event_confidence: confidence,
    proposed_candidate_id: CANDIDATE,
    candidate_match_confidence: 0.95,
    extracted_data: extracted,
  });
}

const items = () => state.db.rows('intelligence_review_items');
const item = () => items()[0] as Record<string, unknown>;
const crmCalls = () => state.calls.filter((c) => c.command !== 'noop');

beforeEach(() => {
  state.serviceReasons = [];
  state.calls = [];
  state.failNextCrmWrite = false;
  state.failBookkeeping = 0;
  seed();
});

/* =========================================================================
 * IDEMPOTENCY
 * ========================================================================= */
describe('idempotency', () => {
  it('a redelivered email produces one decision and one record', async () => {
    await evaluateIntelligenceRun('run-1', ACTOR);
    await evaluateIntelligenceRun('run-1', ACTOR);

    expect(items()).toHaveLength(1);
    expect(crmCalls().filter((c) => c.command === 'createInterview')).toHaveLength(1);
  });

  it('a SECOND READING of the same email converges on the first decision', async () => {
    await evaluateIntelligenceRun('run-1', ACTOR);
    addSecondRun();

    const second = await evaluateIntelligenceRun('run-2', ACTOR);

    expect(items()).toHaveLength(1);
    expect(second.reviewItemId).toBe(item().id);
    expect(second.explanation).toMatch(/already exists/i);
    expect(crmCalls().filter((c) => c.command === 'createInterview')).toHaveLength(1);
  });

  it('THE KEY IS THE EMAIL AND EVENT TYPE, NOT A TIMESTAMP', async () => {
    await evaluateIntelligenceRun('run-1', ACTOR);
    expect(item().idempotency_key).toBe(`${EMAIL}:interview`);
    expect(String(item().idempotency_key)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('the decision names the run it came from, so a reprocess is traceable', async () => {
    await evaluateIntelligenceRun('run-1', ACTOR);
    expect(item().intelligence_run_id).toBe('run-1');
  });

  it('A SECOND APPROVAL OF THE SAME PROPOSAL IS REFUSED', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);
    const id = String(item().id);

    await approveProposal(
      { reviewItemId: id, corrections: { application_id: APPLICATION, scheduled_at: '2999-01-15T19:00:00.000Z', time_zone: 'America/New_York' } },
      ACTOR,
    );

    await expect(approveProposal({ reviewItemId: id }, ACTOR)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(crmCalls().filter((c) => c.command === 'createInterview')).toHaveLength(1);
  });

  it('a rejected proposal cannot be approved by a later reading', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);
    await resolveProposal({ reviewItemId: String(item().id), status: 'rejected' }, ACTOR);

    addSecondRun();
    await evaluateIntelligenceRun('run-2', ACTOR);

    expect(items()).toHaveLength(1);
    expect(item().status).toBe('rejected');
    expect(crmCalls()).toHaveLength(0);
  });

  it('REPROCESSING AN ALREADY-APPROVED EMAIL WRITES NOTHING NEW', async () => {
    await evaluateIntelligenceRun('run-1', ACTOR);
    expect(item().status).toBe('approved');

    addSecondRun({ ...COMPLETE, interview_time: '16:00' });
    const second = await evaluateIntelligenceRun('run-2', ACTOR);

    expect(second.status).toBe('approved');
    expect(items()).toHaveLength(1);
    expect(crmCalls().filter((c) => c.command === 'createInterview')).toHaveLength(1);
  });
});

/* =========================================================================
 * THE PRIVILEGED PATH
 * ========================================================================= */
describe('the service role is bookkeeping only', () => {
  it('an automatic decision is recorded with a reason for the audit trail', async () => {
    await evaluateIntelligenceRun('run-1', ACTOR);
    // Two privileged writes, both bookkeeping: the decision, then the approval
    // it turned into. Neither is the CRM write.
    expect(state.serviceReasons).toHaveLength(2);
    expect(state.serviceReasons[0]).toMatch(/Record decision for interpretation run-1/);
    expect(state.serviceReasons[1]).toMatch(/Record approval of proposal/);
  });

  it('AN AUTOMATIC APPROVAL NAMES NO REVIEWER', async () => {
    await evaluateIntelligenceRun('run-1', ACTOR);
    expect(item().status).toBe('approved');
    expect(item().outcome).toBe('auto_approve');
    // Nobody looked at it, so nobody is recorded as having looked at it.
    expect(item().reviewed_by ?? null).toBeNull();
    expect(item().created_interview_id).toBeTruthy();
  });

  it('a human approval is recorded with a reason for the audit trail', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);
    state.serviceReasons = [];

    await approveProposal(
      { reviewItemId: String(item().id), corrections: { application_id: APPLICATION, scheduled_at: '2999-01-15T19:00:00.000Z', time_zone: 'America/New_York' } },
      ACTOR,
    );

    expect(state.serviceReasons).toHaveLength(1);
    expect(state.serviceReasons[0]).toMatch(/Record approval of proposal/);
  });

  it('THE CRM WRITE RUNS AS THE USER, NEVER AS THE SERVICE ROLE', async () => {
    await evaluateIntelligenceRun('run-1', ACTOR);
    const write = crmCalls().find((c) => c.command === 'createInterview');
    expect(write?.actor).toBe(ACTOR);
    // The only privileged call is the decision row itself.
    expect(state.serviceReasons.every((r) => /Record (decision|approval)/.test(r))).toBe(true);
  });

  it('rejecting needs no privileged path at all', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);
    state.serviceReasons = [];

    await resolveProposal({ reviewItemId: String(item().id), status: 'rejected' }, ACTOR);

    expect(state.serviceReasons).toEqual([]);
    expect(crmCalls()).toHaveLength(0);
  });
});

/* =========================================================================
 * PROVENANCE
 * ========================================================================= */
describe('provenance on the record it creates', () => {
  it('AN AUTOMATIC RECORD IS UNVERIFIED AND CITES THE READING', async () => {
    await evaluateIntelligenceRun('run-1', ACTOR);
    const write = crmCalls().find((c) => c.command === 'createInterview');
    expect(write?.provenance).toEqual({
      sourceType: 'email_event',
      sourceReference: 'intelligence:run-1',
      verified: false,
    });
  });

  it('A HUMAN-APPROVED RECORD IS VERIFIED', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);

    await approveProposal(
      { reviewItemId: String(item().id), corrections: { application_id: APPLICATION, scheduled_at: '2999-01-15T19:00:00.000Z', time_zone: 'America/New_York' } },
      ACTOR,
    );

    const write = crmCalls().find((c) => c.command === 'createInterview');
    expect(write?.provenance.verified).toBe(true);
    expect(write?.provenance.sourceType).toBe('email_event');
  });

  it('it never pretends the record was typed by hand', async () => {
    await evaluateIntelligenceRun('run-1', ACTOR);
    const write = crmCalls().find((c) => c.command === 'createInterview');
    expect(write?.provenance.sourceType).not.toBe('manual');
  });
});

/* =========================================================================
 * CORRECTIONS
 * ========================================================================= */
describe('a correction', () => {
  it('IS STORED BESIDE THE PROPOSAL, NEVER OVER IT', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);
    const proposed = { ...(item().proposed_data as Record<string, unknown>) };

    await approveProposal(
      {
        reviewItemId: String(item().id),
        corrections: {
          application_id: APPLICATION,
          scheduled_at: '2999-01-15T19:00:00.000Z',
          time_zone: 'America/New_York',
        },
      },
      ACTOR,
    );

    expect(item().proposed_data).toEqual(proposed);
    expect(item().corrected_data).toMatchObject({ time_zone: 'America/New_York' });
    expect(item().final_data).toMatchObject({ ...proposed, time_zone: 'America/New_York' });
  });

  it('is what actually reaches the command', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);

    await approveProposal(
      {
        reviewItemId: String(item().id),
        corrections: {
          application_id: APPLICATION,
          scheduled_at: '2999-01-16T19:00:00.000Z',
          time_zone: 'Europe/London',
        },
      },
      ACTOR,
    );

    const write = crmCalls().find((c) => c.command === 'createInterview');
    expect(write?.input.scheduledAt).toBe('2999-01-16T19:00:00.000Z');
    expect(write?.input.timeZone).toBe('Europe/London');
  });
});

/* =========================================================================
 * FAILURE
 * ========================================================================= */
describe('when something fails', () => {
  it('A FAILED CRM WRITE LEAVES THE PROPOSAL OPEN, NOT APPROVED', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);
    const id = String(item().id);

    state.failNextCrmWrite = true;
    await expect(
      approveProposal(
        { reviewItemId: id, corrections: { application_id: APPLICATION, scheduled_at: '2999-01-15T19:00:00.000Z', time_zone: 'America/New_York' } },
        ACTOR,
      ),
    ).rejects.toThrow(/CRM write failed/);

    expect(item().status).toBe('open');
    expect(item().created_interview_id ?? null).toBeNull();
    expect(item().reviewed_at ?? null).toBeNull();
  });

  it('and the same approval succeeds on the retry', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);
    const id = String(item().id);
    const approval = {
      reviewItemId: id,
      corrections: {
        application_id: APPLICATION,
        scheduled_at: '2999-01-15T19:00:00.000Z',
        time_zone: 'America/New_York',
      },
    };

    state.failNextCrmWrite = true;
    await expect(approveProposal(approval, ACTOR)).rejects.toThrow();
    await approveProposal(approval, ACTOR);

    expect(item().status).toBe('approved');
    expect(item().created_interview_id).toBeTruthy();
    expect(crmCalls().filter((c) => c.command === 'createInterview')).toHaveLength(1);
  });

  it('a failed automatic write leaves the decision recorded but unapproved', async () => {
    state.failNextCrmWrite = true;
    await expect(evaluateIntelligenceRun('run-1', ACTOR)).rejects.toThrow(/CRM write failed/);

    // The decision itself stands — it was correctly made — and the item is
    // still open, so the queue shows it rather than losing it.
    expect(items()).toHaveLength(1);
    expect(item().status).toBe('open');
    expect(item().created_interview_id ?? null).toBeNull();
  });

  it('BOOKKEEPING THAT FAILS AFTER A SUCCESSFUL WRITE SAYS SO, BY ID', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);
    const id = String(item().id);

    // Both the write and its one retry fail.
    state.failBookkeeping = 2;
    const error = await approveProposal(
      { reviewItemId: id, corrections: { application_id: APPLICATION, scheduled_at: '2999-01-15T19:00:00.000Z', time_zone: 'America/New_York' } },
      ACTOR,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).code).toBe('PARTIAL_FAILURE');
    // The record is named, because a reviewer told only "it failed" is the
    // person most likely to create it a second time.
    expect((error as Error).message).toMatch(/interview was created \(interview-1\)/);
    expect(crmCalls().filter((c) => c.command === 'createInterview')).toHaveLength(1);
  });

  it('one failed bookkeeping write is retried and the approval completes', async () => {
    seed({ extracted: VAGUE, confidence: 0.7 });
    await evaluateIntelligenceRun('run-1', ACTOR);

    state.failBookkeeping = 1;
    await approveProposal(
      { reviewItemId: String(item().id), corrections: { application_id: APPLICATION, scheduled_at: '2999-01-15T19:00:00.000Z', time_zone: 'America/New_York' } },
      ACTOR,
    );

    expect(item().status).toBe('approved');
  });
});
