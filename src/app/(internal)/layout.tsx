import { redirect } from 'next/navigation';
import { getActor } from '@/server/auth/actor';
import { AppShell } from '@/components/patterns/app-shell';
import { INTERNAL_NAV } from '@/config/navigation';
import { ROLE_LABELS } from '@/config/permissions';
import { can } from '@/server/auth/actor';

/**
 * Internal CRM shell.
 *
 * Every page under this group is authenticated, internal-only, and dynamic.
 * Static rendering is off because all data here is RLS-scoped, and Next.js's
 * data cache is global — caching a user-scoped query would serve one user's
 * candidates to another (docs/architecture/04 §7).
 */
export const dynamic = 'force-dynamic';

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();

  if (!actor) redirect('/sign-in');
  // A portal user landing here is sent to their own experience, not shown an
  // error: it is a wrong turn, not an attack.
  if (!actor.isInternal) redirect('/portal');

  const nav = INTERNAL_NAV.filter((item) => !item.permission || can(actor, item.permission));
  const primaryRole = actor.roles.find((r) => r !== 'candidate') ?? 'recruiter';

  return (
    <AppShell
      brandSuffix="Marketing OS"
      nav={nav}
      user={{ name: actor.fullName, email: actor.email, role: ROLE_LABELS[primaryRole] }}
    >
      {children}
    </AppShell>
  );
}
