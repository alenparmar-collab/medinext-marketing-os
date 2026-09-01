import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getProposal } from '@/server/modules/decisions/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils/format';
import { INTELLIGENCE_EVENT_TYPE_META, REVIEW_ITEM_PRIORITY_META } from '@/config/statuses';
import { DECISION_REASON_META, PROPOSAL_REVIEW_STATUS_META } from '@/config/decisions';
import { DecisionPanel, type EditableField } from '../decision-panel';

export const metadata: Metadata = { title: 'Proposal' };

/**
 * The review workspace: evidence in the middle, proposed action on the right.
 *
 * Three questions, answered in order and always in the same place:
 *   WHY AM I SEEING THIS   — the reasons, at the top
 *   WHAT DOES THE EMAIL SAY — the message, quoted, unedited
 *   WHAT WOULD APPROVING DO — the final record, field by field
 */
const PERMISSION_FOR_EVENT: Record<string, string> = {
  application: 'application.create',
  interview: 'interview.manage',
  assessment: 'assessment.manage',
  rejection: 'application.update',
};


/**
 * The material fields that moved, with their values on one side of the change.
 *
 * Only the changed fields are shown: a two-column diff of eighteen identical
 * rows buries the one line that matters. Field names are humanised rather than
 * printed raw, and values are stringified — nothing here is model prose.
 */
function changedRows(
  data: Record<string, unknown> | null,
  fields: string[],
): { key: string; label: string; value: string }[] {
  const LABELS: Record<string, string> = {
    when: 'When',
    candidate: 'Candidate',
    company: 'Company',
    job_title: 'Role',
    time_zone: 'Time zone',
    due_date: 'Due',
    assessment_type: 'Assessment',
    meeting_url: 'Meeting link',
    assessment_url: 'Link',
    external_reference: 'Their reference',
    application_date: 'Applied',
  };

  const read = (key: string): string => {
    if (!data) return 'not recorded';
    if (key === 'when') {
      const value = data.scheduled_at ?? data.interview_date ?? null;
      const time = data.interview_time ?? null;
      if (value === null) return 'not stated';
      return time ? `${String(value)} ${String(time)}` : String(value);
    }
    const value = data[key];
    return value === null || value === undefined || value === '' ? 'not stated' : String(value);
  };

  return fields.map((key) => ({
    key,
    label: LABELS[key] ?? key.replace(/_/g, ' '),
    value: read(key),
  }));
}

function editableFields(
  eventType: string,
  data: Record<string, unknown>,
): EditableField[] {
  const value = (key: string) => {
    const raw = data[key];
    return typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw);
  };

  if (eventType === 'application') {
    return [
      { key: 'company', label: 'Company', value: value('company'), required: true },
      { key: 'job_title', label: 'Role', value: value('job_title'), required: true },
      {
        key: 'application_date',
        label: 'Application date',
        value: value('application_date'),
        type: 'date',
      },
      { key: 'external_reference', label: 'Their reference', value: value('external_reference') },
    ];
  }

  if (eventType === 'interview') {
    return [
      { key: 'application_id', label: 'Application', value: value('application_id'), required: true },
      {
        key: 'scheduled_at',
        label: 'When (UTC instant)',
        value: value('scheduled_at'),
        required: true,
        hint: 'Resolved from the date, time and zone stated in the email.',
      },
      {
        key: 'time_zone',
        label: 'Time zone',
        value: value('time_zone'),
        required: true,
        hint: 'Never assumed. If the email did not state one, supply it here.',
      },
      { key: 'meeting_url', label: 'Meeting link', value: value('meeting_url'), type: 'url' },
      { key: 'interviewer', label: 'Interviewer', value: value('interviewer') },
    ];
  }

  if (eventType === 'assessment') {
    return [
      { key: 'application_id', label: 'Application', value: value('application_id'), required: true },
      {
        key: 'assessment_type',
        label: 'Assessment',
        value: value('assessment_type'),
        required: true,
      },
      { key: 'due_date', label: 'Due', value: value('due_date'), type: 'date' },
      { key: 'assessment_url', label: 'Link', value: value('assessment_url'), type: 'url' },
    ];
  }

  if (eventType === 'rejection') {
    return [
      { key: 'application_id', label: 'Application', value: value('application_id'), required: true },
      { key: 'reason_if_explicit', label: 'Stated reason', value: value('reason_if_explicit') },
    ];
  }

  return [];
}

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const actor = await requirePermission('proposal.review');
  const { proposalId } = await params;

  let proposal;
  try {
    proposal = await getProposal(proposalId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const eventMeta = INTELLIGENCE_EVENT_TYPE_META[proposal.eventType];
  const statusMeta = PROPOSAL_REVIEW_STATUS_META[proposal.status];
  const priorityMeta = REVIEW_ITEM_PRIORITY_META[proposal.priority];

  const requiredPermission = PERMISSION_FOR_EVENT[proposal.eventType];
  // Two gates: may you work the queue, and may you create THIS kind of record.
  // Both are checked again server-side; this only decides what to offer.
  const canApprove =
    can(actor, 'proposal.approve') &&
    (requiredPermission === undefined ||
      can(actor, requiredPermission as Parameters<typeof can>[1]));

  const fields = editableFields(
    proposal.eventType,
    proposal.finalData ?? proposal.proposedData,
  );

  const createdId =
    proposal.createdApplicationId ?? proposal.createdInterviewId ?? proposal.createdAssessmentId;
  const createdHref = proposal.createdInterviewId
    ? `/interviews/${proposal.createdInterviewId}`
    : proposal.createdAssessmentId
      ? `/assessments/${proposal.createdAssessmentId}`
      : proposal.createdApplicationId
        ? `/applications/${proposal.createdApplicationId}`
        : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`${eventMeta.label}${proposal.candidateName ? ` — ${proposal.candidateName}` : ''}`}
        description={proposal.emailSubject ?? '(no subject)'}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/intelligence/${proposal.intelligenceRunId}`}>The reading</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/proposals">Queue</Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
        <Badge tone={priorityMeta.tone}>{priorityMeta.label} priority</Badge>
        <Badge tone={eventMeta.tone}>{eventMeta.label}</Badge>
        {proposal.status === 'approved' ? (
          <span className="text-[12.5px] text-[var(--text-muted)]">
            {proposal.reviewedByName
              ? `Approved by ${proposal.reviewedByName}`
              : 'Approved automatically'}
            {proposal.reviewedAt ? ` · ${formatDateTime(proposal.reviewedAt)}` : ''}
          </span>
        ) : null}
      </div>

      {/* WHY AM I SEEING THIS — first, always. */}
      {proposal.reasonCodes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Why this needs a person</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-2">
              {proposal.reasonCodes.map((code) => (
                <li key={code} className="flex gap-2 text-[13.5px] text-[var(--text-primary)]">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-px w-3 shrink-0 bg-[var(--border-strong)]"
                  />
                  <span>
                    {DECISION_REASON_META[code]?.label ?? code}
                    <span className="ml-1.5 font-mono text-[11px] uppercase text-[var(--text-muted)]">
                      {code}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {proposal.explanation ? (
              <p className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[13px] text-[var(--text-secondary)]">
                {proposal.explanation}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* THIS EMAIL WAS ALREADY ACTED ON, AND THIS READING DISAGREES.
          Shown above everything else, because it changes what the rest of the
          page means: approving here is not "record this", it is "decide which
          of two readings is right". Facts only — two proposals, the fields that
          moved, and the record already on file. */}
      {proposal.interpretationChange ? (
        <Card>
          <CardHeader>
            <CardTitle>Interpretation changed</CardTitle>
            <Badge tone="caution">Already acted on</Badge>
          </CardHeader>
          <CardBody>
            <p className="text-[13px] text-[var(--text-secondary)]">
              This email was processed before. The latest reading disagrees with the proposal
              that was acted upon. Nothing already on file has been changed.
            </p>

            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-[var(--border-subtle)] p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  Previously
                  {proposal.interpretationChange.previousDecidedAt
                    ? ` — ${formatDateTime(proposal.interpretationChange.previousDecidedAt)}`
                    : ''}
                </dt>
                <dd className="mt-1.5 flex flex-col gap-1">
                  {changedRows(
                    proposal.interpretationChange.previousData,
                    proposal.interpretationChange.changedFields,
                  ).map((row) => (
                    <span key={row.key} className="text-[13px] text-[var(--text-primary)]">
                      <span className="text-[var(--text-muted)]">{row.label}: </span>
                      {row.value}
                    </span>
                  ))}
                </dd>
              </div>

              <div className="rounded-md border border-[var(--border-strong)] p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  Latest reading
                </dt>
                <dd className="mt-1.5 flex flex-col gap-1">
                  {changedRows(
                    proposal.finalData ?? proposal.proposedData,
                    proposal.interpretationChange.changedFields,
                  ).map((row) => (
                    <span key={row.key} className="text-[13px] text-[var(--text-primary)]">
                      <span className="text-[var(--text-muted)]">{row.label}: </span>
                      {row.value}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>

            <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[13px] text-[var(--text-secondary)]">
              {proposal.interpretationChange.existingRecordId ? (
                <p>
                  Existing record:{' '}
                  <span className="font-medium text-[var(--text-primary)]">
                    {proposal.interpretationChange.existingRecordKind ?? 'record'}{' '}
                    <span className="font-mono text-[12px]">
                      {proposal.interpretationChange.existingRecordId}
                    </span>
                  </span>{' '}
                  — unchanged. Approving here does not edit or cancel it.
                </p>
              ) : (
                <p>The earlier decision created no record.</p>
              )}
              <p className="mt-1">
                <Link
                  href={`/proposals/${proposal.interpretationChange.previousItemId}`}
                  className="underline underline-offset-2"
                >
                  Open the earlier decision
                </Link>
              </p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* CENTRE — the evidence, exactly as it arrived. */}
        <Card>
          <CardHeader>
            <CardTitle>Email evidence</CardTitle>
            <Link
              href={`/emails/${proposal.emailMessageId}`}
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              Open the email
            </Link>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Fact
                label="From"
                value={`${proposal.email.fromName ? `${proposal.email.fromName} ` : ''}<${proposal.email.fromAddress}>`}
              />
              <Fact label="Received" value={formatDateTime(proposal.email.receivedAt)} />
            </dl>

            {proposal.email.bodyText ? (
              <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words border-t border-[var(--border-subtle)] pt-3 font-sans text-[13px] leading-relaxed text-[var(--text-primary)]">
                {proposal.email.bodyText}
              </pre>
            ) : (
              <p className="mt-3 text-[13px] text-[var(--text-muted)]">No body was captured.</p>
            )}

            {proposal.evidence.length > 0 ? (
              <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  What the reading quoted
                </p>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {proposal.evidence.map((item) => (
                    <li key={`${item.field}-${item.excerpt}`} className="text-[12.5px]">
                      <span className="font-medium text-[var(--text-secondary)]">{item.field}</span>
                      <blockquote className="mt-0.5 border-l-2 border-[var(--border-strong)] pl-2.5 italic text-[var(--text-muted)]">
                        “{item.excerpt}”
                      </blockquote>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* RIGHT — the proposed action. */}
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Candidate</CardTitle>
              {proposal.candidateMatchConfidence !== null ? (
                <span className="tabular text-[13px] text-[var(--text-muted)]">
                  {(proposal.candidateMatchConfidence * 100).toFixed(0)}%
                </span>
              ) : null}
            </CardHeader>
            <CardBody>
              {proposal.candidateId ? (
                <Link
                  href={`/candidates/${proposal.candidateId}`}
                  className="text-[14px] font-medium text-[var(--text-primary)] hover:text-[var(--color-accent-600)] hover:underline"
                >
                  {proposal.candidateName ?? 'Candidate'}
                </Link>
              ) : (
                <p className="text-[14px] text-[var(--text-secondary)]">No candidate proposed.</p>
              )}

              {proposal.candidateMatchReasons.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {proposal.candidateMatchReasons.map((reason) => (
                    <li key={reason} className="text-[12.5px] text-[var(--text-secondary)]">
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Proposed action</CardTitle>
            </CardHeader>
            <CardBody>
              {createdHref ? (
                <p className="mb-3 text-[13px] text-[var(--text-secondary)]">
                  This produced{' '}
                  <Link
                    href={createdHref}
                    className="text-[var(--color-accent-600)] hover:underline"
                  >
                    a {proposal.eventType} record
                  </Link>
                  .
                </p>
              ) : null}

              <DecisionPanel
                proposalId={proposal.id}
                status={proposal.status}
                fields={fields}
                canApprove={canApprove}
                eventLabel={eventMeta.label}
              />

              {proposal.decisionNotes ? (
                <p className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[13px] text-[var(--text-secondary)]">
                  {proposal.decisionNotes}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {proposal.correctedData ? (
            <Card>
              <CardHeader>
                <CardTitle>What was corrected</CardTitle>
              </CardHeader>
              <CardBody>
                <dl className="flex flex-col gap-2">
                  {Object.entries(proposal.correctedData).map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-0.5">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        {key}
                      </dt>
                      <dd className="text-[13.5px] text-[var(--text-primary)]">
                        Proposed{' '}
                        <span className="line-through text-[var(--text-muted)]">
                          {String(proposal.proposedData[key] ?? '—')}
                        </span>{' '}
                        · recorded {String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      {createdId ? null : (
        <p className="text-[12px] text-[var(--text-muted)]">
          Nothing has been written for this proposal.
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="break-words text-[13.5px] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}
