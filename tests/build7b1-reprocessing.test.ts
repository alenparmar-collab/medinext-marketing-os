import { describe, expect, it } from 'vitest';
import { decide, type DecisionInput } from '@/server/modules/decisions/engine';
import {
  fingerprintProposal,
  materialView,
  materialDifferences,
  MATERIAL_FIELDS,
} from '@/server/modules/decisions/fingerprint';

/**
 * Build 7B.1 — reading the same email twice.
 *
 * Two failures are possible here and they are opposites:
 *
 *   act twice     a redelivery creates a second interview
 *   act never     a corrected reading is treated as a duplicate and vanishes
 *
 * Build 7B closed the first by keying idempotency on (email, event type). That
 * key cannot tell a redelivery from a correction, so it closed the second one
 * too — silently. These tests are about the line between them: what counts as
 * the same proposal, what counts as a different one, and what happens in each
 * case.
 */

const NOW = new Date('2026-09-10T09:00:00.000Z');
const RECENT = '2026-09-09T09:00:00.000Z';

const CANDIDATE = { id: 'cand-1', fullName: 'Vishnu Kumar', email: 'vishnu.kumar@example.invalid' };
const OTHER_CANDIDATE = { id: 'cand-2', fullName: 'Anita Desai', email: 'anita@example.invalid' };

const APPLICATION = {
  id: 'app-1',
  companyName: 'Acme Recruiting',
  positionTitle: 'Senior Java Developer',
  jobId: 'ACME-77',
  status: 'submitted',
  applicationDate: '2026-09-01',
};

const SECOND_APPLICATION = {
  id: 'app-2',
  companyName: 'Northwind Clinical',
  positionTitle: 'Clinical Data Manager',
  jobId: 'NW-12',
  status: 'submitted',
  applicationDate: '2026-09-02',
};

const ALL_PERMISSIONS = new Set([
  'application.create',
  'application.update',
  'interview.manage',
  'assessment.manage',
]);

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    eventType: 'interview',
    eventConfidence: 0.96,
    candidateId: CANDIDATE.id,
    candidateMatchConfidence: 0.95,
    candidate: CANDIDATE,
    extracted: {},
    emailBody: 'Interview details.',
    emailFromAddress: 'recruiter@acmerecruiting.invalid',
    emailReceivedAt: RECENT,
    existingApplications: [APPLICATION, SECOND_APPLICATION],
    existingInterviews: [],
    existingAssessments: [],
    alreadyActioned: null,
    actorPermissions: ALL_PERMISSIONS,
    now: NOW,
    ...overrides,
  };
}

const INTERVIEW = {
  company: 'Acme Recruiting',
  job_title: 'Senior Java Developer',
  interview_date: '2026-09-15',
  interview_time: '15:00',
  timezone: 'America/New_York',
  meeting_url: 'https://example.invalid/interview',
};

const ASSESSMENT = {
  company: 'Acme Recruiting',
  job_title: 'Senior Java Developer',
  assessment_name: 'Java coding exercise',
  due_date: '2026-09-20',
  assessment_url: 'https://example.invalid/test',
};

/**
 * The prior decision, produced by the engine rather than written by hand — a
 * hand-written prior would carry a fingerprint production never computes, and
 * the comparison would be against a shape that can never match.
 */
function priorFrom(
  decision: ReturnType<typeof decide>,
  overrides: Partial<NonNullable<DecisionInput['alreadyActioned']>> = {},
): NonNullable<DecisionInput['alreadyActioned']> {
  return {
    itemId: 'item-1',
    status: 'approved',
    fingerprint: decision.fingerprint,
    proposedData: decision.proposedData,
    candidateId: CANDIDATE.id,
    createdRecordId: 'interview-123',
    createdRecordKind: 'interview',
    ...overrides,
  };
}

/* =========================================================================
 * THE FINGERPRINT ITSELF
 * ========================================================================= */
describe('the proposal fingerprint', () => {
  it('is stable for the same material proposal', () => {
    const a = fingerprintProposal('interview', { company: 'Acme', scheduled_at: 'X' }, 'cand-1');
    const b = fingerprintProposal('interview', { company: 'Acme', scheduled_at: 'X' }, 'cand-1');
    expect(a).toBe(b);
  });

  it('IGNORES KEY ORDER', () => {
    const a = fingerprintProposal(
      'interview',
      { company: 'Acme', job_title: 'Dev', scheduled_at: 'X' },
      'cand-1',
    );
    const b = fingerprintProposal(
      'interview',
      { scheduled_at: 'X', job_title: 'Dev', company: 'Acme' },
      'cand-1',
    );
    expect(a).toBe(b);
  });

  it('IGNORES FIELDS THAT DO NOT CHANGE THE RECORD', () => {
    const base = { company: 'Acme', scheduled_at: 'X' };
    const noisy = {
      ...base,
      // None of these change what would be written.
      interviewer: 'Someone Else',
      processed_at: new Date().toISOString(),
      model: 'gpt-whatever',
      confidence: 0.71,
    };
    expect(fingerprintProposal('interview', base, 'cand-1')).toBe(
      fingerprintProposal('interview', noisy, 'cand-1'),
    );
  });

  it('ignores capitalisation and surrounding space', () => {
    expect(fingerprintProposal('interview', { company: 'Acme Recruiting' }, 'c')).toBe(
      fingerprintProposal('interview', { company: '  ACME RECRUITING ' }, 'c'),
    );
  });

  it('CHANGES WHEN THE APPOINTMENT MOVES', () => {
    const a = fingerprintProposal('interview', { scheduled_at: '2026-09-15T19:00Z' }, 'c');
    const b = fingerprintProposal('interview', { scheduled_at: '2026-09-16T19:00Z' }, 'c');
    expect(a).not.toBe(b);
  });

  it('CHANGES WHEN THE CANDIDATE CHANGES', () => {
    expect(fingerprintProposal('interview', { scheduled_at: 'X' }, 'cand-1')).not.toBe(
      fingerprintProposal('interview', { scheduled_at: 'X' }, 'cand-2'),
    );
  });

  it('folds the two shapes an interview proposal can take into one field', () => {
    const view = materialView(
      'interview',
      { interview_date: '2026-09-15', interview_time: '15:00' },
      'c',
    );
    expect(view.when).toBe('2026-09-15t15:00');
  });

  it('is a sha256 hex digest, not a timestamp or a counter', () => {
    expect(fingerprintProposal('interview', { company: 'Acme' }, 'c')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('names which material field moved', () => {
    const diff = materialDifferences(
      'interview',
      { company: 'Acme', scheduled_at: '2026-09-15T19:00Z' },
      { company: 'Acme', scheduled_at: '2026-09-16T19:00Z' },
      'c',
      'c',
    );
    expect(diff).toEqual(['when']);
  });

  it('COVERS EVERY FIELD THE BRIEF CALLS MATERIAL', () => {
    // A field quietly dropped from this list is a change that would stop
    // raising a conflict, which is the silent failure this build exists to fix.
    expect(MATERIAL_FIELDS.interview).toEqual([
      'candidate',
      'company',
      'job_title',
      'when',
      'time_zone',
      'meeting_url',
      'external_reference',
    ]);
    expect(MATERIAL_FIELDS.assessment).toContain('due_date');
    expect(MATERIAL_FIELDS.assessment).toContain('assessment_type');
    expect(MATERIAL_FIELDS.application).toContain('external_reference');
  });
});

/* =========================================================================
 * A — SAME EMAIL, SAME INTERPRETATION
 * ========================================================================= */
describe('A. the same reading again', () => {
  const first = decide(input({ extracted: INTERVIEW }));

  it('is idempotent and asks nobody anything', () => {
    const second = decide(input({ extracted: INTERVIEW, alreadyActioned: priorFrom(first) }));

    expect(first.outcome).toBe('auto_approve');
    expect(second.outcome).toBe('ignore');
    expect(second.reasonCodes).toEqual([]);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.interpretationChange).toBeNull();
  });
});

/* =========================================================================
 * B–E, G — MATERIAL CHANGES
 * ========================================================================= */
describe('a materially changed reading', () => {
  const first = decide(input({ extracted: INTERVIEW }));
  const prior = priorFrom(first);

  const changed = (extracted: Record<string, unknown>, overrides: Partial<DecisionInput> = {}) =>
    decide(input({ extracted, alreadyActioned: prior, ...overrides }));

  it('B. a changed interview TIME goes to review, and creates nothing', () => {
    const d = changed({ ...INTERVIEW, interview_time: '16:00' });
    expect(d.outcome).toBe('review_required');
    expect(d.reasonCodes).toContain('interpretation_changed');
    expect(d.priority).toBe('high');
    expect(d.interpretationChange?.changedFields).toContain('when');
  });

  it('C. a changed interview DATE goes to review', () => {
    const d = changed({ ...INTERVIEW, interview_date: '2026-09-16' });
    expect(d.outcome).toBe('review_required');
    expect(d.reasonCodes).toContain('interpretation_changed');
    expect(d.interpretationChange?.changedFields).toContain('when');
  });

  it('C2. a changed TIME ZONE goes to review', () => {
    const d = changed({ ...INTERVIEW, timezone: 'Europe/London' });
    expect(d.outcome).toBe('review_required');
    expect(d.reasonCodes).toContain('interpretation_changed');
  });

  it('D. A CHANGED CANDIDATE GOES TO REVIEW', () => {
    const d = changed(INTERVIEW, {
      candidateId: OTHER_CANDIDATE.id,
      candidate: OTHER_CANDIDATE,
    });
    expect(d.outcome).toBe('review_required');
    expect(d.reasonCodes).toContain('interpretation_changed');
    expect(d.interpretationChange?.changedFields).toContain('candidate');
  });

  it('G. a changed COMPANY AND ROLE goes to review', () => {
    const d = changed({
      ...INTERVIEW,
      company: 'Northwind Clinical',
      job_title: 'Clinical Data Manager',
    });
    expect(d.outcome).toBe('review_required');
    expect(d.reasonCodes).toContain('interpretation_changed');
    expect(d.interpretationChange?.changedFields).toContain('company');
  });

  it('E. A CHANGED ASSESSMENT DEADLINE GOES TO REVIEW', () => {
    const firstAssessment = decide(input({ eventType: 'assessment', extracted: ASSESSMENT }));
    expect(firstAssessment.outcome).toBe('auto_approve');

    const second = decide(
      input({
        eventType: 'assessment',
        extracted: { ...ASSESSMENT, due_date: '2026-09-27' },
        alreadyActioned: priorFrom(firstAssessment, {
          createdRecordId: 'assessment-9',
          createdRecordKind: 'assessment',
        }),
      }),
    );

    expect(second.outcome).toBe('review_required');
    expect(second.reasonCodes).toContain('interpretation_changed');
    expect(second.interpretationChange?.changedFields).toContain('due_date');
  });

  it('NEVER PROPOSES A SECOND RECORD — it names the one already on file', () => {
    const d = changed({ ...INTERVIEW, interview_date: '2026-09-16' });
    expect(d.relatedRecordId).toBe('interview-123');
    expect(d.interpretationChange?.existingRecordId).toBe('interview-123');
    expect(d.interpretationChange?.existingRecordKind).toBe('interview');
    // Nothing in the decision asks for the existing record to be edited or
    // cancelled: the only proposal is the new one, held for a person.
    expect(d.outcome).not.toBe('auto_approve');
  });

  it('KEEPS BOTH READINGS LEGIBLE', () => {
    const d = changed({ ...INTERVIEW, interview_date: '2026-09-16' });
    expect(d.interpretationChange?.previousFingerprint).toBe(first.fingerprint);
    expect(d.fingerprint).not.toBe(first.fingerprint);
    expect(d.interpretationChange?.previousData).toEqual(first.proposedData);
    expect(d.proposedData).not.toEqual(first.proposedData);
  });

  it('says so in words a reviewer can act on, without model reasoning', () => {
    const d = changed({ ...INTERVIEW, interview_date: '2026-09-16' });
    expect(d.explanation).toMatch(/differs from the proposal previously acted upon/);
    expect(d.explanation).toMatch(/Nothing already on file has been changed/);
    expect(d.explanation).not.toMatch(/reasoning|chain of thought|the model thinks/i);
  });

  it('keeps the reasons it would have been held for anyway', () => {
    // Materially changed AND missing a time zone: both are named.
    const d = changed({ ...INTERVIEW, interview_time: '16:00', timezone: null });
    expect(d.reasonCodes).toContain('interpretation_changed');
    expect(d.reasonCodes).toContain('missing_timezone');
  });

  it('a changed reading after a REJECTION is still shown to a person', () => {
    const d = decide(
      input({
        extracted: { ...INTERVIEW, interview_date: '2026-09-16' },
        alreadyActioned: priorFrom(first, {
          status: 'rejected',
          createdRecordId: null,
          createdRecordKind: null,
        }),
      }),
    );
    expect(d.outcome).toBe('review_required');
    expect(d.reasonCodes).toContain('interpretation_changed');
  });
});

/* =========================================================================
 * F — NON-MATERIAL CHANGES
 * ========================================================================= */
describe('F. a non-material change', () => {
  const first = decide(input({ extracted: INTERVIEW }));

  it('IS NOT A CONFLICT — different key order, same proposal', () => {
    const reordered = {
      meeting_url: INTERVIEW.meeting_url,
      timezone: INTERVIEW.timezone,
      interview_time: INTERVIEW.interview_time,
      interview_date: INTERVIEW.interview_date,
      job_title: INTERVIEW.job_title,
      company: INTERVIEW.company,
    };
    const second = decide(input({ extracted: reordered, alreadyActioned: priorFrom(first) }));

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.outcome).toBe('ignore');
    expect(second.reasonCodes).not.toContain('interpretation_changed');
  });

  it('is not a conflict when only the interviewer name changed', () => {
    const second = decide(
      input({
        extracted: { ...INTERVIEW, interviewer: 'A Different Person' },
        alreadyActioned: priorFrom(first),
      }),
    );
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.outcome).toBe('ignore');
  });

  it('is not a conflict when the company is written in a different case', () => {
    const second = decide(
      input({
        extracted: { ...INTERVIEW, company: 'ACME RECRUITING' },
        alreadyActioned: priorFrom(first),
      }),
    );
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.outcome).toBe('ignore');
  });
});
