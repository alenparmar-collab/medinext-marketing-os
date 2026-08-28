import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'src/types/database.ts'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Enforces docs/architecture/05 §7: the service role key never reaches
              // a module that can be bundled for the browser.
              group: ['**/server/privileged/*', '@/server/privileged/*'],
              importNames: ['createServiceClient'],
              message:
                'Import withServiceRole() instead — direct service-client access bypasses the audit wrapper.',
            },
          ],
        },
      ],
    },
  },
  {
    // Enforces docs/architecture/08 §2: portal routes may not reach internal data modules.
    files: ['src/app/(portal)/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server/modules/*', '!@/server/modules/portal', '!@/server/modules/portal/*'],
              message:
                'Portal routes must query @/server/modules/portal only (docs/architecture/08 §2).',
            },
            {
              group: ['@/server/privileged', '@/server/privileged/*'],
              message: 'Portal routes must never touch service-role code.',
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
