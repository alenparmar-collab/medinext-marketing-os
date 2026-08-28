import { redirect } from 'next/navigation';
import { getActor } from '@/server/auth/actor';
import { AppShell } from '@/components/patterns/app-shell';
import { PORTAL_NAV } from '@/config/navigation';

/**
 * CANDIDATE PORTAL SHELL.
 *
 * A separate experience sharing one database, not a filtered CRM. Routes under
 * this group may only import from @/server/modules/portal — enforced by an
 * ESLint import zone, so it fails the build rather than review.
 *
 * Build 2 posture is READ-ONLY (decision D-01): candidates hold SELECT policies
 * and nothing else, on any table.
 */
export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();

  if (!actor) redirect('/sign-in');
  // Internal staff have no business in the portal shell; send them home.
  if (!actor.isCandidate || !actor.candidateId) redirect('/overview');

  return (
    <AppShell
      brandSuffix="Candidate Portal"
      nav={PORTAL_NAV}
      user={{ name: actor.fullName, email: actor.email, role: 'Candidate' }}
    >
      {children}
    </AppShell>
  );
}
