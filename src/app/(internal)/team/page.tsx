import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Team' };

export default async function Page() {
  await requireInternal();
  return (
    <ComingSoon
      title="Team"
      description="User accounts, roles and the permission matrix."
      plannedIn="Build 3"
      willInclude={['User administration and portal invitations', 'Role grants with audit', 'The role/permission matrix as editable data']}
    />
  );
}
