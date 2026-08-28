import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';

/**
 * Placeholder for navigation entries whose pages arrive in a later build.
 *
 * Build 2 is asked for the navigation structure without the pages behind it. A
 * link that 404s is worse than one that says what is coming and when, so each
 * placeholder names the build that delivers it.
 */
export function ComingSoon({
  title,
  description,
  plannedIn,
  willInclude,
}: {
  title: string;
  description: string;
  plannedIn: string;
  willInclude: string[];
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title={title} description={description} />
      <Card>
        <CardBody>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Planned for {plannedIn}
          </p>
          <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
            This area is part of the navigation structure established in Build 2. The screens
            behind it are not built yet.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {willInclude.map((item) => (
              <li key={item} className="flex gap-2 text-[13.5px] text-[var(--text-secondary)]">
                <span aria-hidden="true" className="mt-2 h-px w-3 shrink-0 bg-[var(--border-strong)]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
