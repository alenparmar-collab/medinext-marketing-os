/**
 * Formatting helpers.
 *
 * Dates are rendered in a fixed, unambiguous format. `03/04/2026` means two
 * different days depending on the reader, and this product will eventually
 * carry interview times where that ambiguity has a real cost.
 */
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMAT.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME_FORMAT.format(date);
}

/** Months to a human span. 78 months reads better as "6y 6m" than "78". */
export function formatExperience(months: number | null | undefined): string {
  if (months === null || months === undefined) return '—';
  if (months < 12) return `${months}m`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years}y` : `${years}y ${rest}m`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Renders a scheduled time in the reader's own zone, and adds the zone it was
 * scheduled in whenever the two differ.
 *
 * Interview times are the highest-stakes data in this product: a candidate who
 * misreads one misses an interview. Showing a bare local time is how that
 * happens, so this never returns one.
 */
export function formatScheduledTime(
  value: string | null | undefined,
  scheduledZone?: string | null,
): string {
  if (!value) return 'Time to be confirmed';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time to be confirmed';

  const local = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);

  if (!scheduledZone) return local;

  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (viewerZone === scheduledZone) return local;

  const atSource = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: scheduledZone,
    timeZoneName: 'short',
  }).format(date);

  return `${local} · ${atSource} where the interview is held`;
}

/** "in 3 days", "2 days ago" — for deadlines and upcoming work. */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return '—';

  const diffMs = target - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

  if (Math.abs(diffDays) >= 1) return rtf.format(diffDays, 'day');
  const diffHours = Math.round(diffMs / 3_600_000);
  if (Math.abs(diffHours) >= 1) return rtf.format(diffHours, 'hour');
  return rtf.format(Math.round(diffMs / 60_000), 'minute');
}
