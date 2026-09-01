import 'server-only';
import { INTELLIGENCE_MODEL_DEFAULT } from '@/config/intelligence';
import { INTERPRETATION_JSON_SCHEMA } from '../schema';
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompt';
import {
  ProviderRefusedError,
  ProviderUnavailableError,
  type EmailIntelligenceProvider,
  type InterpretationRequest,
  type InterpretationResponse,
} from './types';

/**
 * OpenAI, via the chat completions API with a strict JSON schema.
 *
 * Structured output rather than "please reply in JSON": the schema is enforced
 * by the provider, so there is no prose to parse and no parser to be fooled by
 * an email that contains a JSON blob of its own. The response is still
 * validated with Zod afterwards — a provider-side guarantee is a convenience,
 * not a reason to trust the bytes.
 *
 * Everything OpenAI-shaped stops in this file.
 */
const CHAT_COMPLETIONS = 'https://api.openai.com/v1/chat/completions';

export class OpenAiIntelligenceProvider implements EmailIntelligenceProvider {
  readonly kind = 'openai' as const;
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model?: string,
  ) {
    this.model = model ?? INTELLIGENCE_MODEL_DEFAULT;
  }

  async interpret(request: InterpretationRequest): Promise<InterpretationResponse> {
    const response = await fetch(CHAT_COMPLETIONS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      // Never cached: the Next data cache is global rather than per-user, and
      // this request carries one tenant's correspondence.
      cache: 'no-store',
      body: JSON.stringify({
        model: this.model,
        // Deterministic as the API allows. Two readings of the same email
        // returning different answers makes a wrong one impossible to
        // investigate.
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(request) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'email_interpretation',
            strict: true,
            schema: INTERPRETATION_JSON_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      // The body can echo the prompt, which contains the email. It is not part
      // of any error this system stores or logs.
      if (response.status === 429 || response.status >= 500) {
        throw new ProviderUnavailableError(
          `The interpretation provider was unavailable (${response.status}).`,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new ProviderRefusedError('The interpretation provider rejected our credentials.');
      }
      throw new ProviderRefusedError(`The interpretation provider refused the request (${response.status}).`);
    }

    const json = (await response.json()) as {
      model?: string;
      choices?: { message?: { content?: string | null; refusal?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = json.choices?.[0]?.message;

    // A refusal is a legitimate answer, not a crash. It becomes a failed run
    // with a reason rather than an exception nobody can act on.
    if (choice?.refusal) {
      throw new ProviderRefusedError('The interpretation provider declined to answer.');
    }

    const content = choice?.content;
    if (!content) {
      throw new ProviderRefusedError('The interpretation provider returned an empty response.');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      // Strict mode should make this impossible. It is handled anyway, because
      // "should be impossible" is how unparsed output reaches a database.
      throw new ProviderRefusedError('The interpretation provider returned unreadable output.');
    }

    const usage: InterpretationResponse['usage'] = {};
    if (json.usage?.prompt_tokens !== undefined) usage.inputTokens = json.usage.prompt_tokens;
    if (json.usage?.completion_tokens !== undefined) {
      usage.outputTokens = json.usage.completion_tokens;
    }

    return { raw, model: json.model ?? this.model, usage };
  }
}

/**
 * Reads the key from the environment, server-side only.
 *
 * Not `NEXT_PUBLIC_`, and never referenced from a client component — a key
 * with that prefix is inlined into the browser bundle, which for a paid API is
 * somebody else's invoice.
 */
export function openAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.length < 20) {
    throw new Error(
      'OPENAI_API_KEY is not configured. Email interpretation is unavailable until it is.',
    );
  }
  return key;
}
