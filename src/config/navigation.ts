import type { PermissionCode } from './permissions';

/**
 * Navigation as data.
 *
 * Each entry declares the permission it needs, so the sidebar filters itself
 * from one source of truth rather than from scattered conditionals.
 *
 * `status: 'planned'` entries render as visible but disabled. That is a
 * deliberate Build 2 choice: the brief asks for the navigation structure
 * without the pages behind it, and a link that 404s is worse than one that says
 * what is coming.
 */
export type NavStatus = 'ready' | 'planned';

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  status: NavStatus;
  permission?: PermissionCode;
  /** Which build delivers this, shown on the placeholder page. */
  plannedIn?: string;
}

export const INTERNAL_NAV: NavItem[] = [
  { label: 'Overview', href: '/overview', icon: 'LayoutDashboard', status: 'ready' },
  { label: 'Candidates', href: '/candidates', icon: 'Users', status: 'ready' },
  { label: 'Marketing', href: '/marketing', icon: 'Megaphone', status: 'ready' },
  { label: 'Applications', href: '/applications', icon: 'Send', status: 'ready' },
  { label: 'Interviews', href: '/interviews', icon: 'CalendarClock', status: 'ready' },
  { label: 'Assessments', href: '/assessments', icon: 'ClipboardCheck', status: 'ready' },
  { label: 'Daily Reports', href: '/reports/daily', icon: 'FileText', status: 'ready', permission: 'report.view_own' },
  { label: 'Review Queue', href: '/review', icon: 'ListChecks', status: 'ready', permission: 'review.view' },
  { label: 'Emails', href: '/emails', icon: 'Mail', status: 'ready', permission: 'email.view' },
  { label: 'Notifications', href: '/notifications', icon: 'Bell', status: 'ready' },
  { label: 'Reports', href: '/reports', icon: 'BarChart3', status: 'ready', permission: 'report.view_all' },
  { label: 'Team', href: '/team', icon: 'UserCog', status: 'ready', permission: 'user.view' },
  { label: 'Settings', href: '/settings', icon: 'Settings', status: 'ready' },
];

export const PORTAL_NAV: NavItem[] = [
  { label: 'Home', href: '/portal', icon: 'Home', status: 'ready' },
  { label: 'My Profile', href: '/portal/profile', icon: 'User', status: 'ready' },
  { label: 'My Marketing', href: '/portal/marketing', icon: 'Megaphone', status: 'ready' },
  { label: 'Documents', href: '/portal/documents', icon: 'Files', status: 'ready' },
  { label: 'Applications', href: '/portal/applications', icon: 'Send', status: 'ready' },
  { label: 'Interviews', href: '/portal/interviews', icon: 'CalendarClock', status: 'ready' },
  { label: 'Assessments', href: '/portal/assessments', icon: 'ClipboardCheck', status: 'ready' },
  { label: 'Notifications', href: '/portal/notifications', icon: 'Bell', status: 'ready' },
  { label: 'Activity', href: '/portal/activity', icon: 'History', status: 'ready' },
  { label: 'Help', href: '/portal/help', icon: 'CircleHelp', status: 'ready' },
];
