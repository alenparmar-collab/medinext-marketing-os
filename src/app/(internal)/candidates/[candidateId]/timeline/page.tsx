import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { getCandidateTimeline } from '@/server/modules/timeline/queries';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/patterns/states';
import { Timeline } from '@/components/patterns/timeline';

export const metadata: Metadata = { title: 'Candidate timeline' };

export default async function CandidateTimelinePage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  await requireInternal();
  const { candidateId } = await params;

  const entries = await getCandidateTimeline(candidateId);

  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nothing has happened yet"
        body="Marketing periods, applications and every recorded activity appear here in order, newest first."
      />
    );
  }

  return (
    <Card>
      <CardBody>
        <Timeline entries={entries} linkApplications />
      </CardBody>
    </Card>
  );
}
