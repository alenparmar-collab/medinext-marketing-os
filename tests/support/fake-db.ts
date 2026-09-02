/**
 * A minimal in-memory stand-in for the Supabase client, enough to drive the
 * ingestion service.
 *
 * The alternative — mocking each call the service makes — would test that the
 * service calls the functions the test expects, which is not the same as
 * testing that it ingests correctly. This instead implements the small slice
 * of PostgREST semantics ingestion actually uses (eq filters, maybeSingle,
 * upsert with onConflict) so the real service runs unmodified and the
 * assertions are about the resulting rows.
 *
 * It deliberately enforces the unique constraints that matter, because
 * idempotency is a database guarantee and a fake that ignored it would make
 * the tests pass for the wrong reason.
 */
type Row = Record<string, unknown>;

const UNIQUE_KEYS: { table: string; columns: string[] }[] = [
  { table: 'email_messages', columns: ['mailbox_id', 'provider_message_id'] },
  { table: 'email_threads', columns: ['mailbox_id', 'provider_thread_id'] },
  { table: 'email_attachments', columns: ['message_id', 'provider_attachment_id'] },
  // The decision queue's idempotency guarantee. Modelled here for the same
  // reason as the others: a fake that let a duplicate decision through would
  // make the pipeline tests pass for the wrong reason.
  { table: 'intelligence_review_items', columns: ['business_unit_id', 'idempotency_key'] },
];

export class FakeDb {
  readonly tables = new Map<string, Row[]>();
  private sequence = 0;

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) {
      this.tables.set(
        table,
        rows.map((r) => ({ ...r })),
      );
    }
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table) as Row[];
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  /**
   * The database functions the services call.
   *
   * `claim_proposal` is modelled rather than stubbed, because the guarantee it
   * carries — exactly one claim per item — is the one the pipeline depends on.
   * A stub that always succeeded would make a double-approval test pass while
   * the real code raced. This cannot reproduce true concurrency (JavaScript is
   * single-threaded here, and the real proof is in
   * `scripts/db-concurrency-test.sh`); what it does reproduce is the LATCH: the
   * second claim of the same row returns null exactly as Postgres would.
   */
  async rpc(fn: string, args: Record<string, unknown>) {
    if (fn === 'claim_proposal' || fn === 'release_proposal_claim') {
      const row = this.rows('intelligence_review_items').find((r) => r.id === args.p_item_id);
      if (!row) return { data: null, error: null };

      if (fn === 'claim_proposal') {
        const claimable =
          (row.claimed_at ?? null) === null &&
          (row.status === 'open' || row.status === 'in_review');
        if (!claimable) return { data: null, error: null };
        row.status = 'in_review';
        row.claimed_at = new Date().toISOString();
        row.claimed_by = args.p_actor_id ?? 'fake-actor';
        return { data: row.id, error: null };
      }

      if (row.status !== 'in_review' || (row.claimed_at ?? null) === null) {
        return { data: null, error: null };
      }
      row.status = 'open';
      row.claimed_at = null;
      row.claimed_by = null;
      return { data: row.id, error: null };
    }

    return { data: null, error: null };
  }

  nextId(): string {
    this.sequence += 1;
    return `fake-id-${this.sequence}`;
  }

  uniqueKeyFor(table: string): string[] | null {
    return UNIQUE_KEYS.find((k) => k.table === table)?.columns ?? null;
  }
}

type Filter =
  | { kind: 'eq' | 'neq' | 'lte' | 'lt' | 'gte' | 'gt' | 'is' | 'ilike'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] }
  | { kind: 'notNull'; column: string }
  | { kind: 'or'; clauses: string }; 

class FakeQuery {
  private filters: Filter[] = [];
  private pending: { kind: 'insert' | 'upsert' | 'update'; payload: Row } | null = null;
  private ordering: { column: string; ascending: boolean }[] = [];
  private limitTo: number | null = null;
  private rangeFrom = 0;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  insert(payload: Row) {
    this.pending = { kind: 'insert', payload };
    return this;
  }

  upsert(payload: Row, _options?: { onConflict?: string }) {
    this.pending = { kind: 'upsert', payload };
    return this;
  }

  update(payload: Row) {
    this.pending = { kind: 'update', payload };
    return this;
  }

  select(_columns?: string) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: 'eq', column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ kind: 'neq', column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ kind: 'lte', column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ kind: 'gte', column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ kind: 'is', column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ kind: 'in', column, values });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ kind: 'lt', column, value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ kind: 'gt', column, value });
    return this;
  }

  ilike(column: string, pattern: unknown) {
    this.filters.push({ kind: 'ilike', column, value: pattern });
    return this;
  }

  /** Only the shape the services use: `.not(column, 'is', null)`. */
  not(column: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) this.filters.push({ kind: 'notNull', column });
    return this;
  }

  /**
   * PostgREST's `or` takes a comma-separated clause string. Modelled rather
   * than stubbed, because search correctness — matching the right rows and no
   * others — is exactly what the tests are checking.
   */
  or(clauses: string) {
    this.filters.push({ kind: 'or', clauses });
    return this;
  }

  /** Inclusive on both ends, as PostgREST's range is. */
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.limitTo = to - from + 1;
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.ordering.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number) {
    this.limitTo = count;
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      if (f.kind === 'or') return f.clauses.split(',').some((clause) => matchesClause(row, clause));
      const actual = row[f.column];
      switch (f.kind) {
        case 'eq':
          return actual === f.value;
        case 'neq':
          return actual !== f.value;
        case 'is':
          // PostgREST's `.is(column, null)` — an identity test, not equality.
          return f.value === null ? actual === null || actual === undefined : actual === f.value;
        case 'lte':
          return String(actual) <= String(f.value);
        case 'lt':
          return String(actual) < String(f.value);
        case 'gt':
          return String(actual) > String(f.value);
        case 'ilike':
          return matchesIlike(actual, String(f.value));
        case 'notNull':
          return actual !== null && actual !== undefined;
        case 'gte':
          return String(actual) >= String(f.value);
        case 'in':
          return f.values.includes(actual);
      }
    });
  }

  private applyOrderAndLimit(rows: Row[]): Row[] {
    let out = rows;
    for (const { column, ascending } of [...this.ordering].reverse()) {
      out = [...out].sort((a, b) => {
        const left = String(a[column] ?? '');
        const right = String(b[column] ?? '');
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    out = out.slice(this.rangeFrom);
    return this.limitTo === null ? out : out.slice(0, this.limitTo);
  }

  private run(): Row[] {
    const rows = this.db.rows(this.table);

    if (this.pending?.kind === 'update') {
      const updated: Row[] = [];
      for (const row of rows) {
        if (this.matches(row)) {
          Object.assign(row, this.pending.payload);
          updated.push(row);
        }
      }
      return updated;
    }

    if (this.pending) {
      const payload = { ...this.pending.payload };
      const uniqueColumns = this.db.uniqueKeyFor(this.table);

      if (uniqueColumns) {
        const existing = rows.find((row) =>
          uniqueColumns.every((column) => row[column] === payload[column]),
        );
        if (existing) {
          if (this.pending.kind === 'insert') {
            // Exactly what Postgres would do, and what the service must never
            // rely on not happening.
            throw Object.assign(new Error('duplicate key value violates unique constraint'), {
              code: '23505',
            });
          }
          Object.assign(existing, payload);
          return [existing];
        }
      }

      const created = { id: this.db.nextId(), ...payload };
      rows.push(created);
      return [created];
    }

    return this.applyOrderAndLimit(rows.filter((row) => this.matches(row)));
  }

  async maybeSingle() {
    try {
      const data = this.run();
      return { data: data[0] ?? null, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async single() {
    try {
      const data = this.run();
      if (!data[0]) return { data: null, error: new Error('no rows') };
      return { data: data[0], error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  /** Awaiting the builder with no terminal method, as fire-and-forget updates do. */
  then<T>(resolve: (value: { data: Row[] | null; error: unknown }) => T) {
    try {
      return Promise.resolve(resolve({ data: this.run(), error: null }));
    } catch (error) {
      return Promise.resolve(resolve({ data: null, error }));
    }
  }
}

/** `%term%` as PostgREST means it: case-insensitive, % is the wildcard. */
function matchesIlike(actual: unknown, pattern: string): boolean {
  if (actual === null || actual === undefined) return false;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(String(actual));
}

/**
 * One clause of an `or` string: `column.op.value`, including the arrow form
 * (`proposed_data->>company.ilike.%x%`) and `in.(a,b,c)`.
 */
function matchesClause(row: Row, clause: string): boolean {
  const inMatch = /^([^.]+)\.in\.\((.*)\)$/.exec(clause);
  if (inMatch) {
    const [, column, list] = inMatch;
    return list!.split(',').includes(String(row[column!]));
  }

  const parts = /^(.+?)\.(eq|ilike|like)\.(.*)$/.exec(clause);
  if (!parts) return false;
  const [, path, op, value] = parts;

  let actual: unknown;
  if (path!.includes('->>')) {
    const [column, key] = path!.split('->>');
    const json = row[column!] as Record<string, unknown> | undefined;
    actual = json?.[key!];
  } else {
    actual = row[path!];
  }

  if (op === 'eq') return String(actual) === value;
  return matchesIlike(actual, value!);
}
