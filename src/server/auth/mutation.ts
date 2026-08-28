import 'server-only';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { getActor, can, type ActorContext } from './actor';
import { AppError, USER_FACING_MESSAGE, codeFromPostgresError, type Result } from './errors';
import type { PermissionCode } from '@/config/permissions';

/**
 * The single path every write in the product takes.
 *
 * Uniformity here is a correctness property, not a style preference: validation,
 * permission checks and error shaping cannot be forgotten in a hurry if there is
 * only one place they happen.
 *
 * Order of operations, always:
 *   1. Resolve the actor.               (no session -> UNAUTHENTICATED)
 *   2. Check the permission.            (against tables, not JWT claims)
 *   3. Validate the input with Zod.     (typed field errors, never a stack)
 *   4. Run the handler.
 *   5. Revalidate affected paths.
 *   6. Return a discriminated Result.
 *
 * Server actions never throw to the client: in production a thrown error becomes
 * an opaque digest, which is useless to a form that needs to highlight a field.
 */
export interface MutationConfig<TInput, TOutput> {
  /** Stable action name, used in logs and audit metadata. */
  name: string;
  permission: PermissionCode;
  schema: z.ZodType<TInput>;
  handler: (input: TInput, ctx: ActorContext) => Promise<TOutput>;
  revalidate?: (input: TInput, output: TOutput) => string[];
}

export function mutation<TInput, TOutput>(config: MutationConfig<TInput, TOutput>) {
  return async function run(rawInput: unknown): Promise<Result<TOutput>> {
    const requestId = randomUUID();

    try {
      const actor = await getActor();
      if (!actor) {
        return fail('UNAUTHENTICATED', requestId);
      }

      if (!can(actor, config.permission)) {
        return fail('FORBIDDEN', requestId);
      }

      const parsed = config.schema.safeParse(rawInput);
      if (!parsed.success) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join('.') || '_form';
          (fieldErrors[key] ??= []).push(issue.message);
        }
        return {
          ok: false,
          code: 'VALIDATION',
          message: USER_FACING_MESSAGE.VALIDATION,
          fieldErrors,
          requestId,
        };
      }

      const output = await config.handler(parsed.data, actor);

      for (const path of config.revalidate?.(parsed.data, output) ?? []) {
        revalidatePath(path);
      }

      return { ok: true, data: output };
    } catch (error) {
      return handleError(error, config.name, requestId);
    }
  };
}

function fail(code: 'UNAUTHENTICATED' | 'FORBIDDEN', requestId: string): Result<never> {
  return { ok: false, code, message: USER_FACING_MESSAGE[code], requestId };
}

function handleError(error: unknown, actionName: string, requestId: string): Result<never> {
  if (error instanceof AppError) {
    const result: Result<never> = {
      ok: false,
      code: error.code,
      message: USER_FACING_MESSAGE[error.code],
      requestId,
    };
    return error.fieldErrors ? { ...result, fieldErrors: error.fieldErrors } : result;
  }

  // Supabase surfaces PostgREST errors as plain objects carrying a `code`.
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const pgCode = String((error as { code: unknown }).code);
    const mapped = codeFromPostgresError(pgCode);

    // Log the detail; return only the mapped code. Database messages name
    // tables, columns and constraints — not something to hand to a browser.
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        action: actionName,
        pgCode,
        detail: (error as { message?: string }).message,
      }),
    );

    return { ok: false, code: mapped, message: USER_FACING_MESSAGE[mapped], requestId };
  }

  console.error(
    JSON.stringify({
      level: 'error',
      requestId,
      action: actionName,
      detail: error instanceof Error ? error.message : 'unknown error',
    }),
  );

  return { ok: false, code: 'INTERNAL', message: USER_FACING_MESSAGE.INTERNAL, requestId };
}

/** Narrows a Supabase result, converting its error into an AppError. */
export function unwrap<T>(result: { data: T | null; error: unknown }, notFoundMessage: string): T {
  if (result.error) throw result.error;
  if (result.data === null) throw new AppError('NOT_FOUND', notFoundMessage);
  return result.data;
}
