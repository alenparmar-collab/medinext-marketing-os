import type { SourceKind } from '@/config/statuses';

/**
 * How a record came to exist, passed to the existing create commands.
 *
 * Build 7B needed CRM records that carry honest provenance: created by the
 * pipeline, sourced from an email, and — when written without a person looking
 * — NOT verified. Rather than a second set of insert functions, the existing
 * commands take this optional argument and default to what they did before.
 *
 * The alternative was a parallel write path for automated records, which would
 * have meant two places to keep the business rules, the triggers and the
 * attribution correct. One of them would have drifted.
 */
export interface CommandProvenance {
  sourceType: SourceKind;
  /** e.g. `intelligence:<run id>` — traceable back to the reading. */
  sourceReference: string | null;
  /**
   * Whether a person has confirmed this record.
   *
   * False for an automatic write. The record exists and counts, but it is
   * marked unverified, which is exactly what the source/interpretation/verified
   * separation has meant since Build 1.
   */
  verified: boolean;
}

/** What a hand-typed record has always meant: a person entered it, so a person verified it. */
export const MANUAL_PROVENANCE: CommandProvenance = {
  sourceType: 'manual',
  sourceReference: null,
  verified: true,
};

export function provenanceColumns(
  provenance: CommandProvenance,
  actorId: string,
): {
  source_type: SourceKind;
  source_reference: string | null;
  verified_at: string | null;
  verified_by: string | null;
} {
  return {
    source_type: provenance.sourceType,
    source_reference: provenance.sourceReference,
    verified_at: provenance.verified ? new Date().toISOString() : null,
    verified_by: provenance.verified ? actorId : null,
  };
}
