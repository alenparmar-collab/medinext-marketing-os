import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { getCandidate } from '@/server/modules/candidates/queries';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/patterns/states';
import { formatDate, formatFileSize } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Candidate documents' };

export default async function CandidateDocumentsPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  await requireInternal();
  const { candidateId } = await params;

  const candidate = await getCandidate(candidateId);

  if (candidate.documents.length === 0) {
    return (
      <EmptyState
        title="No documents"
        body="Resumes and other files for this candidate will be listed here. Upload arrives in a later build."
      />
    );
  }

  return (
    <Card>
      <CardBody>
        <ul className="flex flex-col">
          {candidate.documents.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-3 last:border-b-0 first:pt-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[14px] text-[var(--text-primary)]">{d.fileName}</p>
                <p className="text-[12px] text-[var(--text-muted)]">
                  {d.documentType} · {formatFileSize(d.sizeBytes)} · v{d.version} ·{' '}
                  {formatDate(d.uploadedAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {d.visibility === 'candidate_visible' ? (
                  <Badge tone="positive">Shared with candidate</Badge>
                ) : (
                  <Badge tone="muted">Internal</Badge>
                )}
                {/*
                  Verifies, mints a 60-second signed URL and redirects. The
                  bytes never pass through the application, and the download is
                  recorded in the audit log.
                */}
                <a
                  href={`/api/documents/${d.id}/download`}
                  className="text-[13.5px] text-[var(--color-accent-600)] hover:underline"
                >
                  Download
                </a>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
