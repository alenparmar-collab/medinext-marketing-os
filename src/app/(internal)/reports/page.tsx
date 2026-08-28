import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Reports' };

export default async function Page() {
  await requireInternal();
  return (
    <ComingSoon
      title="Reports"
      description="Operational reporting across candidates and marketing activity."
      plannedIn="Build 5"
      willInclude={['Activity and pipeline summaries', 'Per-recruiter and per-unit breakdowns', 'Export with an audit record']}
    />
  );
}
