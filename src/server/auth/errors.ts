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
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(code: ErrorCode, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (fieldErrors) this.fieldErrors = fieldErrors;
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
