import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decide,
  resolveTimeZone,
  describeSender,
  describeCandidateMismatch,
  combine,
  type DecisionInput,
} from '@/server/modules/decisions/engine';
import { CONFIDENCE } from '@/config/intelligence';
import { AUTOMATION, MAX_EVENT_AGE_DAYS } from '@/config/decisions';

/**
 * The decision engine is pure, so these drive it directly. Every rule that
 * decides whether something is written without a person is exercised here,
 * one at a time.
 */
const NOW = new Date('2026-09-10T09:00:00.000Z');
const RECENT = '2026-09-09T09:00:00.000Z';

const CANDIDATE = { id: 'cand-1', fullName: 'Vishnu Kumar', email: 'vishnu.kumar@example.invalid' };

const APPLICATION = {
  id: 'app-1',
  companyName: 'Acme Recruiting',
  positionTitle: 'Senior Java Developer',
  jobId: 'ACME-77',
  status: 'submitted',
  applicationDate: '2026-09-01',
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
    eventConfidence: 0.95,
    candidateId: CANDIDATE.id,
    candidateMatchConfidence: 0.95,
    candidate: CANDIDATE,
    extracted: {},
    emailBody: 'Interview details.',
    emailFromAddress: 'recruiter@acmerecruiting.invalid',
    emailReceivedAt: RECENT,
    existingApplications: [APPLICATION],
    existingInterviews: [],
    existingAssessments: [],
    alreadyActioned: null,
    actorPermissions: ALL_PERMISSIONS,
    now: NOW,
    ...overrides,
  };
}

const COMPLETE_INTERVIEW = {
  company: 'Acme Recruiting',
  job_title: 'Senior Java Developer',
  interview_date: '2026-09-15',
  interview_time: '15:00',
  timezone: 'America/New_York',
  meeting_url: 'https://example.invalid/interview',
};

/* =========================================================================
 * AUTO-APPROVE — the three cases that may be written without a person
 * ========================================================================= */
describe('auto-approval', () => {
  it('1. writes a complete, high-confidence application', () => {
    const decision = decide(
      input({
        eventType: 'application',
        emailFromAddress: 'careers@northwind.invalid',
        extracted: { company: 'Northwind Clinical', job_title: 'Data Manager' },
        existingApplications: [],
      }),
    );

    expect(decision.outcome).toBe('auto_approve');
    expect(decision.reasonCodes).toEqual([]);
  });

  it('2. writes a complete, high-confidence interview', () => {
    const decision = decide(input({ extracted: COMPLETE_INTERVIEW }));

    expect(decision.outcome).toBe('auto_approve');
    expect(decision.proposedData.application_id).toBe(APPLICATION.id);
    expect(decision.proposedData.time_zone).toBe('America/New_York');
    // 15:00 New York in September is 19:00 UTC — resolved through the zone's
    // actual offset at that moment, not a fixed one.
    expect(decision.proposedData.scheduled_at).toBe('2026-09-15T19:00:00.000Z');
  });

  it('3. writes a complete, high-confidence assessment', () => {
    const decision = decide(
      input({
        eventType: 'assessment',
        extracted: {
          company: 'Acme Recruiting',
          job_title: 'Senior Java Developer',
          assessment_name: 'Java coding exercise',
          due_date: '2026-09-20',
        },
      }),
    );

    expect(decision.outcome).toBe('auto_approve');
    expect(decision.proposedData.application_id).toBe(APPLICATION.id);
  });
});

/* =========================================================================
 * REVIEW — everything else
 * ========================================================================= */
describe('review is required when', () => {
  it('4. the candidate match is below the threshold', () => {
    const decision = decide(
      input({ extracted: COMPLETE_INTERVIEW, candidateMatchConfidence: 0.8 }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('low_candidate_confidence');
    expect(0.8).toBeLessThan(CONFIDENCE.high);
  });

  it('5. no candidate could be identified', () => {
    const decision = decide(
      input({ extracted: COMPLETE_INTERVIEW, candidateId: null, candidateMatchConfidence: null }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('no_candidate_match');
  });

  it('6. A TIME IS GIVEN WITH NO TIME ZONE', () => {
    // The rule the build is most careful about. Nothing is assumed: not the
    // server's zone, not the candidate's, not the company's.
    const decision = decide(
      input({
        extracted: { ...COMPLETE_INTERVIEW, timezone: null },
        emailBody: 'Can we speak Thursday at 3?',
      }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('missing_timezone');
    expect(decision.proposedData.time_zone).toBeNull();
  });

  it('7. a required field is missing', () => {
    const decision = decide(
      input({ extracted: { ...COMPLETE_INTERVIEW, company: null } }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('missing_required_field');
  });

  it('8. an application already exists for that company and role', () => {
    const decision = decide(
      input({
        eventType: 'application',
        extracted: { company: 'Acme Recruiting', job_title: 'Senior Java Developer' },
      }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('duplicate_detected');
    expect(decision.relatedRecordId).toBe(APPLICATION.id);
  });

  it('9. an interview already exists at the same moment', () => {
    const decision = decide(
      input({
        extracted: COMPLETE_INTERVIEW,
        existingInterviews: [
          {
            id: 'iv-1',
            applicationId: APPLICATION.id,
            scheduledAt: '2026-09-15T19:00:00.000Z',
            status: 'scheduled',
          },
        ],
      }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('duplicate_detected');
  });

  it('10. AN INTERVIEW EXISTS AT A DIFFERENT TIME — a possible reschedule', () => {
    const decision = decide(
      input({
        extracted: COMPLETE_INTERVIEW,
        existingInterviews: [
          {
            id: 'iv-1',
            applicationId: APPLICATION.id,
            scheduledAt: '2026-09-15T17:00:00.000Z',
            status: 'scheduled',
          },
        ],
      }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('conflict_detected');
    // Explained rather than merely flagged.
    expect(decision.explanation).toContain('reschedule');
  });

  it('11. a rejection cannot be tied to one application', () => {
    const decision = decide(
      input({
        eventType: 'rejection',
        extracted: { company: 'Somewhere Else', job_title: 'Unknown role' },
      }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('status_transition_not_allowed');
  });

  it('11b. A REJECTION IS NEVER WRITTEN AUTOMATICALLY, EVEN WHEN PERFECT', () => {
    // Everything matches — candidate, company, role, an open application — and
    // it still waits for a person. Telling somebody they are out of a process
    // they are still in is the one mistake here that cannot be taken back.
    const decision = decide(
      input({
        eventType: 'rejection',
        extracted: { company: 'Acme Recruiting', job_title: 'Senior Java Developer' },
      }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(AUTOMATION.rejection?.automatable).toBe(false);
    expect(decision.proposedData.application_id).toBe(APPLICATION.id);
  });

  it('12. the email is a recruiter response', () => {
    const decision = decide(
      input({ eventType: 'recruiter_response', extracted: { company: 'Acme Recruiting' } }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('unsupported_event');
  });

  it('13. the sender does not appear to be the company named', () => {
    const decision = decide(
      input({ extracted: COMPLETE_INTERVIEW, emailFromAddress: 'someone@gmail.com' }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('third_party_sender');
    // Neutral wording: an observation, never an accusation.
    expect(decision.explanation).toContain('general mail provider');
    expect(decision.explanation.toLowerCase()).not.toContain('fake');
    expect(decision.explanation.toLowerCase()).not.toContain('fraud');
    expect(decision.explanation.toLowerCase()).not.toContain('suspicious');
  });

  it('14. the email names the candidate differently from the record', () => {
    const decision = decide(
      input({
        extracted: COMPLETE_INTERVIEW,
        emailBody: 'Hi Vishnu K., your interview is confirmed.',
      }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('conflicting_candidate_information');
    expect(decision.explanation).toContain('Vishnu K');
    expect(decision.explanation).toContain('Vishnu Kumar');
    expect(decision.explanation).toContain('may be the same person');
  });

  it('the classification itself is uncertain', () => {
    const decision = decide(input({ extracted: COMPLETE_INTERVIEW, eventConfidence: 0.7 }));
    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('insufficient_evidence');
  });

  it('the requester could not create the record by hand', () => {
    // Automation has no authority of its own; it borrows the requester's.
    const decision = decide(
      input({ extracted: COMPLETE_INTERVIEW, actorPermissions: new Set(['application.create']) }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('actor_lacks_permission');
  });

  it('the email is old enough that the event may already have happened', () => {
    const decision = decide(
      input({ extracted: COMPLETE_INTERVIEW, emailReceivedAt: '2026-08-01T09:00:00.000Z' }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('stale_event');
    expect(MAX_EVENT_AGE_DAYS).toBeGreaterThan(0);
  });

  it('an assessment deadline disagrees with one on file', () => {
    const decision = decide(
      input({
        eventType: 'assessment',
        extracted: {
          company: 'Acme Recruiting',
          job_title: 'Senior Java Developer',
          assessment_name: 'Java coding exercise',
          due_date: '2026-09-22',
        },
        existingAssessments: [
          {
            id: 'as-1',
            applicationId: APPLICATION.id,
            assessmentType: 'Java coding exercise',
            deadline: '2026-09-19T23:59:00.000Z',
            status: 'pending',
          },
        ],
      }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('conflict_detected');
  });

  it('two applications to the same company for the same role are ambiguous', () => {
    const decision = decide(
      input({
        extracted: COMPLETE_INTERVIEW,
        existingApplications: [APPLICATION, { ...APPLICATION, id: 'app-2', jobId: null }],
      }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.proposedData.application_id).toBeNull();
  });
});

describe('nothing to do', () => {
  it('an irrelevant email is ignored without a person being asked', () => {
    const decision = decide(input({ eventType: 'other', extracted: {} }));

    expect(decision.outcome).toBe('ignore');
    expect(decision.priority).toBe('low');
  });
});

/* =========================================================================
 * Reprocessing — §22
 * ========================================================================= */
describe('reprocessing an email that was already acted on', () => {
  it('does nothing when the reading has not changed', () => {
    const decision = decide(
      input({
        extracted: COMPLETE_INTERVIEW,
        alreadyActioned: { status: 'approved', approvedData: COMPLETE_INTERVIEW },
      }),
    );

    expect(decision.outcome).toBe('ignore');
  });

  it('RAISES A CONFLICT WHEN THE NEW READING DISAGREES', () => {
    // A second blind interview is exactly what must not happen.
    const decision = decide(
      input({
        extracted: { ...COMPLETE_INTERVIEW, interview_date: '2026-09-16' },
        alreadyActioned: { status: 'approved', approvedData: COMPLETE_INTERVIEW },
      }),
    );

    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('conflict_detected');
    expect(decision.priority).toBe('high');
  });
});

/* =========================================================================
 * Priority — never chosen by the model
 * ========================================================================= */
describe('priority is derived, not proposed', () => {
  it('a conflict is high', () => {
    const decision = decide(
      input({
        extracted: COMPLETE_INTERVIEW,
        existingInterviews: [
          { id: 'iv-1', applicationId: APPLICATION.id, scheduledAt: '2026-09-15T17:00:00.000Z', status: 'scheduled' },
        ],
      }),
    );
    expect(decision.priority).toBe('high');
  });

  it('an incomplete interview is normal', () => {
    const decision = decide(input({ extracted: { ...COMPLETE_INTERVIEW, interview_time: null } }));
    expect(decision.priority).toBe('normal');
  });

  it('an ordinary duplicate is low', () => {
    const decision = decide(
      input({
        eventType: 'application',
        extracted: { company: 'Acme Recruiting', job_title: 'Senior Java Developer' },
      }),
    );
    expect(decision.priority).toBe('low');
  });
});

/* =========================================================================
 * The narrow inferences, tested on their own
 * ========================================================================= */
describe('time zone resolution', () => {
  it('accepts an IANA zone from the extraction', () => {
    expect(resolveTimeZone('America/New_York', '')).toBe('America/New_York');
  });

  it('resolves a zone named in the email body', () => {
    expect(resolveTimeZone(null, 'at 3 PM Eastern Time')).toBe('America/New_York');
    expect(resolveTimeZone(null, '14:00 London time')).toBe('Europe/London');
  });

  it('RETURNS NULL WHEN NO ZONE IS STATED', () => {
    expect(resolveTimeZone(null, 'Can we speak Thursday at 3?')).toBeNull();
  });

  it('does not match an abbreviation inside another word', () => {
    // "est" inside "interest" must not become America/New_York.
    expect(resolveTimeZone(null, 'We have a lot of interest in this role.')).toBeNull();
  });

  it('resolves the wall clock through the zone offset at that moment', () => {
    // Summer and winter differ; a fixed offset would be wrong on one side.
    expect(combine('2026-09-15', '15:00', 'America/New_York')).toBe('2026-09-15T19:00:00.000Z');
    expect(combine('2026-12-15', '15:00', 'America/New_York')).toBe('2026-12-15T20:00:00.000Z');
  });
});

describe('sender observation', () => {
  it('says nothing when the domain matches the company', () => {
    expect(describeSender('recruiter@northwind.invalid', 'Northwind Clinical')).toBeNull();
  });

  it('names a generic provider factually', () => {
    const note = describeSender('someone@gmail.com', 'Northwind Clinical');
    expect(note).toContain('gmail.com');
    expect(note).toContain('general mail provider');
  });

  it('describes a third party without accusing them', () => {
    const note = describeSender('jobs@talentbridge.invalid', 'Northwind Clinical');
    expect(note).toContain('third party');
    expect(note?.toLowerCase()).not.toContain('fraud');
  });
});

describe('candidate information mismatch', () => {
  it('says nothing when the full name appears', () => {
    expect(describeCandidateMismatch(CANDIDATE, 'Hi Vishnu Kumar, ...')).toBeNull();
  });

  it('describes an abbreviated name without accusing anyone', () => {
    const note = describeCandidateMismatch(CANDIDATE, 'Hi Vishnu K., your interview is confirmed.');
    expect(note).toContain('may be the same person');
  });
});

/* =========================================================================
 * The end-to-end example from the brief
 * ========================================================================= */
describe('the Acme interview, exactly as specified', () => {
  const decision = decide(
    input({
      eventType: 'interview',
      eventConfidence: 0.96,
      candidateMatchConfidence: 0.95,
      emailFromAddress: 'recruiter@acmerecruiting.invalid',
      emailBody:
        'Hi Vishnu Kumar,\n\nWe would like to invite you for an interview on September 15 at 3 PM Eastern Time.\n\nMeeting: https://example.invalid/interview\n\nRegards,\nAcme Recruiting',
      extracted: {
        company: 'Acme Recruiting',
        job_title: 'Senior Java Developer',
        interview_date: '2026-09-15',
        interview_time: '15:00',
        timezone: 'America/New_York',
        meeting_url: 'https://example.invalid/interview',
      },
    }),
  );

  it('is auto-approved', () => {
    expect(decision.outcome).toBe('auto_approve');
    expect(decision.reasonCodes).toEqual([]);
  });

  it('resolves the time correctly and keeps the zone', () => {
    expect(decision.proposedData.scheduled_at).toBe('2026-09-15T19:00:00.000Z');
    expect(decision.proposedData.time_zone).toBe('America/New_York');
  });

  it('attaches to the existing application and keeps the meeting link', () => {
    expect(decision.proposedData.application_id).toBe(APPLICATION.id);
    expect(decision.proposedData.meeting_url).toBe('https://example.invalid/interview');
  });
});

describe('the vague message from the brief', () => {
  const decision = decide(
    input({
      eventConfidence: 0.62,
      emailBody: 'Hi Vishnu, can we speak Thursday at 3?',
      extracted: {
        company: 'Acme Recruiting',
        interview_time: '15:00',
        timezone: null,
        interview_date: null,
      },
    }),
  );

  it('is held for review with the reasons named', () => {
    expect(decision.outcome).toBe('review_required');
    expect(decision.reasonCodes).toContain('missing_timezone');
    expect(decision.reasonCodes).toContain('missing_date');
    expect(decision.reasonCodes).toContain('insufficient_evidence');
  });

  it('creates nothing', () => {
    expect(decision.proposedData.scheduled_at).toBeUndefined();
  });
});

/* =========================================================================
 * The build boundary
 * ========================================================================= */
describe('the engine decides and nothing more', () => {
  const engineSource = readFileSync(
    resolve(process.cwd(), 'src/server/modules/decisions/engine.ts'),
    'utf8',
  );

  it('performs no I/O at all', () => {
    // Pure by construction: everything it needs is passed in, so every rule is
    // testable and the same input always gives the same decision.
    for (const forbidden of ['createServerSupabase', 'fetch(', 'withServiceRole', '.from(']) {
      expect(engineSource).not.toContain(forbidden);
    }
  });

  it('the pipeline writes through existing commands and never inserts directly', () => {
    const pipeline = readFileSync(
      resolve(process.cwd(), 'src/server/modules/decisions/pipeline.ts'),
      'utf8',
    );

    for (const command of [
      'createApplication',
      'createInterview',
      'createAssessment',
      'changeApplicationStatus',
    ]) {
      expect(pipeline).toContain(command);
    }

    // The only table this file writes is its own decision record.
    const writes =
      pipeline.match(/from\(\s*'([a-z_]+)'\s*\)[\s\S]{0,300}?\.(insert|upsert|update|delete)\(/g) ??
      [];
    for (const write of writes) {
      expect(write, write.slice(0, 80)).toMatch(/intelligence_review_items/);
    }
  });

  it('nothing in the decision layer sends a message', () => {
    const dir = 'src/server/modules/decisions';
    const files = readdirSync(resolve(process.cwd(), dir)).filter((f) => f.endsWith('.ts'));
    const forbidden = /twilio|whatsapp\b|sendmail|nodemailer|smtp\.|sendgrid|\bcampaign/i;

    for (const file of files) {
      const text = readFileSync(resolve(process.cwd(), `${dir}/${file}`), 'utf8');
      expect(forbidden.test(text), file).toBe(false);
    }
  });
});
