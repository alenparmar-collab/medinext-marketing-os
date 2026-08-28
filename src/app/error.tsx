'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Global error boundary.
 *
 * `error.digest` is Next.js's server-side correlation id. It is the only detail
 * shown, deliberately: the real message stays in the server logs where it
 * belongs, and the digest is what makes a support conversation possible.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(JSON.stringify({ level: 'error', digest: error.digest }));
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[52ch] flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-[22px] font-semibold text-[var(--text-primary)]">Something went wrong</h1>
      <p className="text-[14px] text-[var(--text-secondary)]">
        We could not complete that request. Please try again.
      </p>
      {error.digest ? (
        <p className="font-mono text-[12px] text-[var(--text-muted)]">Reference: {error.digest}</p>
      ) : null}
      <Button variant="primary" size="sm" className="mt-2" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
