import type { Interpretation } from '../schema';
import {
  ProviderUnavailableError,
  type EmailIntelligenceProvider,
  type InterpretationRequest,
  type InterpretationResponse,
} from './types';

/**
 * A provider that returns whatever a test tells it to.
 *
 * Its purpose is to make the pipeline testable without a network, a key or a
 * bill — and, more usefully, to make the failure cases reachable. A malformed
 * response, a confidence of 4, an interview date of "next Tuesday": all of
 * those are things a real model does occasionally and a test needs to produce
 * on demand.
 *
 * It is also what `INTELLIGENCE_PROVIDER=fixture` selects in development.
 */
export class FixtureIntelligenceProvider implements EmailIntelligenceProvider {
  readonly kind = 'fixture' as const;
  readonly model: string;

  /** Requests served, so a test can assert a filtered email cost nothing. */
  callCount = 0;
  /** The last request sent, so a test can assert what left the building. */
  lastRequest: InterpretationRequest | null = null;

  constructor(
    private readonly responder:
      | unknown
      | ((request: InterpretationRequest) => unknown)
      | { failWith: Error },
    model = 'fixture-v1',
  ) {
    this.model = model;
  }

  async interpret(request: InterpretationRequest): Promise<InterpretationResponse> {
    this.callCount += 1;
    this.lastRequest = request;

    if (
      typeof this.responder === 'object' &&
      this.responder !== null &&
      'failWith' in this.responder
    ) {
      throw (this.responder as { failWith: Error }).failWith;
    }

    const raw =
      typeof this.responder === 'function'
        ? (this.responder as (r: InterpretationRequest) => unknown)(request)
        : this.responder;

    return { raw, model: this.model };
  }
}

/** A valid interpretation with sensible defaults, for tests and fixtures. */
export function fixtureInterpretation(
  overrides: Partial<Interpretation> = {},
): Interpretation {
  return {
    event_type: 'other',
    event_confidence: 0.5,
    summary: 'An email.',
    observed_identifiers: { email_addresses: [], phone_numbers: [], person_names: [] },
    extracted_data: {
      company: null,
      job_title: null,
      external_reference: null,
      application_date: null,
      interview_date: null,
      interview_time: null,
      timezone: null,
      interview_mode: null,
      meeting_url: null,
      interviewer: null,
      interview_type: null,
      assessment_name: null,
      assessment_type: null,
      due_date: null,
      assessment_url: null,
      rejection_date: null,
      reason_if_explicit: null,
      response_summary: null,
    },
    evidence: [],
    ...overrides,
  };
}

/** A provider that is always unavailable, for retry and failure tests. */
export function unavailableProvider(): EmailIntelligenceProvider {
  return new FixtureIntelligenceProvider({
    failWith: new ProviderUnavailableError('the provider is unavailable'),
  });
}
