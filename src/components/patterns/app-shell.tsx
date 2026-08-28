'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Icons from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { NavItem } from '@/config/navigation';

function NavIcon({ name }: { name: string }) {
  const Icon = (Icons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[name];
  return Icon ? <Icon size={16} /> : <Icons.Circle size={16} />;
}

/**
 * The shell for both experiences. Same primitives, different navigation and
 * different data paths — the two never share a query module.
 */
export function AppShell({
  brandSuffix,
  nav,
  user,
  children,
}: {
  brandSuffix: string;
  nav: NavItem[];
  user: { name: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[13px] font-bold uppercase tracking-[0.18em] text-[var(--text-primary)]">
            MediNext
          </span>
          <span aria-hidden="true" className="h-3 w-px bg-[var(--border-strong)]" />
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
            {brandSuffix}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-[13px] font-medium leading-tight text-[var(--text-primary)]">
              {user.name}
            </p>
            <p className="text-[11px] leading-tight text-[var(--text-muted)]">{user.role}</p>
          </div>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="rounded-[var(--radius-sm)] px-2 py-1 text-[13px] text-[var(--text-secondary)] transition-colors duration-100 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="flex flex-1">
        <nav
          aria-label="Primary"
          className="hidden w-56 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--surface-raised)] p-2 md:block"
        >
          <ul className="flex flex-col gap-0.5">
            {nav.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/portal' && pathname.startsWith(`${item.href}/`));
              const planned = item.status === 'planned';

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-[13.5px] transition-colors duration-100',
                      active
                        ? 'bg-[var(--color-accent-50)] font-medium text-[var(--color-accent-600)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]',
                      planned && 'opacity-55',
                    )}
                  >
                    <NavIcon name={item.icon} />
                    <span className="truncate">{item.label}</span>
                    {planned ? (
                      <span className="ml-auto text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                        Soon
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
