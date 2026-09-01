import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission, can } from '@/server/auth/actor';
import { listMailboxes, listSyncRuns } from '@/server/modules/email/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/patterns/states';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import {
  EMAIL_PROVIDER_LABELS,
  EMAIL_SYNC_STATUS_META,
  EMAIL_SYNC_TRIGGER_LABELS,
  MAILBOX_STATUS_META,
} from '@/config/statuses';
import { MailboxControls } from './mailbox-controls';

export const metadata: Metadata = { title: 'Mailbox' };

const ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    'Google OAuth is not configured on this deployment. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.',
  declined: 'Authorisation was declined in Google.',
  missing_state: 'The authorisation attempt expired. Start again.',
  state_mismatch: 'The authorisation response did not match the request. Start again.',
  exchange_failed: 'Google would not complete the authorisation. Nothing was connected.',
  no_business_unit: 'Your account is not attached to a business unit.',
};

export default async function MailboxSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const actor = await requirePermission('mailbox.view');
  const { error, connected } = await searchParams;

  const mailboxes = await listMailboxes();
  const canManage = can(actor, 'mailbox.manage');

  const runsByMailbox = await Promise.all(
    mailboxes.map(async (mailbox) => ({
      mailboxId: mailbox.id,
      runs: await listSyncRuns(mailbox.id, 5),
    })),
  );

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Marketing mailbox"
        description="Connected mailboxes and their synchronisation state. Email is ingested as evidence; nothing here creates or changes a candidate record."
        actions={
          canManage && mailboxes.length === 0 ? (
            <Button asChild variant="primary" size="sm">
              <a href="/api/mailbox/oauth/start">Connect a mailbox</a>
            </Button>
          ) : null
        }
      />

      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-critical)]/30 bg-[var(--color-caution-bg)] px-3 py-2.5"
        >
          <p className="text-[13px] text-[var(--text-primary)]">
            {ERROR_MESSAGES[error] ?? 'The authorisation did not complete.'}
          </p>
        </div>
      ) : null}

      {connected ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-positive)]/30 bg-[var(--color-positive-bg)] px-3 py-2.5">
          <p className="text-[13px] text-[var(--text-primary)]">
            Mailbox connected. Run a sync to bring messages in.
          </p>
        </div>
      ) : null}

      {mailboxes.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No mailbox connected"
              body={
                canManage
                  ? 'Connecting a mailbox authorises read-only access through Google. No password is asked for, and no send permission is requested.'
                  : 'No mailbox is connected. An administrator connects one.'
              }
              action={
                canManage ? (
                  <Button asChild variant="primary" size="sm">
                    <a href="/api/mailbox/oauth/start">Connect a mailbox</a>
                  </Button>
                ) : null
              }
            />
          </CardBody>
        </Card>
      ) : null}

      {mailboxes.map((mailbox) => {
        const status = MAILBOX_STATUS_META[mailbox.status];
        const runs = runsByMailbox.find((r) => r.mailboxId === mailbox.id)?.runs ?? [];

        return (
          <Card key={mailbox.id}>
            <CardHeader>
              <CardTitle>{mailbox.address}</CardTitle>
              <Badge tone={status.tone}>{status.label}</Badge>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <p className="text-[13px] text-[var(--text-secondary)]">{status.description}</p>

              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fact label="Provider" value={EMAIL_PROVIDER_LABELS[mailbox.provider]} />
                <Fact label="Access" value="Read-only" />
                {/*
                  The two timestamps are shown separately and labelled. Showing
                  the last attempt as though it were the last success is how a
                  mailbox stops importing for a fortnight while the screen says
                  everything is fine.
                */}
                <Fact
                  label="Last successful sync"
                  value={
                    mailbox.lastSuccessfulSyncAt
                      ? `${formatDateTime(mailbox.lastSuccessfulSyncAt)} · ${formatRelative(mailbox.lastSuccessfulSyncAt)}`
                      : 'Never'
                  }
                />
                <Fact
                  label="Last attempt"
                  value={
                    mailbox.lastSyncAttemptedAt
                      ? `${formatDateTime(mailbox.lastSyncAttemptedAt)} · ${formatRelative(mailbox.lastSyncAttemptedAt)}`
                      : 'Never'
                  }
                />
                <Fact label="Messages held" value={String(mailbox.messageCount)} />
                <Fact label="Threads" value={String(mailbox.threadCount)} />
              </dl>

              {mailbox.lastSyncError ? (
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-caution)]/30 bg-[var(--color-caution-bg)] px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    Last failure
                  </p>
                  <p className="mt-1 text-[13px] text-[var(--text-primary)]">
                    {mailbox.lastSyncError}
                  </p>
                </div>
              ) : null}

              {canManage ? <MailboxControls mailboxId={mailbox.id} /> : null}

              <div className="border-t border-[var(--border-subtle)] pt-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Recent sync runs
                </p>
                {runs.length === 0 ? (
                  <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
                    No sync has run yet.
                  </p>
                ) : (
                  <ul className="mt-1.5 flex flex-col">
                    {runs.map((run) => (
                      <li
                        key={run.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] py-2 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <p className="tabular text-[13px] text-[var(--text-primary)]">
                            {formatDateTime(run.startedAt)}
                            <span className="ml-2 text-[var(--text-muted)]">
                              {EMAIL_SYNC_TRIGGER_LABELS[run.trigger]}
                              {run.startedByName ? ` · ${run.startedByName}` : ''}
                            </span>
                          </p>
                          <p className="text-[12px] text-[var(--text-secondary)]">
                            {run.messagesSeen} seen · {run.messagesCreated} new ·{' '}
                            {run.messagesUpdated} already held
                          </p>
                          {run.errorMessage ? (
                            <p className="text-[12px] text-[var(--color-critical)]">
                              {run.errorMessage}
                            </p>
                          ) : null}
                        </div>
                        <Badge tone={EMAIL_SYNC_STATUS_META[run.status].tone}>
                          {EMAIL_SYNC_STATUS_META[run.status].label}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className="text-[12px] text-[var(--text-muted)]">
                Synchronisation runs on demand. There is no polling loop: provider APIs are
                metered, and a scheduled job or a push subscription is a deployment decision.{' '}
                <Link href="/emails" className="text-[var(--color-accent-600)] hover:underline">
                  Open the email explorer
                </Link>
                .
              </p>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="text-[14px] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}
