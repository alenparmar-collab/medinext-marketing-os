import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getThread } from '@/server/modules/email/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import { EMAIL_PROCESSING_STATUS_META } from '@/config/statuses';

export const metadata: Metadata = { title: 'Email thread' };

/**
 * A thread, oldest first.
 *
 * Read as a conversation rather than as an inbox, because that is the question
 * a thread view answers: what was said, in what order. Membership comes from
 * the provider's thread id — never from the subject, which collides and gets
 * edited.
 */
export default async function EmailThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  await requirePermission('email.view');
  const { threadId } = await params;

  let thread;
  try {
    thread = await getThread(threadId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={thread.subject ?? '(no subject)'}
        description={`${thread.messageCount} ${thread.messageCount === 1 ? 'message' : 'messages'}${
          thread.firstMessageAt ? ` · started ${formatRelative(thread.firstMessageAt)}` : ''
        }`}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/emails">All emails</Link>
          </Button>
        }
      />

      <ol className="flex flex-col gap-3">
        {thread.messages.map((message, index) => (
          <li key={message.id} className="flex gap-3">
            {/* A rail rather than nested indentation: real threads branch in
                ways that indentation renders as a staircase off the page. */}
            <div className="flex flex-col items-center pt-4" aria-hidden="true">
              <span className="tabular text-[11px] text-[var(--text-muted)]">{index + 1}</span>
              <span className="mt-1 w-px flex-1 bg-[var(--border-subtle)]" />
            </div>

            <Card className="flex-1">
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-[var(--text-primary)]">
                      <Link
                        href={`/emails/${message.id}`}
                        className="hover:text-[var(--color-accent-600)] hover:underline"
                      >
                        {message.subject ?? '(no subject)'}
                      </Link>
                    </p>
                    <p className="text-[13px] text-[var(--text-secondary)]">
                      {message.fromName ? `${message.fromName} · ` : ''}
                      {message.fromAddress}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={EMAIL_PROCESSING_STATUS_META[message.processingStatus].tone}>
                      {EMAIL_PROCESSING_STATUS_META[message.processingStatus].label}
                    </Badge>
                    <span className="tabular text-[12px] text-[var(--text-muted)]">
                      {formatDateTime(message.receivedAt)}
                    </span>
                  </div>
                </div>

                {message.snippet ? (
                  <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
                    {message.snippet}
                  </p>
                ) : null}

                {message.hasAttachments ? (
                  <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
                    {message.attachmentCount}{' '}
                    {message.attachmentCount === 1 ? 'attachment' : 'attachments'}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
