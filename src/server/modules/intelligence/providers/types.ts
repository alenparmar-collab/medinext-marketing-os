/**
 * The provider boundary.
 *
 * Above it: an email, some thread context, and a structured reading back.
 * Below it: whichever vendor, whichever response envelope, whichever way that
 * vendor spells "return JSON". Nothing vendor-shaped crosses.
 */

/** Exactly what is sent to the provider. Nothing else in the system is. */
export interface InterpretationRequest {
  /** The message being read. */
  message: {
    subject: string | null;
    fromAddress: string;
    fromName: string | null;
    toAddresses: string[];
    receivedAt: string;
    body: string;
    attachmentNames: string[];
  };
  /**
   * Earlier messages from the SAME thread, oldest first, heavily trimmed.
   * A reply of "Thursday at 3pm works" is meaningless without them.
   */
  threadContext: {
    subject: string | null;
    fromAddress: string;
    receivedAt: string;
    body: string;
  }[];
}

export interface InterpretationResponse {
  /** Unvalidated. The caller validates before anything is stored. */
  raw: unknown;
  model: string;
  /** Reported by the provider where available; used for cost visibility only. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface EmailIntelligenceProvider {
  readonly kind: 'openai' | 'fixture';
  readonly model: string;
  interpret(request: InterpretationRequest): Promise<InterpretationResponse>;
}

export class ProviderUnavailableError extends Error {
  readonly isTransient = true;
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRefusedError';
  }
}
