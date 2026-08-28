import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import type { StatusTone } from '@/config/statuses';

/**
 * Subtle tinted background with matching text, never a solid saturated fill.
 * Always carries a word: colour never conveys meaning on its own.
 */
const TONE_CLASSES: Record<StatusTone, string> = {
  neutral:
    'bg-[var(--surface-sunken)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
  info: 'bg-[var(--color-info-bg)] text-[var(--color-info)] border-[var(--color-info)]/25',
  positive:
    'bg-[var(--color-positive-bg)] text-[var(--color-positive)] border-[var(--color-positive)]/25',
  caution:
    'bg-[var(--color-caution-bg)] text-[var(--color-caution)] border-[var(--color-caution)]/25',
  muted: 'bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)]',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.ComponentProps<'span'> & { tone?: StatusTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}
