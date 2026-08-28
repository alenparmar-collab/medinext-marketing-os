import { z } from 'zod';

/**
 * Environment validation.
 *
 * Two separate schemas, deliberately. The public one is safe to evaluate
 * anywhere; the server one is only ever read from server code, so the service
 * role key cannot be pulled into a client bundle by an accidental import.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY looks empty'),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
});

let cachedPublicEnv: z.infer<typeof publicEnvSchema> | null = null;

export function publicEnv() {
  if (cachedPublicEnv) return cachedPublicEnv;

  // Next.js inlines NEXT_PUBLIC_* only for literal property access, so these
  // cannot be read dynamically from process.env.
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });

  if (!parsed.success) {
    throw new Error(
      `Missing or invalid Supabase environment variables. Copy .env.example to ` +
        `.env.local and fill it in.\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }

  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}

/** Server-only. Throws if called where the key is absent. */
export function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.length < 20) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. It is required for privileged ' +
        'server operations and must never be exposed to the browser.',
    );
  }
  return key;
}
