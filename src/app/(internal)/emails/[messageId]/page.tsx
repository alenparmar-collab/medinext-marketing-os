import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getEmail } from '@/server/modules/email/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatFileSize, formatRelative } from '@/lib/utils/format';
import { EMAIL_PROCESSING_STATUS_META, INTELLIGENCE_STATUS_META } from '@/config/statuses';
import { getLatestRunForEmail } from '@/server/modules/intelligence/queries';
import { InterpretButton } from '../../intelligence/interpret-button';

export const metadata: Metadata = { title: 'Email' };

/**
 * One message, as evidence.
 *
 * The page shows what arrived and nothing else. There is no summary, no
 * inferred candidate, no "this looks like an interview invitation" — this
 * build has no interpretation layer, and a confident-looking guess presented
 * next to real evidence is worse than no guess at all.
 *
 * The body is rendered as text. The HTML part is preserved in the database as
 * part of the evidence but is never injected into this page: rendering
 * attacker-controlled HTML from an external mailbox inside an authenticated
 * internal tool is the whole of the vulnerability.
 */
export default async function EmailDetailPage({
  params,
}: {
  params: Promise<{ messageId: string }>;
}) {
  const actor = await requirePermission('email.view');
  const { messageId } = await params;

  let email;
  try {
    email = await getEmail(messageId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const status = EMAIL_PROCESSING_STATUS_META[email.processingStatus];

  // Interpretation is a separate capability from reading the mailbox, so this
  // is fetched only for those who hold it.
  const latestRun = can(actor, 'intelligence.view')
    ? await getLatestRunForEmail(email.id)
    : null;

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={email.subject ?? '(no subject)'}
        description={`From ${email.fromName ? `${email.fromName} · ` : ''}${email.fromAddress}`}
        actions={
          <div className="flex gap-2">
            {email.threadMessageCount > 1 ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/emails/threads/${email.threadId}`}>
                  Thread of {email.threadMessageCount}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href="/emails">All emails</Link>
            </Button>
          </div>
        }
      />

      {/*
        Labelled unambiguously. Somebody reading this page must never be in
        doubt about whether they are looking at what arrived or at what the
        system concluded — and in this build there are no conclusions.
      */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          Source email
        </span>
        <span className="text-[12.5px] text-[var(--text-muted)]">
          Preserved as received. Not interpreted, not matched to a candidate, not used to change
          any record.
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Message</CardTitle>
          <Badge tone={status.tone}>{status.label}</Badge>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fact label="From" value={`${email.fromName ? `${email.fromName} ` : ''}<${email.fromAddress}>`} />
            <Fact label="To" value={email.toAddresses.join(', ') || '—'} />
            {email.ccAddresses.length > 0 ? (
              <Fact label="Cc" value={email.ccAddresses.join(', ')} />
            ) : null}
            {email.bccAddresses.length > 0 ? (
              <Fact label="Bcc" value={email.bccAddresses.join(', ')} />
            ) : null}
            <Fact
              label="Received"
              value={`${formatDateTime(email.receivedAt)} · ${formatRelative(email.receivedAt)}`}
            />
            <Fact label="Sent" value={email.sentAt ? formatDateTime(email.sentAt) : 'Not stated'} />
            <Fact label="Mailbox" value={email.mailboxAddress} />
            <Fact label="Thread subject" value={email.threadSubject ?? '—'} />
          </dl>

          <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Body
            </p>
            {email.bodyText ? (
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-[var(--text-primary)]">
                {email.bodyText}
              </pre>
            ) : (
              <p className="mt-2 text-[13px] text-[var(--text-muted)]">
                {email.bodyHtml
                  ? 'This message carried an HTML body only. It is preserved with the message but is not rendered here — external markup is not executed inside this tool.'
                  : 'No body was captured.'}
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {email.attachments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Attachments</CardTitle>
            <span className="text-[13px] text-[var(--text-muted)]">
              {email.attachments.length} listed
            </span>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="flex flex-col">
              {email.attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-[13.5px] text-[var(--text-primary)]">
                      {attachment.fileName}
                    </p>
                    <p className="text-[12px] text-[var(--text-muted)]">
                      {attachment.mimeType ?? 'unknown type'}
                      {attachment.sizeBytes !== null
                        ? ` · ${formatFileSize(attachment.sizeBytes)}`
                        : ''}
                    </p>
                  </div>
                  <Badge tone={attachment.isDownloaded ? 'info' : 'muted'}>
                    {attachment.isDownloaded ? 'Stored privately' : 'Metadata only'}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {can(actor, 'intelligence.view') ? (
        <Card>
          <CardHeader>
            <CardTitle>Interpretation</CardTitle>
            {latestRun ? (
              <Badge tone={INTELLIGENCE_STATUS_META[latestRun.status].tone}>
                {INTELLIGENCE_STATUS_META[latestRun.status].label}
              </Badge>
            ) : null}
          </CardHeader>
          <CardBody>
            {latestRun ? (
              <>
                <p className="text-[14px] text-[var(--text-primary)]">
                  {latestRun.summary ?? 'No summary was produced.'}
                </p>
                <p className="mt-1.5 text-[12.5px] text-[var(--text-muted)]">
                  A model&apos;s reading, kept separate from the email itself. It has changed no
                  record.
                </p>
                <Link
                  href={`/intelligence/${latestRun.id}`}
                  className="mt-2 inline-block text-[13px] text-[var(--color-accent-600)] hover:underline"
                >
                  Open reading {latestRun.runNumber}
                </Link>
              </>
            ) : (
              <p className="text-[13px] text-[var(--text-secondary)]">
                This email has not been interpreted. Interpretation runs on demand — nothing is
                sent to a provider on its own.
              </p>
            )}

            {can(actor, 'intelligence.run') ? (
              <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                <InterpretButton emailMessageId={email.id} hasExistingRun={latestRun !== null} />
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Provenance</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fact label="Provider message ID" value={email.providerMessageId} mono />
            <Fact label="Internet message ID" value={email.internetMessageId ?? '—'} mono />
            <Fact label="In reply to" value={email.inReplyTo ?? '—'} mono />
            <Fact
              label="Original preserved"
              value={email.hasRawEvidence ? 'Yes, in private storage' : 'Normalised form only'}
            />
            <Fact label="First seen" value={formatDateTime(email.firstSeenAt)} />
            {/*
              These two differing is the visible proof that redelivery was
              handled: the provider offered the message again and it was
              recognised rather than duplicated.
            */}
            <Fact label="Last seen" value={formatDateTime(email.lastSeenAt)} />
          </dl>

          {email.processingError ? (
            <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-caution)]/30 bg-[var(--color-caution-bg)] px-3 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Processing error
              </p>
              <p className="mt-1 text-[13px] text-[var(--text-primary)]">{email.processingError}</p>
            </div>
          ) : null}

          {Object.keys(email.headers).length > 0 ? (
            <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Retained headers
              </p>
              <dl className="mt-1.5 flex flex-col gap-1">
                {Object.entries(email.headers).map(([name, value]) => (
                  <div key={name} className="flex flex-wrap gap-2">
                    <dt className="text-[12px] font-medium text-[var(--text-secondary)]">{name}</dt>
                    <dd className="break-all font-mono text-[12px] text-[var(--text-muted)]">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd
        className={
          mono
            ? 'break-all font-mono text-[12.5px] text-[var(--text-primary)]'
            : 'break-words text-[14px] text-[var(--text-primary)]'
        }
      >
        {value}
      </dd>
    </div>
  );
}
