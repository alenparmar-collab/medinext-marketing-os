import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Two of the rules below are architectural boundaries, not style preferences.
 * They fail the build rather than relying on code review to catch a mistake
 * that would be a data leak.
 */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**'] },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  {
    /**
     * BOUNDARY A — service-role code never reaches a route or a client bundle.
     *
     * docs/architecture/05 §7. The key bypasses RLS entirely, so the only
     * sanctioned entry point is withServiceRole(), which audits every use.
     */
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server/privileged/service-client', '@/server/privileged*'],
              message:
                'Do not import service-role code from routes or components. Call it from a server module through withServiceRole().',
            },
          ],
        },
      ],
    },
  },
  {
    /**
     * BOUNDARY B — the candidate portal may not reach internal data modules.
     *
     * docs/architecture/08 §2. One of four independent isolation layers; this
     * is the one that catches a developer reusing an internal query by habit.
     *
     * Declared AFTER the app-wide block on purpose: flat config lets a later
     * block replace the same rule, so this must be last or it is silently lost.
     */
    files: ['src/app/(portal)/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/server/modules/candidates*',
                '@/server/modules/marketing*',
                '@/server/modules/assignments*',
                '@/server/modules/dashboard*',
                '@/server/modules/reference*',
                '@/server/privileged*',
              ],
              message:
                'Portal routes must query @/server/modules/portal only (docs/architecture/08 §2).',
            },
          ],
        },
      ],
    },
  },

];

export default config;
