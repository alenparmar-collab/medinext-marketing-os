import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { getMyInterviews } from '@/server/modules/portal/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/patterns/states';
import { InterviewStatusBadge } from '@/components/patterns/status-badge';
import { formatScheduledTime, formatRelative } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Interviews' };

/**
 * The candidate's own interviews.
 *
 * Upcoming ones are given the prominence they deserve — this is the page
 * someone opens on a phone the morning of an interview to find the joining
 * link. The time is never shown bare: `formatScheduledTime` labels the zone,
 * and adds the interview's own zone when it differs from the reader's.
 */
export default async function PortalInterviewsPage() {
  const actor = await requireCandidate();
  const interviews = await getMyInterviews(actor.candidateId);

  const upcoming = interviews
    .filter((i) => i.isUpcoming)
    .sort((a, b) => Date.parse(a.scheduledAt ?? '') - Date.parse(b.scheduledAt ?? ''));
  const past = interviews.filter((i) => !i.isUpcoming);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Interviews"
        description="Interviews arranged for you. Times are shown in your own time zone."
      />

      {interviews.length === 0 ? (
        <EmptyState
          title="No interviews yet"
          body="When your recruiter arranges an interview, it will appear here with the date, time and joining details. There is nothing for you to do in the meantime."
        />
      ) : (
        <>
          {upcoming.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Coming up</h2>
              <ul className="flex flex-col gap-3">
                {upcoming.map((i) => (
                  <li key={i.id}>
                    <Card className="border-[var(--color-accent-600)]/30">
                      <CardBody className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[15px] font-medium text-[var(--text-primary)]">
                              {i.positionTitle || 'Interview'}
                            </p>
                            <p className="text-[13.5px] text-[var(--text-secondary)]">
                              {i.companyName} · round {i.interviewRound}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <InterviewStatusBadge status={i.status} />
                            <span className="text-[12px] text-[var(--text-muted)]">
                              {formatRelative(i.scheduledAt)}
                            </span>
                          </div>
                        </div>

                        <p className="tabular text-[14px] text-[var(--text-primary)]">
                          {formatScheduledTime(i.scheduledAt, i.timeZone)}
                        </p>

                        {i.meetingUrl ? (
                          <a
                            href={i.meetingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-9 w-fit items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-600)] px-3 text-[13.5px] font-medium text-white transition-colors duration-100 hover:bg-[var(--color-accent-700)]"
                          >
                            Join the interview
                          </a>
                        ) : (
                          <p className="text-[13px] text-[var(--text-muted)]">
                            Joining details will be added here once confirmed.
                          </p>
                        )}
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {past.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Past interviews
              </h2>
              <Card>
                <CardBody>
                  <ul className="flex flex-col">
                    {past.map((i) => (
                      <li
                        key={i.id}
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-3 last:border-b-0 first:pt-0"
                      >
                        <div className="min-w-0">
                          <p className="text-[14px] text-[var(--text-primary)]">
                            {i.positionTitle || 'Interview'} · {i.companyName}
                          </p>
                          <p className="tabular text-[12.5px] text-[var(--text-muted)]">
                            Round {i.interviewRound} ·{' '}
                            {formatScheduledTime(i.scheduledAt, i.timeZone)}
                          </p>
                        </div>
                        <InterviewStatusBadge status={i.status} />
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
