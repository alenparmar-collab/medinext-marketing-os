import { z } from 'zod';
import {
  uuid,
  email,
  phone,
  requiredText,
  optionalText,
  commaSeparatedList,
  newlineSeparatedList,
} from '@/lib/validation/primitives';
import { MARKETING_STATUSES } from '@/config/statuses';

/**
 * PRODUCT RULE: preferred locations are OPTIONAL.
 *
 * There is no `.min(1)` here, no default that implies one is expected, and
 * nothing anywhere in this codebase that compares preferred_locations against
 * current_location or against a job. A candidate with no preferred location is
 * a completely ordinary candidate.
 *
 * One per line rather than comma separated: real locations contain commas
 * ("Manchester, UK"), and splitting on them turns one location into two.
 */
const preferredLocations = newlineSeparatedList(20);

export const CandidateCreateSchema = z.object({
  businessUnitId: uuid,
  fullName: requiredText('Full name', 160),
  email,
  phone,
  primarySkill: optionalText(120),
  skills: commaSeparatedList(30),
  /**
   * An empty field means UNKNOWN, not zero.
   *
   * `z.coerce.number()` turns '' into 0, which would silently record a
   * ten-year veteran as having no experience if the field were left blank. The
   * preprocess step is what keeps "not recorded" distinct from "none".
   */
  totalExperienceMonths: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z.coerce.number().int().min(0).max(720).nullable(),
  ),
  currentLocation: optionalText(160),
  visaStatus: optionalText(120),
  education: optionalText(400),
  certifications: commaSeparatedList(30),
  preferredLocations,
  marketingStatus: z.enum(MARKETING_STATUSES).default('onboarding'),
});

export type CandidateCreateInput = z.infer<typeof CandidateCreateSchema>;

export const CandidateUpdateSchema = CandidateCreateSchema.partial()
  .omit({ businessUnitId: true })
  .extend({ candidateId: uuid });

export type CandidateUpdateInput = z.infer<typeof CandidateUpdateSchema>;

export const CandidateListParamsSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(MARKETING_STATUSES).optional(),
  assignedTo: uuid.optional(),
  includeArchived: z.boolean().default(false),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export type CandidateListParams = z.infer<typeof CandidateListParamsSchema>;

export const CandidateArchiveSchema = z.object({
  candidateId: uuid,
  archived: z.boolean(),
});
