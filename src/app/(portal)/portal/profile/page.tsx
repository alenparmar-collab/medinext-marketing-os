import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { getMyProfile } from '@/server/modules/portal/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatExperience } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'My profile' };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--border-subtle)] py-2.5 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-48 shrink-0 text-[13px] text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-[14px] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function Tags({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <span className="text-[var(--text-muted)]">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <Badge key={v} tone="neutral">
          {v}
        </Badge>
      ))}
    </div>
  );
}

export default async function PortalProfilePage() {
  const actor = await requireCandidate();
  const profile = await getMyProfile(actor.candidateId);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="My profile"
        description="Your details as we hold them. To change anything, contact your recruiter."
      />

      <Card>
        <CardBody>
          <dl className="flex flex-col">
            <Row label="Reference" value={<span className="font-mono">{profile.reference}</span>} />
            <Row label="Name" value={profile.fullName} />
            <Row label="Email" value={profile.email} />
            <Row label="Phone" value={profile.phone ?? '—'} />
            <Row label="Primary skill" value={profile.primarySkill ?? '—'} />
            <Row label="Skills" value={<Tags values={profile.skills} empty="None recorded" />} />
            <Row label="Experience" value={formatExperience(profile.experienceMonths)} />
            <Row label="Current location" value={profile.currentLocation ?? '—'} />
            <Row
              label="Preferred locations"
              value={<Tags values={profile.preferredLocations} empty="Not specified (optional)" />}
            />
            <Row label="Education" value={profile.education ?? '—'} />
            <Row
              label="Certifications"
              value={<Tags values={profile.certifications} empty="None recorded" />}
            />
          </dl>
        </CardBody>
      </Card>

      <p className="text-[13px] text-[var(--text-muted)]">
        This portal is read-only. Editing your own profile is being considered for a later
        release.
      </p>
    </div>
  );
}
