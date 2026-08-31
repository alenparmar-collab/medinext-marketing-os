import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/server/auth/actor';
import { getInterview } from '@/server/modules/interviews/queries';
import { AppError } from '@/server/auth/errors';
import { PageHeader } from '@/components/patterns/page-header';
import { InterviewForm } from '../../interview-form';

export const metadata: Metadata = { title: 'Edit interview' };

export default async function EditInterviewPage({
  params,
}: {
  params: Promise<{ interviewId: string }>;
}) {
  await requirePermission('interview.manage');
  const { interviewId } = await params;

  let interview;
  try {
    interview = await getInterview(interviewId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Edit interview"
        description={`${interview.candidateName} · ${interview.positionTitle} at ${interview.companyName}`}
      />
      <InterviewForm
        mode="edit"
        applications={[]}
        values={{
          interviewId: interview.id,
          interviewRound: interview.interviewRound,
          timeZone: interview.timeZone,
          meetingUrl: interview.meetingUrl,
          interviewerName: interview.interviewerName,
          notes: interview.notes,
        }}
      />
    </div>
  );
}
