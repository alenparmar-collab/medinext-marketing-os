import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getIntelligenceRun } from '@/server/modules/intelligence/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils/format';
import {
  INTELLIGENCE_EVENT_TYPE_META,
  INTELLIGENCE_STATUS_META,
} from '@/config/statuses';
import { CONFIDENCE_BAND_META, confidenceBand } from '@/config/intelligence';
import { InterpretButton } from '../interpret-button';

export const metadata: Metadata = { title: 'Interpretation' };

/**
 * One reading.
 *
 * Structured throughout — the raw JSON is available at the bottom for someone
 * debugging, but the default view is fields with the text that supports them,
 * because "the model said 14:00" is only useful next to the sentence it read
 * it from.
 */
const FIELD_LABELS: Record<string, string> = {
  company: 'Company',
  job_title: 'Role',
  external_reference: 'Their reference',
  application_date: 'Application date',
  interview_date: 'Interview date',
  interview_time: 'Interview time',
  timezone: 'Time zone',
  interview_mode: 'Format',
  meeting_url: 'Meeting link',
  interviewer: 'Interviewer',
  interview_type: 'Interview type',
  assessment_name: 'Assessment',
  assessment_type: 'Assessment type',
  due_date: 'Due',
  assessment_url: 'Assessment link',
  rejection_date: 'Rejection date',
  reason_if_explicit: 'Stated reason',
  response_summary: 'Response',
};

export default async function IntelligenceDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const actor = await requirePermission('intelligence.view');
  const { runId } = await params;

  let run;
  try {
    run = await getIntelligenceRun(runId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const status = INTELLIGENCE_STATUS_META[run.status];
  const band = confidenceBand(run.eventConfidence);
  const matchBand = confidenceBand(run.candidateMatchConfidence);

  const evidenceByField = new Map<string, string[]>();
  for (const item of run.evidence) {
    const list = evidenceByField.get(item.field) ?? [];
    list.push(item.excerpt);
    evidenceByField.set(item.field, list);
  }

  const extracted = Object.entries(run.extractedData).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={run.emailSubject ?? '(no subject)'}
        description={`Reading ${run.runNumber} · ${run.emailFrom}`}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/emails/${run.emailMessageId}`}>Open the email</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/intelligence">All readings</Link>
            </Button>
          </div>
        }
      />

      {/*
        Stated once, at the top, in the plainest available words. Somebody
        looking at a confident-sounding extraction needs to know before they
        read it that nothing has acted on it.
      */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          Proposal
        </span>
        <span className="text-[12.5px] text-[var(--text-muted)]">
          A model&apos;s reading of the email. It has changed no candidate, application, interview
          or assessment, and nothing acts on it automatically.
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reading</CardTitle>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={status.tone}>{status.label}</Badge>
            {run.eventType ? (
              <Badge tone={INTELLIGENCE_EVENT_TYPE_META[run.eventType].tone}>
                {INTELLIGENCE_EVENT_TYPE_META[run.eventType].label}
              </Badge>
            ) : null}
          </span>
        </CardHeader>
        <CardBody>
          <p className="text-[13px] text-[var(--text-secondary)]">{status.description}</p>

          {run.summary ? (
            <p className="mt-3 text-[14px] text-[var(--text-primary)]">{run.summary}</p>
          ) : null}

          {run.eventConfidence !== null ? (
            <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Confidence in the classification
              </p>
              <p className="tabular mt-1 text-[20px] font-semibold text-[var(--text-primary)]">
                {(run.eventConfidence * 100).toFixed(0)}%
                <span className="ml-2 text-[13px] font-normal text-[var(--text-secondary)]">
                  {CONFIDENCE_BAND_META[band].label}
                </span>
              </p>
              <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                {CONFIDENCE_BAND_META[band].description} This is the model&apos;s own estimate, not
                a measured accuracy.
              </p>
            </div>
          ) : null}

          {run.errorMessage ? (
            <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-caution)]/30 bg-[var(--color-caution-bg)] px-3 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Why it failed
              </p>
              <p className="mt-1 text-[13px] text-[var(--text-primary)]">{run.errorMessage}</p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Candidate proposal</CardTitle>
          {run.candidateMatchConfidence !== null ? (
            <Badge tone={CONFIDENCE_BAND_META[matchBand].tone}>
              {CONFIDENCE_BAND_META[matchBand].label}
            </Badge>
          ) : null}
        </CardHeader>
        <CardBody>
          {run.proposedCandidateId ? (
            <>
              <p className="text-[14px] text-[var(--text-primary)]">
                <Link
                  href={`/candidates/${run.proposedCandidateId}`}
                  className="font-medium hover:text-[var(--color-accent-600)] hover:underline"
                >
                  {run.proposedCandidateName ?? 'Candidate'}
                </Link>
                {run.candidateMatchConfidence !== null ? (
                  <span className="tabular ml-2 text-[13px] text-[var(--text-secondary)]">
                    {(run.candidateMatchConfidence * 100).toFixed(0)}%
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">
                Proposed only. Nothing has been attached to this candidate&apos;s record.
              </p>
            </>
          ) : (
            <p className="text-[14px] text-[var(--text-secondary)]">No candidate proposed.</p>
          )}

          {run.candidateMatchReasons.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5">
              {run.candidateMatchReasons.map((reason) => (
                <li key={reason} className="flex gap-2 text-[13px] text-[var(--text-secondary)]">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-px w-3 shrink-0 bg-[var(--border-strong)]"
                  />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[12px] text-[var(--text-muted)]">
            The proposal is resolved by the server from identifiers found in the message. The model
            never chooses a candidate, and a name on its own is never enough.
          </p>
        </CardBody>
      </Card>

      {extracted.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>What the email says</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="flex flex-col">
              {extracted.map(([field, value]) => {
                const excerpts = evidenceByField.get(field) ?? [];
                return (
                  <li
                    key={field}
                    className="border-b border-[var(--border-subtle)] px-5 py-3 last:border-b-0"
                  >
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      {FIELD_LABELS[field] ?? field}
                    </p>
                    <p className="mt-0.5 break-words text-[14px] text-[var(--text-primary)]">
                      {String(value)}
                    </p>
                    {excerpts.length > 0 ? (
                      <blockquote className="mt-1.5 border-l-2 border-[var(--border-strong)] pl-2.5 text-[12.5px] italic text-[var(--text-secondary)]">
                        {excerpts.map((excerpt) => (
                          <p key={excerpt}>“{excerpt}”</p>
                        ))}
                      </blockquote>
                    ) : (
                      <p className="mt-1 text-[12px] text-[var(--color-caution)]">
                        No supporting text was quoted for this value.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>How this reading was produced</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fact label="Provider" value={run.provider} />
            <Fact label="Model" value={run.model} />
            <Fact label="Prompt version" value={run.promptVersion} />
            <Fact label="Reading number" value={String(run.runNumber)} />
            <Fact label="Requested by" value={run.requestedByName ?? 'System'} />
            <Fact label="Started" value={run.startedAt ? formatDateTime(run.startedAt) : '—'} />
            <Fact
              label="Finished"
              value={run.completedAt ? formatDateTime(run.completedAt) : '—'}
            />
            <Fact
              label="Schema validation"
              value={run.validationOk === null ? '—' : run.validationOk ? 'Passed' : 'Failed'}
            />
          </dl>

          {run.otherRuns.length > 0 ? (
            <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Other readings of this email
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {run.otherRuns.map((other) => (
                  <li key={other.id} className="text-[13px]">
                    <Link
                      href={`/intelligence/${other.id}`}
                      className="text-[var(--color-accent-600)] hover:underline"
                    >
                      Reading {other.runNumber}
                    </Link>
                    <span className="ml-2 text-[var(--text-muted)]">
                      {INTELLIGENCE_STATUS_META[other.status].label} ·{' '}
                      {formatDateTime(other.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                Readings accumulate. Reprocessing adds one; it never edits or replaces an earlier
                answer.
              </p>
            </div>
          ) : null}

          {can(actor, 'intelligence.run') ? (
            <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
              <InterpretButton emailMessageId={run.emailMessageId} hasExistingRun />
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/*
        The debug view. Collapsed by default — useful when a reading looks
        wrong, noise the rest of the time.
      */}
      <details className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-3">
        <summary className="cursor-pointer text-[13px] font-medium text-[var(--text-secondary)]">
          Raw result
        </summary>
        <pre className="mt-3 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] p-3 font-mono text-[12px] text-[var(--text-secondary)]">
          {JSON.stringify(
            {
              extracted_data: run.extractedData,
              evidence: run.evidence,
              candidate_match_evidence: run.candidateMatchEvidence,
              validation_result: run.validationResult,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="break-words text-[14px] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}
