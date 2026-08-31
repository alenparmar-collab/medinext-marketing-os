import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  InterviewCreateSchema,
  InterviewRescheduleSchema,
  InterviewStatusSchema,
  InterviewUpdateSchema,
} from '@/server/modules/interviews/schemas';
import {
  AssessmentCreateSchema,
  AssessmentStatusSchema,
} from '@/server/modules/assessments/schemas';
import { DocumentUploadSchema, MAX_UPLOAD_BYTES } from '@/server/modules/documents/schemas';
import {
  INTERVIEW_STATUSES,
  ASSESSMENT_STATUSES,
  NOTIFICATION_TYPES,
  notificationHref,
} from '@/config/statuses';

const APPLICATION = '00000000-0000-4000-8f00-000000000001';
const INTERVIEW = '00000000-0000-4000-9200-000000000001';
const CANDIDATE = '00000000-0000-4000-a000-000000000001';

describe('InterviewCreateSchema', () => {
  const base = (o: Record<string, unknown> = {}) => ({
    applicationId: APPLICATION,
    scheduledAt: '2026-09-02T11:00',
    ...o,
  });

  it('accepts the minimum viable interview', () => {
    expect(InterviewCreateSchema.safeParse(base()).success).toBe(true);
  });

  it('defaults to round 1 and scheduled', () => {
    const parsed = InterviewCreateSchema.parse(base());
    expect(parsed.interviewRound).toBe(1);
    expect(parsed.status).toBe('scheduled');
  });

  /**
   * The candidate is derived from the application server-side. Accepting one
   * from the caller would create a field whose only possible values are
   * "redundant" or "an attack".
   */
  it('does not accept a candidate id from the caller', () => {
    const parsed = InterviewCreateSchema.parse(base({ candidateId: CANDIDATE }));
    expect('candidateId' in parsed).toBe(false);
  });

  it('does not accept a business unit from the caller', () => {
    const parsed = InterviewCreateSchema.parse(base({ businessUnitId: CANDIDATE }));
    expect('businessUnitId' in parsed).toBe(false);
  });

  it('rejects an unparseable date', () => {
    expect(InterviewCreateSchema.safeParse(base({ scheduledAt: 'thursday' })).success).toBe(false);
  });

  it('rejects a meeting URL that is not a URL', () => {
    expect(InterviewCreateSchema.safeParse(base({ meetingUrl: 'meet.example.test' })).success).toBe(
      false,
    );
  });

  it('treats an empty meeting URL as absent rather than invalid', () => {
    expect(InterviewCreateSchema.parse(base({ meetingUrl: '' })).meetingUrl).toBeNull();
  });

  it('rejects an absurd interview round', () => {
    expect(InterviewCreateSchema.safeParse(base({ interviewRound: 0 })).success).toBe(false);
    expect(InterviewCreateSchema.safeParse(base({ interviewRound: 99 })).success).toBe(false);
  });

  it('accepts every status in the controlled model', () => {
    for (const status of INTERVIEW_STATUSES) {
      expect(InterviewCreateSchema.safeParse(base({ status })).success).toBe(true);
    }
  });

  it('rejects a status outside the controlled model', () => {
    expect(InterviewCreateSchema.safeParse(base({ status: 'maybe' })).success).toBe(false);
  });
});

describe('InterviewUpdateSchema', () => {
  it('cannot change the scheduled time', () => {
    // Rescheduling is a separate action, because it writes history.
    const parsed = InterviewUpdateSchema.parse({
      interviewId: INTERVIEW,
      scheduledAt: '2026-09-03T14:00',
    });
    expect('scheduledAt' in parsed).toBe(false);
  });

  it('cannot move an interview to another application', () => {
    const parsed = InterviewUpdateSchema.parse({
      interviewId: INTERVIEW,
      applicationId: APPLICATION,
    });
    expect('applicationId' in parsed).toBe(false);
  });
});

describe('InterviewRescheduleSchema', () => {
  it('accepts a new time with a reason', () => {
    expect(
      InterviewRescheduleSchema.safeParse({
        interviewId: INTERVIEW,
        scheduledAt: '2026-09-03T14:00',
        reason: 'Interviewer unavailable.',
      }).success,
    ).toBe(true);
  });

  it('requires a new time', () => {
    expect(InterviewRescheduleSchema.safeParse({ interviewId: INTERVIEW }).success).toBe(false);
  });

  it('makes the reason optional', () => {
    expect(
      InterviewRescheduleSchema.safeParse({
        interviewId: INTERVIEW,
        scheduledAt: '2026-09-03T14:00',
      }).success,
    ).toBe(true);
  });
});

describe('InterviewStatusSchema', () => {
  it('rejects an unknown status', () => {
    expect(
      InterviewStatusSchema.safeParse({ interviewId: INTERVIEW, status: 'ghosted' }).success,
    ).toBe(false);
  });
});

describe('AssessmentCreateSchema', () => {
  const base = (o: Record<string, unknown> = {}) => ({
    applicationId: APPLICATION,
    assessmentType: 'SAS programming',
    receivedAt: '2026-09-01T09:00',
    ...o,
  });

  it('accepts the minimum viable assessment', () => {
    expect(AssessmentCreateSchema.safeParse(base()).success).toBe(true);
  });

  it('defaults to pending', () => {
    expect(AssessmentCreateSchema.parse(base()).status).toBe('pending');
  });

  it('rejects a deadline before the received date', () => {
    const result = AssessmentCreateSchema.safeParse(
      base({ receivedAt: '2026-09-05T09:00', deadline: '2026-09-01T09:00' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts a deadline after the received date', () => {
    expect(
      AssessmentCreateSchema.safeParse(base({ deadline: '2026-09-08T09:00' })).success,
    ).toBe(true);
  });

  it('requires an assessment type', () => {
    expect(AssessmentCreateSchema.safeParse(base({ assessmentType: '  ' })).success).toBe(false);
  });

  it('accepts every status in the controlled model', () => {
    for (const status of ASSESSMENT_STATUSES) {
      expect(AssessmentCreateSchema.safeParse(base({ status })).success).toBe(true);
    }
  });

  it('does not accept a candidate id from the caller', () => {
    const parsed = AssessmentCreateSchema.parse(base({ candidateId: CANDIDATE }));
    expect('candidateId' in parsed).toBe(false);
  });
});

describe('AssessmentStatusSchema', () => {
  it('accepts a status with an outcome', () => {
    expect(
      AssessmentStatusSchema.safeParse({
        assessmentId: INTERVIEW,
        status: 'passed',
        outcome: 'Scored 82%.',
      }).success,
    ).toBe(true);
  });
});

describe('DocumentUploadSchema', () => {
  const base = (o: Record<string, unknown> = {}) => ({
    candidateId: CANDIDATE,
    documentType: 'resume',
    fileName: 'cv.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    ...o,
  });

  it('accepts a plain PDF upload', () => {
    expect(DocumentUploadSchema.safeParse(base()).success).toBe(true);
  });

  it('rejects an executable disguised by name', () => {
    expect(
      DocumentUploadSchema.safeParse(base({ mimeType: 'application/x-msdownload' })).success,
    ).toBe(false);
  });

  it('rejects an empty file', () => {
    expect(DocumentUploadSchema.safeParse(base({ sizeBytes: 0 })).success).toBe(false);
  });

  it('rejects a file over the size limit', () => {
    expect(
      DocumentUploadSchema.safeParse(base({ sizeBytes: MAX_UPLOAD_BYTES + 1 })).success,
    ).toBe(false);
  });

  /**
   * The file name becomes part of a storage key. A path separator or a
   * traversal segment reaching that key would let an upload land outside the
   * candidate's own folder, which is the folder the storage policy checks.
   */
  it.each(['../escape.pdf', 'nested/path.pdf', 'windows\\path.pdf', '..'])(
    'rejects a path-bearing file name: %s',
    (fileName) => {
      expect(DocumentUploadSchema.safeParse(base({ fileName })).success).toBe(false);
    },
  );

  it('accepts a name with spaces and dots', () => {
    expect(DocumentUploadSchema.safeParse(base({ fileName: 'Priya Raman CV v2.pdf' })).success)
      .toBe(true);
  });
});

describe('notification routing', () => {
  it('sends a candidate to their own portal pages', () => {
    expect(notificationHref('interview', INTERVIEW, 'portal')).toBe('/portal/interviews');
    expect(notificationHref('assessment', INTERVIEW, 'portal')).toBe('/portal/assessments');
  });

  it('sends internal staff to the internal record', () => {
    expect(notificationHref('application', APPLICATION, 'internal')).toBe(
      `/applications/${APPLICATION}`,
    );
  });

  it('returns null rather than a broken link for an unknown entity', () => {
    expect(notificationHref('mystery', INTERVIEW, 'portal')).toBeNull();
    expect(notificationHref(null, null, 'internal')).toBeNull();
  });
});

describe('Build 4 config matches the database', () => {
  const sql = (f: string) => readFileSync(resolve(process.cwd(), 'supabase', f), 'utf8');
  const enums = sql('migrations/0018_interviews_and_assessments.sql');
  const notifications = sql('migrations/0019_notifications.sql');

  const enumValues = (text: string, name: string) => {
    const start = text.indexOf(`create type ${name} as enum`);
    const block = text.slice(start, text.indexOf(');', start));
    return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };

  it('interview statuses match the database enum exactly', () => {
    expect(enumValues(enums, 'interview_status')).toEqual([...INTERVIEW_STATUSES]);
  });

  it('assessment statuses match the database enum exactly', () => {
    expect(enumValues(enums, 'assessment_status')).toEqual([...ASSESSMENT_STATUSES]);
  });

  it('notification types match the database enum exactly', () => {
    expect(enumValues(notifications, 'notification_type')).toEqual([...NOTIFICATION_TYPES]);
  });

  it('keeps the notification dedupe index, which is the idempotency guarantee', () => {
    expect(notifications).toMatch(/create unique index notifications_dedupe_uk/);
    expect(notifications).toMatch(/on conflict \(recipient_id, dedupe_key\) do nothing/);
  });

  it('gives candidates no insert policy on notifications', () => {
    const rls = sql('migrations/0020_build4_rls.sql');
    expect(rls).not.toMatch(/create policy \w*notifications\w*_insert/);
  });
});
