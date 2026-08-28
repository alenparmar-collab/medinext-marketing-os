import { TableSkeleton } from '@/components/patterns/states';

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-8 w-64 animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-sunken)]" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-sunken)]"
          />
        ))}
      </div>
      <TableSkeleton rows={4} cols={2} />
    </div>
  );
}
