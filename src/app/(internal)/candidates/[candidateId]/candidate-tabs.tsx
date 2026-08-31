'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

/**
 * Only tabs with real data behind them exist. There is no placeholder tab in
 * this workspace — an empty section that promises something is worse than not
 * offering it.
 */
const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Applications', segment: 'applications' },
  { label: 'Marketing', segment: 'marketing' },
  { label: 'Timeline', segment: 'timeline' },
  { label: 'Documents', segment: 'documents' },
  { label: 'Assignments', segment: 'assignments' },
];

export function CandidateTabs({ candidateId }: { candidateId: string }) {
  const pathname = usePathname();
  const base = `/candidates/${candidateId}`;

  return (
    <nav aria-label="Candidate sections" className="border-b border-[var(--border-subtle)]">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const active = pathname === href;
          return (
            <li key={tab.label}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-block whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px] transition-colors duration-100',
                  active
                    ? 'border-[var(--color-accent-600)] font-medium text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
