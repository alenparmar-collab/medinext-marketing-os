import { TableSkeleton } from '@/components/patterns/states';

export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="h-8 w-48 animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-sunken)]" />
      <div className="h-9 w-full max-w-md animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-sunken)]" />
      <TableSkeleton rows={8} cols={6} />
    </div>
  );
}
