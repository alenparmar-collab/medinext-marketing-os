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

  nextId(): string {
    this.sequence += 1;
    return `fake-id-${this.sequence}`;
  }

  uniqueKeyFor(table: string): string[] | null {
    return UNIQUE_KEYS.find((k) => k.table === table)?.columns ?? null;
  }
}

class FakeQuery {
  private filters: { column: string; value: unknown }[] = [];
  private pending: { kind: 'insert' | 'upsert' | 'update'; payload: Row } | null = null;

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
    this.filters.push({ column, value });
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => row[f.column] === f.value);
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

    return rows.filter((row) => this.matches(row));
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
