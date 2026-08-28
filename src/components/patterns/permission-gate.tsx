import type { ReactNode } from 'react';
import { can, type ActorContext } from '@/server/auth/actor';
import type { PermissionCode } from '@/config/permissions';

/**
 * Hides UI the actor cannot use.
 *
 * ERGONOMICS ONLY. This is not a security control — the database refuses the
 * write regardless of what is rendered. Its job is to avoid offering a button
 * that will fail.
 */
export function PermissionGate({
  actor,
  permission,
  children,
  fallback = null,
}: {
  actor: ActorContext;
  permission: PermissionCode;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return can(actor, permission) ? <>{children}</> : <>{fallback}</>;
}
