import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * No zebra striping: borders are enough, and striping fights with row hover and
 * selection. Wide tables scroll inside their own container so the page body
 * never scrolls sideways.
 */
export function TableWrap({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-raised)]',
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table className={cn('w-full border-collapse text-[14px]', className)} {...props} />;
}

export function Th({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] ' +
          'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      className={cn('border-b border-[var(--border-subtle)] px-3 py-2.5 align-middle', className)}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn('transition-colors duration-100 hover:bg-[var(--surface-hover)]', className)}
      {...props}
    />
  );
}
