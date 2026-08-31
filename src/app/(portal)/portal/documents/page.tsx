import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { getMyDocuments, getUploadableDocumentTypes } from '@/server/modules/portal/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/patterns/states';
import { formatDate, formatFileSize } from '@/lib/utils/format';
import { UploadForm } from './upload-form';

export const metadata: Metadata = { title: 'Documents' };

export default async function PortalDocumentsPage() {
  const actor = await requireCandidate();

  const [documents, uploadableTypes] = await Promise.all([
    getMyDocuments(actor.candidateId),
    getUploadableDocumentTypes(),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Documents"
        description="Files shared with you, and anything you send us. Documents we hold internally are not listed here."
      />

      {documents.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Files your recruiter shares with you will appear here, and you can send us documents using the form below."
        />
      ) : (
        <Card>
          <CardBody>
            <ul className="flex flex-col">
              {documents.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-3 last:border-b-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-[var(--text-primary)]">{d.fileName}</p>
                    <p className="text-[12px] text-[var(--text-muted)]">
                      {d.documentType} · {formatFileSize(d.sizeBytes)} · {formatDate(d.uploadedAt)}
                    </p>
                  </div>
                  {/*
                    A plain link to a route handler that verifies, mints a
                    60-second signed URL and redirects. The bytes never pass
                    through the application.
                  */}
                  <a
                    href={`/api/documents/${d.id}/download`}
                    className="shrink-0 text-[13.5px] text-[var(--color-accent-600)] hover:underline"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <UploadForm documentTypes={uploadableTypes} />
    </div>
  );
}
