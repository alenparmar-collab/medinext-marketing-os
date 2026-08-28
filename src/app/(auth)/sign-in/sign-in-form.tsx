'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

/**
 * Sign-in runs in the browser so the Supabase client can persist the session
 * cookies it issues. It is the one place browser-side Supabase code is correct.
 *
 * The error message is deliberately identical for a wrong password and an
 * unknown address: distinguishing them confirms which accounts exist.
 */
export function SignInForm({ nextPath }: { nextPath: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);

    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    if (!email || !password) {
      setError('Enter your email address and password.');
      return;
    }

    const supabase = createBrowserSupabase();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError('That email address and password combination was not recognised.');
      return;
    }

    startTransition(() => {
      router.replace(nextPath && nextPath.startsWith('/') ? nextPath : '/');
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <Field label="Email address" htmlFor="email" required>
        <Input name="email" type="email" autoComplete="email" autoFocus required />
      </Field>

      <Field label="Password" htmlFor="password" required>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-critical)]/30 bg-[var(--color-critical-bg)] px-3 py-2 text-[13px] text-[var(--color-critical)]"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" disabled={isPending}>
        {isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
