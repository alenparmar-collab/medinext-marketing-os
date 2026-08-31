import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES } from '@/config/permissions';
import { MARKETING_STATUSES, MARKETING_STATUS_META, ASSIGNMENT_TYPES } from '@/config/statuses';

/**
 * The TypeScript config and the SQL are two descriptions of one thing, and they
 * drift silently. RLS reads the database, so the database wins — these tests
 * exist so the drift fails the build instead of surfacing as a permission that
 * mysteriously does nothing.
 */
const sql = (file: string) =>
  readFileSync(resolve(process.cwd(), 'supabase', file), 'utf8');

/**
 * Strips `--` comments and COMMENT ON statements.
 *
 * Assertions about behaviour must read the code, not the prose around it —
 * otherwise a comment explaining that we never compare two columns trips the
 * test asserting we never compare them.
 */

/**
 * Permissions are seeded across several migrations as builds add domains, and a
 * hardcoded list here would silently go stale every time one is added — which
 * is exactly what happened. Read them all instead.
 */
function sqlCodeOnly(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/comment on [\s\S]*?;/gi, '');
}

const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
const referenceData = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(resolve(migrationsDir, f), 'utf8'))
  .join('\n');
const enums = sql('migrations/0002_enums.sql');

function seededPermissionCodes(): string[] {
  const codes = new Set<string>();
  // Each migration has its own `insert into public.permissions (...) values`
  // block, terminated by its `on conflict` clause.
  const pattern = /insert into public\.permissions[\s\S]*?on conflict/g;
  for (const block of referenceData.match(pattern) ?? []) {
    for (const match of block.matchAll(/\('([a-z_]+\.[a-z_]+)'/g)) {
      codes.add(match[1] as string);
    }
  }
  return [...codes];
}

describe('permission catalogue', () => {
  const seeded = seededPermissionCodes();

  it('finds the seeded permissions in the migrations', () => {
    expect(seeded.length).toBeGreaterThan(25);
  });

  it('declares every seeded permission in TypeScript', () => {
    const missing = seeded.filter((code) => !(PERMISSIONS as readonly string[]).includes(code));
    expect(missing).toEqual([]);
  });

  it('does not declare permissions the database has never heard of', () => {
    const extra = PERMISSIONS.filter((code) => !seeded.includes(code));
    expect(extra).toEqual([]);
  });
});

describe('roles', () => {
  it('matches the roles seeded in the migration', () => {
    for (const role of ROLES) {
      expect(referenceData).toContain(`('${role}',`);
    }
  });

  it('contains no sales role, in either place', () => {
    // sqlCodeOnly, because a comment stating that no sales role exists must not
    // itself trip the check. Assertions about behaviour read the code.
    expect(ROLES.some((r) => /sale/i.test(r))).toBe(false);
    expect(/sales(person)?/i.test(sqlCodeOnly(referenceData))).toBe(false);
  });

  it('grants the candidate role no permissions', () => {
    expect(referenceData).not.toMatch(/\('candidate',\s*'[a-z_]+\.[a-z_]+'\)/);
  });
});

describe('enums', () => {
  it('marketing statuses match the database enum exactly, and in order', () => {
    const block = enums.slice(
      enums.indexOf('create type marketing_status as enum'),
      enums.indexOf(');', enums.indexOf('create type marketing_status as enum')),
    );
    const values = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...MARKETING_STATUSES]);
  });

  it('assignment types match the database enum, with no sales value', () => {
    const block = enums.slice(
      enums.indexOf('create type assignment_type as enum'),
      enums.indexOf(');', enums.indexOf('create type assignment_type as enum')),
    );
    const values = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...ASSIGNMENT_TYPES]);
    expect(values.some((v) => /sale/i.test(v ?? ''))).toBe(false);
  });

  it('gives every marketing status a label and tone', () => {
    for (const status of MARKETING_STATUSES) {
      expect(MARKETING_STATUS_META[status]?.label).toBeTruthy();
      expect(MARKETING_STATUS_META[status]?.tone).toBeTruthy();
    }
  });
});

describe('product rules encoded in the schema', () => {
  const candidates = sql('migrations/0004_candidates.sql');

  it('never makes preferred_locations required', () => {
    const line = sqlCodeOnly(candidates)
      .split('\n')
      .find((l) => l.includes('preferred_locations') && l.includes('text[]'));
    expect(line).toBeTruthy();
    // A default of '{}' is fine; a NOT NULL check demanding content is not.
    expect(line).not.toMatch(/check\s*\(\s*array_length/i);
  });

  it('has no location-mismatch logic anywhere in the migrations', () => {
    const allSql = sqlCodeOnly(
      ['0004_candidates.sql', '0009_rls_policies.sql']
        .map((f) => sql(`migrations/${f}`))
        .join('\n'),
    );
    expect(allSql).not.toMatch(/mismatch/i);

    // The two columns must never appear in the same expression. Matching on a
    // single line is the precise test: their declarations sit on separate lines
    // of the CREATE TABLE, while any comparison between them would be one
    // expression on one line.
    const comparingLines = allSql
      .split('\n')
      .filter((l) => l.includes('preferred_locations') && l.includes('current_location'));
    expect(comparingLines).toEqual([]);
  });
});

describe('seed data hygiene', () => {
  const seedFiles = ['seed/02_demo_data.sql', 'seed/03_demo_applications.sql'];
  const allSeed = seedFiles.map(sql).join('\n');

  /**
   * PostgreSQL accepts any 32 hex digits as a uuid, but Zod's .uuid() enforces
   * RFC 4122 — version 1-8 and variant 8/9/a/b. A seed id that Postgres likes
   * and Zod rejects passes every database test and then fails the moment a real
   * form submits it, which is exactly how this was found.
   */
  it('uses only RFC 4122 valid UUIDs', () => {
    const ids = allSeed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
    expect(ids.length).toBeGreaterThan(20);

    const invalid = [...new Set(ids)].filter(
      (id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
    );
    expect(invalid).toEqual([]);
  });

  it('contains no real-looking contact details', () => {
    // Every demo address must sit on the reserved .test TLD.
    const emails = allSeed.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [];
    const offenders = emails.filter((e) => !e.toLowerCase().endsWith('.test'));
    expect(offenders).toEqual([]);
  });

  it('records no sales activity or roles', () => {
    expect(/sales(person)?/i.test(allSeed)).toBe(false);
  });
});
