import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[52ch] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
        404
      </p>
      <h1 className="text-[22px] font-semibold text-[var(--text-primary)]">Page not found</h1>
      <p className="text-[14px] text-[var(--text-secondary)]">
        That address does not exist, or the record it pointed to is no longer available to you.
      </p>
      <Button asChild variant="secondary" size="sm" className="mt-2">
        <Link href="/">Back to start</Link>
      </Button>
    </main>
  );
}
