import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { withServiceRole } from '@/server/privileged/service-client';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import { INTELLIGENCE_MODEL_DEFAULT } from '@/config/intelligence';
import { OpenAiIntelligenceProvider, openAiApiKey } from './providers/openai';
import { FixtureIntelligenceProvider, fixtureInterpretation } from './providers/fixture';
import type { EmailIntelligenceProvider } from './providers/types';
import { processEmailForIntelligence, type ProcessResult } from './processing';

/**
 * The authorised entry point for interpretation.
 *
 * Two capabilities, deliberately separate: `intelligence.view` reads results,
 * `intelligence.run` triggers them. Running spends money at a paid provider,
 * which is a different kind of permission from reading a page.
 *
 * The write path goes through the service role because runs are not writable
 * through the API at all — there is no INSERT policy and no grant, so a
 * request cannot forge a result or edit a confidence score.
 */

function selectProvider(): EmailIntelligenceProvider {
  // Development and demo. Selected by an environment variable rather than by a
  // code path, so production cannot fall into it by accident.
  if (process.env.INTELLIGENCE_PROVIDER === 'fixture') {
    return new FixtureIntelligenceProvider(
      fixtureInterpretation({
        summary: 'Fixture provider — no model was called.',
      }),
    );
  }

  return new OpenAiIntelligenceProvider(
    openAiApiKey(),
    process.env.INTELLIGENCE_MODEL ?? INTELLIGENCE_MODEL_DEFAULT,
  );
}

export interface InterpretEmailInput {
  emailMessageId: string;
}

/**
 * Interprets an email, or interprets it again.
 *
 * Reprocessing is the same operation: it creates a NEW run with the next run
 * number. Nothing is overwritten, nothing is deleted, and the earlier reading
 * stays readable beside the new one — which is what makes "the model changed
 * its mind after we upgraded it" an answerable question rather than a rumour.
 */
export async function interpretEmail(
  input: InterpretEmailInput,
  actor: ActorContext,
): Promise<ProcessResult> {
  const supabase = await createServerSupabase();

  // RLS decides whether this caller may see the email at all. Checked here,
  // before the service role is involved, so the privileged path cannot be used
  // as an access bypass.
  const { data: email, error } = await supabase
    .from('email_messages')
    .select('id, business_unit_id, processing_status')
    .eq('id', input.emailMessageId)
    .maybeSingle();

  if (error) throw error;
  if (!email) throw new AppError('NOT_FOUND', 'Email not found, or not permitted.');

  // Interpreting a half-ingested message would read evidence that is still
  // being written.
  if (email.processing_status !== 'ready') {
    throw new AppError(
      'PRECONDITION_FAILED',
      'This email has not finished ingesting. Interpretation needs complete evidence.',
    );
  }

  let provider: EmailIntelligenceProvider;
  try {
    provider = selectProvider();
  } catch (cause) {
    throw new AppError(
      'PRECONDITION_FAILED',
      cause instanceof Error ? cause.message : 'No interpretation provider is configured.',
    );
  }

  return withServiceRole(
    actor,
    `Interpret email ${input.emailMessageId} with ${provider.kind}/${provider.model}`,
    async (db) => {
      try {
        return await processEmailForIntelligence(db, provider, {
          emailMessageId: input.emailMessageId,
          requestedBy: actor.userId,
        });
      } catch (cause) {
        // The partial unique index refuses a second active run for the same
        // email. That is a correct refusal, not a fault, and it deserves a
        // message someone can act on.
        if (
          typeof cause === 'object' &&
          cause !== null &&
          'code' in cause &&
          String((cause as { code: unknown }).code) === '23505'
        ) {
          throw new AppError(
            'CONFLICT',
            'This email is already being interpreted. Wait for that run to finish.',
          );
        }
        throw cause;
      }
    },
  );
}
