import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getAssessment } from '@/server/modules/assessments/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { AssessmentForm } from '../../assessment-form';

export const metadata: Metadata = { title: 'Edit assessment' };

export default async function EditAssessmentPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  await requirePermission('assessment.manage');
  const { assessmentId } = await params;

  let assessment;
  try {
    assessment = await getAssessment(assessmentId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Edit assessment"
        description={`${assessment.candidateName} · ${assessment.assessmentType} for ${assessment.companyName}`}
      />
      <AssessmentForm
        mode="edit"
        applications={[]}
        values={{
          assessmentId: assessment.id,
          assessmentType: assessment.assessmentType,
          assessmentUrl: assessment.assessmentUrl,
          deadline: assessment.deadline,
          notes: assessment.notes,
        }}
      />
    </div>
  );
}
