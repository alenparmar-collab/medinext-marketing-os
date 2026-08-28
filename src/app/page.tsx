import { redirect } from 'next/navigation';
import { getActor } from '@/server/auth/actor';

/**
 * Routes each person to the experience that belongs to them. Internal staff and
 * candidates never share a shell.
 */
export default async function RootPage() {
  const actor = await getActor();

  if (!actor) redirect('/sign-in');
  if (actor.isCandidate) redirect('/portal');
  redirect('/overview');
}
