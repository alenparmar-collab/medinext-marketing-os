import { describe, expect, it } from 'vitest';
import {
  CandidateCreateSchema,
  CandidateListParamsSchema,
} from '@/server/modules/candidates/schemas';
import { MarketingPeriodCreateSchema } from '@/server/modules/marketing/schemas';

const UNIT = '00000000-0000-4000-9000-000000000001';

function base(overrides: Record<string, unknown> = {}) {
  return {
    businessUnitId: UNIT,
    fullName: 'Test Person',
    email: 'test.person@demo.medinext.test',
    ...overrides,
  };
}

describe('CandidateCreateSchema', () => {
  it('accepts the minimum viable candidate', () => {
    const result = CandidateCreateSchema.safeParse(base());
    expect(result.success).toBe(true);
  });

  it('rejects a malformed email', () => {
    const result = CandidateCreateSchema.safeParse(base({ email: 'not-an-email' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('email'))).toBe(true);
    }
  });

  it('rejects a blank name', () => {
    expect(CandidateCreateSchema.safeParse(base({ fullName: '   ' })).success).toBe(false);
  });

  it('rejects a business unit that is not an identifier', () => {
    expect(CandidateCreateSchema.safeParse(base({ businessUnitId: 'unit-1' })).success).toBe(false);
  });

  it('rejects an unknown marketing status', () => {
    expect(CandidateCreateSchema.safeParse(base({ marketingStatus: 'sold' })).success).toBe(false);
  });

  it('normalises email case and surrounding whitespace', () => {
    const result = CandidateCreateSchema.parse(base({ email: '  MiXeD@Demo.Medinext.Test ' }));
    expect(result.email).toBe('mixed@demo.medinext.test');
  });

  /**
   * PRODUCT RULE: preferred location is optional.
   * These three assertions exist so a future change that makes it required
   * fails the suite rather than shipping.
   */
  describe('preferred locations are optional', () => {
    it('accepts a candidate with no preferred locations at all', () => {
      const result = CandidateCreateSchema.safeParse(base());
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.preferredLocations).toEqual([]);
    });

    it('accepts an explicitly empty preferred locations field', () => {
      const result = CandidateCreateSchema.safeParse(base({ preferredLocations: '' }));
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.preferredLocations).toEqual([]);
    });

    it('does not require preferred locations to relate to current location', () => {
      const result = CandidateCreateSchema.safeParse(
        base({ currentLocation: 'Manchester, UK', preferredLocations: 'Tokyo, JP' }),
      );
      expect(result.success).toBe(true);
      // No mismatch detection anywhere: a Manchester candidate preferring Tokyo
      // is simply a valid record.
      if (result.success) expect(result.data.preferredLocations).toEqual(['Tokyo, JP']);
    });

    it('keeps a comma-bearing location intact (one per line, not comma split)', () => {
      const result = CandidateCreateSchema.parse(
        base({ preferredLocations: 'London, UK\nDublin, IE' }),
      );
      expect(result.preferredLocations).toEqual(['London, UK', 'Dublin, IE']);
    });
  });

  it('splits, trims and de-duplicates comma separated lists', () => {
    const result = CandidateCreateSchema.parse(base({ skills: ' SAS , CDISC ,SAS,  ' }));
    expect(result.skills).toEqual(['SAS', 'CDISC']);
  });

  it('rejects negative or absurd experience', () => {
    expect(CandidateCreateSchema.safeParse(base({ totalExperienceMonths: -1 })).success).toBe(false);
    expect(CandidateCreateSchema.safeParse(base({ totalExperienceMonths: 5000 })).success).toBe(
      false,
    );
  });

  it('treats an empty experience field as unknown rather than zero', () => {
    const result = CandidateCreateSchema.parse(base({ totalExperienceMonths: '' }));
    expect(result.totalExperienceMonths).toBeNull();
  });
});

describe('CandidateListParamsSchema', () => {
  it('caps the page size so a caller cannot request everything', () => {
    expect(CandidateListParamsSchema.safeParse({ limit: 5000 }).success).toBe(false);
  });

  it('defaults to excluding archived candidates', () => {
    expect(CandidateListParamsSchema.parse({}).includeArchived).toBe(false);
  });
});

describe('MarketingPeriodCreateSchema', () => {
  const period = {
    candidateId: '00000000-0000-4000-a000-000000000001',
    businessUnitId: UNIT,
    startsOn: '2026-01-01',
  };

  it('accepts an open-ended period', () => {
    expect(MarketingPeriodCreateSchema.safeParse(period).success).toBe(true);
  });

  it('rejects an end date before the start date', () => {
    const result = MarketingPeriodCreateSchema.safeParse({ ...period, endsOn: '2025-12-01' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO date', () => {
    expect(MarketingPeriodCreateSchema.safeParse({ ...period, startsOn: '01/01/2026' }).success)
      .toBe(false);
  });

  it('accepts every status the product defines', () => {
    for (const status of [
      'onboarding',
      'ready_for_marketing',
      'active',
      'paused',
      'completed',
      'on_hold',
      'closed',
    ]) {
      expect(MarketingPeriodCreateSchema.safeParse({ ...period, status }).success).toBe(true);
    }
  });
});
