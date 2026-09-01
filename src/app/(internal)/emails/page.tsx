import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/server/auth/actor';
import { listEmails, listMailboxes } from '@/server/modules/email/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, NoResultsState } from '@/components/patterns/states';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import {
  EMAIL_PROCESSING_STATUSES,
  EMAIL_PROCESSING_STATUS_META,
} from '@/config/statuses';
import type { EmailProcessingStatus } from '@/config/statuses';

export const metadata: Metadata = { title: 'Emails' };

/**
 * The email explorer.
 *
 * Operational visibility, not a mail client. There is no reply, no forward, no
 * compose and no delete — this build has read-only mailbox access and no
 * business having any of them.
 *
 * The list carries no bodies. Fifty rows of email body is megabytes of the
 * most sensitive content in the product travelling to a browser to render a
 * one-line preview.
 */
export default async function EmailsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    mailbox?: string;
    attachments?: string;
    page?: string;
  }>;
}) {
  await requirePermission('email.view');
  const filters = await searchParams;

  const status = (EMAIL_PROCESSING_STATUSES as readonly string[]).includes(filters.status ?? '')
    ? (filters.status as EmailProcessingStatus)
    : undefined;

  const page = Number(filters.page ?? '1');
  const [result, mailboxes] = await Promise.all([
    listEmails({
      search: filters.q,
      status,
      mailboxId: filters.mailbox,
      hasAttachments: filters.attachments === '1',
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: 25,
    }),
    listMailboxes(),
  ]);

  const filtered = Boolean(filters.q || status || filters.mailbox || filters.attachments);
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));

  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (status) params.set('status', status);
    if (filters.mailbox) params.set('mailbox', filters.mailbox);
    if (filters.attachments) params.set('attachments', filters.attachments);
    if (target > 1) params.set('page', String(target));
    const query = params.toString();
    return query ? `/emails?${query}` : '/emails';
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Emails"
        description="Ingested mailbox evidence. Nothing here has been interpreted, matched to a candidate, or turned into a record."
      />

      <Card>
        <CardHeader>
          <CardTitle>Search and filter</CardTitle>
          {filtered ? (
            <Link href="/emails" className="text-[13px] text-[var(--color-accent-600)] hover:underline">
              Clear
            </Link>
          ) : null}
        </CardHeader>
        <CardBody>
          <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[13px] font-medium text-[var(--text-secondary)]">Search</span>
              <input
                name="q"
                defaultValue={filters.q ?? ''}
                placeholder="Sender, subject or message text"
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 text-[14px] text-[var(--text-primary)]"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-secondary)]">State</span>
              <select
                name="status"
                defaultValue={status ?? ''}
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 pr-8 text-[14px] text-[var(--text-primary)]"
              >
                <option value="">Any state</option>
                {EMAIL_PROCESSING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {EMAIL_PROCESSING_STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-secondary)]">Mailbox</span>
              <select
                name="mailbox"
                defaultValue={filters.mailbox ?? ''}
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 pr-8 text-[14px] text-[var(--text-primary)]"
              >
                <option value="">Any mailbox</option>
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.address}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                name="attachments"
                value="1"
                defaultChecked={filters.attachments === '1'}
                className="h-4 w-4"
              />
              <span className="text-[13px] text-[var(--text-secondary)]">
                Only messages with attachments
              </span>
            </label>

            <div className="flex items-end sm:col-start-4">
              <button
                type="submit"
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-[14px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              >
                Apply
              </button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Messages</CardTitle>
          <span className="tabular text-[13px] text-[var(--text-muted)]">
            {result.total} {result.total === 1 ? 'message' : 'messages'}
            {lastPage > 1 ? ` · page ${result.page} of ${lastPage}` : ''}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {result.items.length === 0 ? (
            <div className="p-5">
              {filtered ? (
                <NoResultsState
                  onClear={
                    <Link
                      href="/emails"
                      className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                    >
                      Clear the filters
                    </Link>
                  }
                />
              ) : (
                <EmptyState
                  title="No email ingested yet"
                  body="Connect a mailbox and run a sync. Messages appear here as evidence, exactly as they arrived."
                  action={
                    <Link
                      href="/settings/mailbox"
                      className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                    >
                      Mailbox settings
                    </Link>
                  }
                />
              )}
            </div>
          ) : (
            <ul className="flex flex-col">
              {result.items.map((message) => (
                <li
                  key={message.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
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
                    {message.snippet ? (
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] text-[var(--text-muted)]">
                        {message.snippet}
                      </p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
                      {message.threadMessageCount > 1 ? (
                        <Link
                          href={`/emails/threads/${message.threadId}`}
                          className="hover:text-[var(--color-accent-600)] hover:underline"
                        >
                          Thread of {message.threadMessageCount}
                        </Link>
                      ) : null}
                      {message.hasAttachments ? (
                        <span>
                          {message.attachmentCount}{' '}
                          {message.attachmentCount === 1 ? 'attachment' : 'attachments'}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge tone={EMAIL_PROCESSING_STATUS_META[message.processingStatus].tone}>
                      {EMAIL_PROCESSING_STATUS_META[message.processingStatus].label}
                    </Badge>
                    <span className="tabular text-[12px] text-[var(--text-muted)]">
                      {formatDateTime(message.receivedAt)}
                    </span>
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {formatRelative(message.receivedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {lastPage > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          {result.page > 1 ? (
            <Link
              href={pageHref(result.page - 1)}
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="tabular text-[13px] text-[var(--text-muted)]">
            Page {result.page} of {lastPage}
          </span>
          {result.page < lastPage ? (
            <Link
              href={pageHref(result.page + 1)}
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
