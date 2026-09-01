/**
 * One error type with a stable code.
 *
 * The UI maps codes to copy. Database messages are never concatenated into
 * user-facing strings — they leak schema details and read as noise to the
 * person who hit the problem.
 */
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'RATE_LIMITED'
  // Something was written and the bookkeeping that follows it was not. Distinct
  // from INTERNAL because the honest instruction to the person is the opposite:
  // do NOT simply try again.
  | 'PARTIAL_FAILURE'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;
  /**
   * Structured facts about a failure, for the cases where a sentence is not
   * enough to recover from. Used by PARTIAL_FAILURE, which has to say exactly
   * which record was created before the bookkeeping failed — a message alone
   * leaves the reviewer to guess, and the wrong guess is a duplicate.
   *
   * Never rendered raw to a candidate; the portal shows USER_FACING_MESSAGE.
   */
  readonly details?: Record<string, string | null>;

  constructor(
    code: ErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
    details?: Record<string, string | null>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (fieldErrors) this.fieldErrors = fieldErrors;
    if (details) this.details = details;
  }
}

export const USER_FACING_MESSAGE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'We could not find that record.',
  VALIDATION: 'Please check the highlighted fields.',
  CONFLICT: 'That change conflicts with existing data.',
  PRECONDITION_FAILED: 'That action is not available in the record’s current state.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  PARTIAL_FAILURE:
    'Part of that action completed. Check the record before trying again — repeating it may create a duplicate.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
};

export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ErrorCode;
      message: string;
      fieldErrors?: Record<string, string[]>;
      requestId: string;
    };

/**
 * Maps a PostgreSQL error to an ErrorCode.
 *
 * 42501 is what RLS raises on a WITH CHECK violation. Reporting it as FORBIDDEN
 * rather than INTERNAL is the difference between "you can't do that" and "the
 * app is broken".
 */
export function codeFromPostgresError(pgCode: string | undefined): ErrorCode {
  switch (pgCode) {
    case '42501':
      return 'FORBIDDEN';
    case '23505':
      return 'CONFLICT';
    case '23503':
    case '23514':
    case '23502':
      return 'VALIDATION';
    case 'P0001':
      return 'PRECONDITION_FAILED';
    default:
      return 'INTERNAL';
  }
}
