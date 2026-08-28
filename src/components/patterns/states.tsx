import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Inbox, Lock, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/button';

/**
 * The five states every data surface needs.
 *
 * Empty states say what belongs here and what has to happen first. A screen
 * that just says "No results" reads as "the system is broken", and in the
 * candidate portal that difference generates support contact.
 *
 * No illustrations anywhere.
 */
function StateShell({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] ' +
          'border border-dashed border-[var(--border-subtle)] px-6 py-12 text-center',
        className,
      )}
    >
      <div className="text-[var(--text-muted)]" aria-hidden="true">
        {icon}
      </div>
      <p className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="max-w-[46ch] text-[13px] text-[var(--text-secondary)]">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function EmptyState(props: {
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return <StateShell icon={<Inbox size={22} />} {...props} />;
}

export function NoResultsState({ onClear }: { onClear?: React.ReactNode }) {
  return (
    <StateShell
      icon={<SearchX size={22} />}
      title="No matches"
      body="No records match the current filters. Try a broader search or clear the filters."
      action={onClear}
    />
  );
}

/**
 * Never renders the underlying error message. Database and stack detail names
 * tables and columns; the request id is what a support conversation actually
 * needs.
 */
export function ErrorState({
  title = 'Something went wrong',
  body = 'We could not load this. Please try again.',
  requestId,
  retry,
}: {
  title?: string;
  body?: string;
  requestId?: string;
  retry?: React.ReactNode;
}) {
  return (
    <StateShell
      icon={<AlertTriangle size={22} />}
      title={title}
      body={requestId ? `${body} Reference: ${requestId}` : body}
      action={retry}
      className="border-[var(--color-critical)]/30"
    />
  );
}

export function UnauthorizedState({
  body = 'You do not have permission to view this. If you think that is wrong, ask an administrator to check your role.',
}: {
  body?: string;
}) {
  return (
    <StateShell
      icon={<Lock size={22} />}
      title="Not available to you"
      body={body}
      action={
        <Button asChild variant="secondary" size="sm">
          <Link href="/">Back to overview</Link>
        </Button>
      }
    />
  );
}

/** Skeletons only where the layout is known in advance. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]"
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex gap-4 border-b border-[var(--border-subtle)] px-3 py-3 last:border-b-0"
        >
          {Array.from({ length: cols }).map((__, c) => (
            <div
              key={c}
              className="h-3 flex-1 animate-pulse rounded-[var(--radius-xs)] bg-[var(--surface-sunken)]"
              style={{ maxWidth: c === 0 ? '22%' : undefined }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
