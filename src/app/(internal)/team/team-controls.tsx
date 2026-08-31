'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { USER_STATUS_META } from '@/config/statuses';
import { ASSIGNABLE_ROLES, type RoleCode } from '@/config/permissions';
import { setUserStatusAction, grantUserRoleAction, revokeUserRoleAction } from './actions';

type ActionResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string; requestId?: string; fieldErrors?: Record<string, string[]> };

function useAction() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function run(fn: () => Promise<ActionResult>) {
    setFormError(null);
    setBusy(true);
    const result = await fn();
    setBusy(false);

    if (!result.ok) {
      setFormError(`${result.message}${result.requestId ? ` Reference: ${result.requestId}` : ''}`);
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  return { run, busy, formError };
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[13px] text-[var(--color-critical)]">
      {message}
    </p>
  );
}

const ASSIGNABLE_STATUSES = ['active', 'suspended', 'disabled'] as const;

/**
 * Activating and deactivating an account.
 *
 * A suspended account stops being an actor on the very next request: the
 * session resolver returns null for anything that is not active, and every
 * downstream check fails closed on a null actor. There is no waiting for a
 * token to expire.
 */
export function AccountStatusControl({
  userId,
  currentStatus,
  isSelf,
}: {
  userId: string;
  currentStatus: string;
  isSelf: boolean;
}) {
  const { run, busy, formError } = useAction();
  const options = ASSIGNABLE_STATUSES.filter((s) => s !== currentStatus);
  const [status, setStatus] = useState<string>(options[0] ?? 'suspended');

  if (isSelf) {
    return (
      <p className="text-[13px] text-[var(--text-secondary)]">
        You cannot change the status of your own account. Another administrator has to do it —
        which is also what stops a suspended account from restoring itself.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      action={async () => {
        await run(() => setUserStatusAction({ userId, status }));
      }}
    >
      <Field label="Set account status to" htmlFor="status">
        <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {options.map((s) => (
            <option key={s} value={s}>
              {USER_STATUS_META[s].label}
            </option>
          ))}
        </Select>
      </Field>

      <ErrorLine message={formError} />

      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Apply'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Role grants.
 *
 * `admin` appears in the list only for an administrator. That is presentation:
 * the database refuses the grant regardless, in a trigger that does not care
 * what the interface offered.
 */
export function RoleControl({
  userId,
  currentRoles,
  actorIsAdmin,
  isSelf,
}: {
  userId: string;
  currentRoles: RoleCode[];
  actorIsAdmin: boolean;
  isSelf: boolean;
}) {
  const { run, busy, formError } = useAction();

  const grantable = ASSIGNABLE_ROLES.filter(
    (r) => !currentRoles.includes(r) && (r !== 'admin' || actorIsAdmin),
  );
  const [role, setRole] = useState<string>(grantable[0] ?? 'recruiter');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Current roles
        </p>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {currentRoles.length === 0 ? (
            <li className="text-[13px] text-[var(--text-muted)]">None</li>
          ) : (
            currentRoles.map((r) => (
              <li key={r} className="flex items-center justify-between gap-3">
                <span className="text-[13.5px] text-[var(--text-primary)]">{r}</span>
                {!isSelf && currentRoles.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(() => revokeUserRoleAction({ userId, role: r }))}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>

      {grantable.length > 0 && !isSelf ? (
        <form
          className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-3"
          action={async () => {
            await run(() => grantUserRoleAction({ userId, role }));
          }}
        >
          <Field label="Add a role" htmlFor="role">
            <Select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <Button type="submit" variant="secondary" size="sm" disabled={busy}>
              {busy ? 'Saving…' : 'Grant role'}
            </Button>
          </div>
        </form>
      ) : null}

      {isSelf ? (
        <p className="border-t border-[var(--border-subtle)] pt-3 text-[13px] text-[var(--text-secondary)]">
          You cannot change your own roles. Granting yourself a permission you were not given is
          the escalation path this rule exists to close.
        </p>
      ) : null}

      <ErrorLine message={formError} />
    </div>
  );
}
