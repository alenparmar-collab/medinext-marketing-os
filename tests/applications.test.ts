import { describe, expect, it } from 'vitest';
import {
  ApplicationCreateSchema,
  ApplicationUpdateSchema,
  ApplicationStatusChangeSchema,
} from '@/server/modules/applications/schemas';
import { ActivityCreateSchema } from '@/server/modules/activities/schemas';
import { NoteCreateSchema } from '@/server/modules/notes/schemas';
import {
  APPLICATION_STATUSES,
  MANUAL_ACTIVITY_TYPES,
  ACTIVITY_TYPE_META,
} from '@/config/statuses';

const CANDIDATE = '00000000-0000-4000-a000-000000000001';
const APPLICATION = '00000000-0000-4000-8f00-000000000001';

function application(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: CANDIDATE,
    companyName: 'Northwind Clinical',
    positionTitle: 'Clinical Data Manager',
    applicationDate: '2026-03-01',
    ...overrides,
  };
}

describe('ApplicationCreateSchema', () => {
  it('accepts the required fields alone', () => {
    expect(ApplicationCreateSchema.safeParse(application()).success).toBe(true);
  });

  it('defaults a new application to submitted', () => {
    expect(ApplicationCreateSchema.parse(application()).status).toBe('submitted');
  });

  it.each(['companyName', 'positionTitle'])('rejects a blank %s', (field) => {
    expect(ApplicationCreateSchema.safeParse(application({ [field]: '   ' })).success).toBe(false);
  });

  it('rejects a non-ISO application date', () => {
    expect(ApplicationCreateSchema.safeParse(application({ applicationDate: '01/03/2026' })).success)
      .toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(ApplicationCreateSchema.safeParse(application({ status: 'hired' })).success).toBe(false);
  });

  it('accepts every status in the controlled model', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(ApplicationCreateSchema.safeParse(application({ status })).success).toBe(true);
    }
  });

  it('rejects a job URL that is not a URL', () => {
    expect(ApplicationCreateSchema.safeParse(application({ jobUrl: 'careers.example.test' })).success)
      .toBe(false);
  });

  it('accepts an empty job URL as absent rather than invalid', () => {
    const result = ApplicationCreateSchema.parse(application({ jobUrl: '' }));
    expect(result.jobUrl).toBeNull();
  });

  it('accepts a job location with no bearing on the candidate location', () => {
    // There is no mismatch rule anywhere in this product.
    const result = ApplicationCreateSchema.parse(application({ jobLocation: 'Tokyo, JP' }));
    expect(result.jobLocation).toBe('Tokyo, JP');
  });

  it('does not accept a business unit from the caller', () => {
    // Tenancy is resolved server-side from the candidate; a client-supplied
    // value would be a footgun at best.
    const parsed = ApplicationCreateSchema.parse(
      application({ businessUnitId: '00000000-0000-4000-9000-000000000009' }),
    );
    expect('businessUnitId' in parsed).toBe(false);
  });
});

describe('ApplicationUpdateSchema', () => {
  it('requires the application id', () => {
    expect(ApplicationUpdateSchema.safeParse({ companyName: 'X' }).success).toBe(false);
  });

  it('allows a partial edit', () => {
    const result = ApplicationUpdateSchema.safeParse({
      applicationId: APPLICATION,
      companyName: 'Renamed Co',
    });
    expect(result.success).toBe(true);
  });

  it('cannot move an application to a different candidate', () => {
    const parsed = ApplicationUpdateSchema.parse({
      applicationId: APPLICATION,
      candidateId: '00000000-0000-4000-a000-000000000002',
    });
    expect('candidateId' in parsed).toBe(false);
  });
});

describe('ApplicationStatusChangeSchema', () => {
  it('accepts a transition with a note', () => {
    const result = ApplicationStatusChangeSchema.safeParse({
      applicationId: APPLICATION,
      status: 'interview',
      note: 'Scheduled for Thursday.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a status outside the controlled model', () => {
    expect(
      ApplicationStatusChangeSchema.safeParse({ applicationId: APPLICATION, status: 'maybe' })
        .success,
    ).toBe(false);
  });
});

describe('ActivityCreateSchema', () => {
  const activity = (overrides: Record<string, unknown> = {}) => ({
    candidateId: CANDIDATE,
    activityType: 'interview',
    activityDate: '2026-03-02T10:00',
    summary: 'First round',
    ...overrides,
  });

  it('accepts a manually loggable activity', () => {
    expect(ActivityCreateSchema.safeParse(activity()).success).toBe(true);
  });

  /**
   * The database writes these automatically when an application is created or
   * moved. Accepting them here would let someone log an application that does
   * not exist, and the derived counts would stop matching the records.
   */
  it.each(['application_submitted', 'status_change'])(
    'refuses to log %s by hand',
    (activityType) => {
      expect(ActivityCreateSchema.safeParse(activity({ activityType })).success).toBe(false);
    },
  );

  it('accepts every manually loggable type', () => {
    for (const activityType of MANUAL_ACTIVITY_TYPES) {
      expect(ActivityCreateSchema.safeParse(activity({ activityType })).success).toBe(true);
    }
  });

  it('rejects an unparseable date', () => {
    expect(ActivityCreateSchema.safeParse(activity({ activityDate: 'thursday' })).success).toBe(
      false,
    );
  });

  it('requires a summary', () => {
    expect(ActivityCreateSchema.safeParse(activity({ summary: '  ' })).success).toBe(false);
  });
});

describe('NoteCreateSchema', () => {
  it('requires a body', () => {
    expect(NoteCreateSchema.safeParse({ candidateId: CANDIDATE, body: '   ' }).success).toBe(false);
  });

  it('accepts a note without a business unit from the caller', () => {
    expect(NoteCreateSchema.safeParse({ candidateId: CANDIDATE, body: 'Internal.' }).success).toBe(
      true,
    );
  });
});

describe('activity type metadata', () => {
  it('marks notes as never candidate-visible', () => {
    expect(ACTIVITY_TYPE_META.note.candidateVisible).toBe(false);
  });

  it('marks the automatic types as not manually loggable', () => {
    expect(ACTIVITY_TYPE_META.application_submitted.manuallyLoggable).toBe(false);
    expect(ACTIVITY_TYPE_META.status_change.manuallyLoggable).toBe(false);
  });
});
