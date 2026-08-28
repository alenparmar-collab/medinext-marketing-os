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
  { label: 'Applications', href: '/applications', icon: 'Send', status: 'planned', plannedIn: 'Build 4' },
  { label: 'Interviews', href: '/interviews', icon: 'CalendarClock', status: 'planned', plannedIn: 'Build 4' },
  { label: 'Assessments', href: '/assessments', icon: 'ClipboardCheck', status: 'planned', plannedIn: 'Build 4' },
  { label: 'Daily Reports', href: '/reports/daily', icon: 'FileText', status: 'planned', plannedIn: 'Build 5' },
  { label: 'Review Queue', href: '/review', icon: 'ListChecks', status: 'planned', plannedIn: 'Build 5' },
  { label: 'Notifications', href: '/notifications', icon: 'Bell', status: 'planned', plannedIn: 'Build 4' },
  { label: 'Reports', href: '/reports', icon: 'BarChart3', status: 'planned', plannedIn: 'Build 5' },
  { label: 'Team', href: '/team', icon: 'UserCog', status: 'planned', plannedIn: 'Build 3', permission: 'user.manage' },
  { label: 'Settings', href: '/settings', icon: 'Settings', status: 'ready' },
];

export const PORTAL_NAV: NavItem[] = [
  { label: 'Home', href: '/portal', icon: 'Home', status: 'ready' },
  { label: 'My Profile', href: '/portal/profile', icon: 'User', status: 'ready' },
  { label: 'My Marketing', href: '/portal/marketing', icon: 'Megaphone', status: 'ready' },
  { label: 'Documents', href: '/portal/documents', icon: 'Files', status: 'ready' },
  { label: 'Applications', href: '/portal/applications', icon: 'Send', status: 'planned', plannedIn: 'Build 4' },
  { label: 'Interviews', href: '/portal/interviews', icon: 'CalendarClock', status: 'planned', plannedIn: 'Build 4' },
  { label: 'Assessments', href: '/portal/assessments', icon: 'ClipboardCheck', status: 'planned', plannedIn: 'Build 4' },
  { label: 'Notifications', href: '/portal/notifications', icon: 'Bell', status: 'planned', plannedIn: 'Build 4' },
  { label: 'Activity', href: '/portal/activity', icon: 'History', status: 'planned', plannedIn: 'Build 4' },
  { label: 'Help', href: '/portal/help', icon: 'CircleHelp', status: 'ready' },
];
