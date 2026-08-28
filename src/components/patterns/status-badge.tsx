import { Badge } from '@/components/ui/badge';
import { MARKETING_STATUS_META, type MarketingStatus } from '@/config/statuses';

/**
 * The single place a marketing status is rendered.
 *
 * Centralising this is a correctness measure, not a DRY preference: it is what
 * keeps status colour meaningful and stops two screens describing the same
 * state differently.
 */
export function MarketingStatusBadge({ status }: { status: MarketingStatus }) {
  const meta = MARKETING_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
