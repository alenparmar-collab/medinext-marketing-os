import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal, can } from '@/server/auth/actor';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS } from '@/config/permissions';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Shows the actor their own resolved access. Useful in its own right, and it
 * makes the permission model visible during development rather than something
 * you have to read the seed to understand.
 */
export default async function SettingsPage() {
  const actor = await requireInternal();
  const permissions = [...actor.permissions].sort();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" description="Your account and the access it grants." />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="flex flex-col">
            {[
              ['Name', actor.fullName],
              ['Email', actor.email],
              ['Roles', actor.roles.map((r) => ROLE_LABELS[r]).join(', ') || '—'],
              ['Business unit', actor.businessUnitId ? 'Assigned' : 'All units (platform admin)'],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex flex-col gap-0.5 border-b border-[var(--border-subtle)] py-2.5 last:border-b-0 sm:flex-row sm:gap-4"
              >
                <dt className="w-40 shrink-0 text-[13px] text-[var(--text-muted)]">{label}</dt>
                <dd className="text-[14px] text-[var(--text-primary)]">{value}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      {can(actor, 'mailbox.view') ? (
        <Card>
          <CardHeader>
            <CardTitle>Marketing mailbox</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-[13px] text-[var(--text-secondary)]">
              Connect a mailbox and see its synchronisation state. Email is ingested as evidence
              only — nothing read from a mailbox creates or changes a candidate record.
            </p>
            <Link
              href="/settings/mailbox"
              className="mt-2 inline-block text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              Mailbox settings
            </Link>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your permissions</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-[13px] text-[var(--text-secondary)]">
            These come from your roles. The database enforces them independently of this
            interface, so hiding a button is never what stops an action.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {permissions.map((p) => (
              <Badge key={p} tone="neutral" className="font-mono">
                {p}
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
