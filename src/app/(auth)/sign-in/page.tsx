import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/auth/actor';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const actor = await getActor();
  if (actor) redirect(actor.isCandidate ? '/portal' : '/overview');

  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-7">
          <div className="mb-6 flex items-baseline gap-2.5">
            <span className="text-[13px] font-bold uppercase tracking-[0.18em] text-[var(--text-primary)]">
              MediNext
            </span>
            <span aria-hidden="true" className="h-3 w-px bg-[var(--border-strong)]" />
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
              Marketing OS
            </span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
            Sign in
          </h1>
          <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
            Accounts are created by an administrator. There is no self-registration.
          </p>
        </div>

        <SignInForm nextPath={next ?? null} />
      </div>
    </main>
  );
}
