import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { getMyDocuments } from '@/server/modules/portal/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/patterns/states';
import { formatDate, formatFileSize } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Documents' };

export default async function PortalDocumentsPage() {
  const actor = await requireCandidate();
  const documents = await getMyDocuments(actor.candidateId);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Documents"
        description="Files your recruiter has shared with you. Documents we hold internally are not listed here."
      />

      {documents.length === 0 ? (
        <EmptyState
          title="Nothing shared yet"
          body="When your recruiter shares a document with you — a formatted resume, for example — it will appear here to download."
        />
      ) : (
        <Card>
          <CardBody>
            <ul className="flex flex-col">
              {documents.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-[var(--text-primary)]">{d.fileName}</p>
                    <p className="text-[12px] text-[var(--text-muted)]">
                      {d.documentType} · {formatFileSize(d.sizeBytes)} · shared{' '}
                      {formatDate(d.uploadedAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/*
        Downloads arrive with the storage upload flow in a later build. Listing
        a file we cannot yet serve would be worse than saying so.
      */}
      <p className="text-[13px] text-[var(--text-muted)]">
        Downloading is being added in a later release. Ask your recruiter if you need a copy now.
      </p>
    </div>
  );
}
