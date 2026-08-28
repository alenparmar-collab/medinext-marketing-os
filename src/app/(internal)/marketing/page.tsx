import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal } from '@/server/auth/actor';
import { createServerSupabase } from '@/lib/supabase/server';
import { PageHeader } from '@/components/patterns/page-header';
import { MarketingStatusBadge } from '@/components/patterns/status-badge';
import { EmptyState } from '@/components/patterns/states';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/utils/format';
import type { MarketingStatus } from '@/config/statuses';

export const metadata: Metadata = { title: 'Marketing' };

export default async function MarketingPage() {
  await requireInternal();
  const supabase = await createServerSupabase();

  const { data: periods } = await supabase
    .from('marketing_periods')
    .select('id, candidate_id, starts_on, ends_on, status, objective')
    .order('starts_on', { ascending: false })
    .limit(100);

  const candidateIds = [...new Set((periods ?? []).map((p) => p.candidate_id))];
  const namesById = new Map<string, { name: string; reference: string }>();

  if (candidateIds.length > 0) {
    const { data: candidates } = await supabase
      .from('candidates')
      .select('id, full_name, reference')
      .in('id', candidateIds);
    for (const c of candidates ?? []) {
      namesById.set(c.id, { name: c.full_name, reference: c.reference });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Marketing"
        description="Marketing periods across the candidates you can access. A period is the window during which a candidate is actively marketed."
      />

      {!periods || periods.length === 0 ? (
        <EmptyState
          title="No marketing periods"
          body="Once a candidate is being marketed, their period appears here with its dates and status."
        />
      ) : (
        <TableWrap>
          <Table>
            <caption className="sr-only">Marketing periods</caption>
            <thead>
              <tr>
                <Th scope="col">Candidate</Th>
                <Th scope="col">Started</Th>
                <Th scope="col">Ended</Th>
                <Th scope="col">Status</Th>
                <Th scope="col">Objective</Th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const candidate = namesById.get(p.candidate_id);
                return (
                  <Tr key={p.id}>
                    <Td>
                      {candidate ? (
                        <Link
                          href={`/candidates/${p.candidate_id}`}
                          className="font-medium text-[var(--text-primary)] hover:text-[var(--color-accent-600)] hover:underline"
                        >
                          {candidate.name}
                        </Link>
                      ) : (
                        <span className="text-[var(--text-muted)]">Unknown</span>
                      )}
                      {candidate ? (
                        <span className="block font-mono text-[12px] text-[var(--text-muted)]">
                          {candidate.reference}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="tabular text-[var(--text-secondary)]">
                      {formatDate(p.starts_on)}
                    </Td>
                    <Td className="tabular text-[var(--text-secondary)]">
                      {p.ends_on ? formatDate(p.ends_on) : '—'}
                    </Td>
                    <Td>
                      <MarketingStatusBadge status={p.status as MarketingStatus} />
                    </Td>
                    <Td className="max-w-[36ch] truncate text-[var(--text-secondary)]">
                      {p.objective ?? '—'}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
