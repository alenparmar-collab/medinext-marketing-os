import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Help' };

const FAQ = [
  {
    q: 'What can I see here?',
    a: 'Your own profile, your marketing periods, and any documents your recruiter has shared with you. You cannot see other candidates, and other candidates cannot see you.',
  },
  {
    q: 'Something in my profile is wrong.',
    a: 'Contact your recruiter and they will correct it. This portal is read-only for now.',
  },
  {
    q: 'Where are my applications and interviews?',
    a: 'They are being added in a later release. When they arrive they will show up in this portal automatically.',
  },
  {
    q: 'Who can see my information?',
    a: 'Only you, the recruiters assigned to you, and their managers. Access is enforced by the database itself, not just by what this page chooses to display.',
  },
];

export default async function PortalHelpPage() {
  await requireCandidate();

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Help" description="Common questions about this portal." />
      <Card>
        <CardBody>
          <dl className="flex flex-col">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="border-b border-[var(--border-subtle)] py-3 last:border-b-0">
                <dt className="text-[14px] font-medium text-[var(--text-primary)]">{q}</dt>
                <dd className="mt-1 text-[13.5px] text-[var(--text-secondary)]">{a}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
