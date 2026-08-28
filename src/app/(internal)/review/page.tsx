import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Review Queue' };

export default async function Page() {
  await requireInternal();
  return (
    <ComingSoon
      title="Review Queue"
      description="Items needing a human decision before they become verified records."
      plannedIn="Build 5"
      willInclude={['System consistency checks', 'Accept or reject with a note', 'Severity and age ordering']}
    />
  );
}
