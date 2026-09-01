import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApplicationCreateSchema } from '@/server/modules/applications/schemas';
import { InterviewCreateSchema } from '@/server/modules/interviews/schemas';
import { AssessmentCreateSchema } from '@/server/modules/assessments/schemas';
import { ActivityCreateSchema } from '@/server/modules/activities/schemas';

/**
 * Build 5.1 — ownership is not authorship.
 *
 * The database suite proves the trigger and the metrics. These prove the parts
 * that live in TypeScript: that no schema accepts an owner from the caller,
 * that no command writes one, and that the portal never carries the column.
 */
const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
const migration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8');

function sqlCodeOnly(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/comment on [\s\S]*?;/gi, '');
}

const allMigrations = sqlCodeOnly(migrationFiles.map(migration).join('\n'));
const attribution = migration('0030_responsible_recruiter.sql');
const attributionCode = sqlCodeOnly(attribution);

/**
 * The LAST migration to define the metrics function is the one that runs.
 * Asserting against 0030 would test a definition 0031 has already replaced —
 * which is how a test keeps passing while the shipped behaviour changes.
 */
const metricsMigration = migrationFiles
  .filter((f) => /function public\.daily_report_metrics/.test(migration(f)))
  .at(-1);

const metricsCode = sqlCodeOnly(migration(metricsMigration as string)).slice(
  sqlCodeOnly(migration(metricsMigration as string)).indexOf(
    'function public.daily_report_metrics',
  ),
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const appSources = sourceFiles('src').map((path) => ({
  path,
  text: readFileSync(resolve(process.cwd(), path), 'utf8'),
}));

/* =========================================================================
 * Ownership is never accepted from a caller
 * ========================================================================= */
describe('no schema accepts an owner', () => {
  const schemas = {
    application: ApplicationCreateSchema,
    interview: InterviewCreateSchema,
    assessment: AssessmentCreateSchema,
    activity: ActivityCreateSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`the ${name} create schema has no ownership field`, () => {
      // Some schemas are wrapped in .refine(), which hides .shape.
      const inner = (schema as unknown as { shape?: Record<string, unknown> }).shape
        ? schema
        : ((schema as unknown as { _def: { schema: { shape: Record<string, unknown> } } })._def
            .schema ?? schema);
      const keys = Object.keys(
        (inner as unknown as { shape: Record<string, unknown> }).shape ?? {},
      );
      expect(keys.length).toBeGreaterThan(0);
      for (const forbidden of [
        'responsibleRecruiterId',
        'responsible_recruiter_id',
        'ownerId',
        'createdBy',
        'created_by',
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    });
  }

  it('a supplied owner is stripped before the command sees it', () => {
    const parsed = ApplicationCreateSchema.parse({
      candidateId: '00000000-0000-4000-8000-000000000001',
      businessUnitId: '00000000-0000-4000-9000-000000000001',
      companyName: 'Somewhere Ltd',
      positionTitle: 'Data Manager',
      applicationDate: '2026-08-31',
      status: 'submitted',
      responsibleRecruiterId: '00000000-0000-4000-8000-000000000004',
    } as unknown);
    expect(parsed).not.toHaveProperty('responsibleRecruiterId');
  });

  it('no command or action writes the ownership column', () => {
    const writers = appSources
      .filter(({ path }) => path.includes('/server/') || path.includes('/actions'))
      .filter(({ text }) => /responsible_recruiter_id\s*:/.test(text))
      .map(({ path }) => path);
    expect(writers).toEqual([]);
  });

  it('no form control anywhere is named after the ownership column', () => {
    const offenders = appSources
      .filter(({ text }) =>
        /name=["'](responsibleRecruiterId|responsible_recruiter_id|ownerId)["']/.test(text),
      )
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

/* =========================================================================
 * The database derives it, and refuses to be told
 * ========================================================================= */
describe('ownership is derived server-side', () => {
  it('the insert path overwrites whatever arrived', () => {
    // Assignment, not coalesce: coalescing would trust a supplied value.
    expect(attributionCode).toMatch(
      /new\.responsible_recruiter_id\s*:=\s*util\.responsible_recruiter\(/,
    );
    expect(attributionCode).not.toMatch(
      /new\.responsible_recruiter_id\s*:=\s*coalesce\(\s*new\.responsible_recruiter_id/,
    );
  });

  it('changing it later needs the assignment capability', () => {
    expect(attributionCode).toContain("util.has_permission('candidate.assign')");
    expect(attributionCode).toContain('42501');
  });

  it('every event table carries the trigger', () => {
    for (const table of [
      'public.applications',
      'public.marketing_activities',
      'public.interviews',
      'public.assessments',
    ]) {
      expect(attributionCode).toContain(`before insert or update on ${table}`);
    }
  });

  it('the derivation reads the assignment history, not created_by', () => {
    const fn = attributionCode.slice(
      attributionCode.indexOf('function util.responsible_recruiter'),
      attributionCode.indexOf('alter table public.applications'),
    );
    expect(fn).toContain('public.candidate_assignments');
    expect(fn).toContain("assignment_type = 'primary_recruiter'");
    expect(fn).not.toContain('created_by');
  });

  it('the backfill leaves unattributable rows null rather than guessing', () => {
    const backfill = attributionCode.slice(attributionCode.indexOf('update public.applications a'));
    expect(backfill).toContain('util.responsible_recruiter(');
    // Attributing to the creator is the exact conflation being removed.
    expect(backfill).not.toMatch(/set responsible_recruiter_id\s*=\s*[a-z]\.created_by/);
  });
});

/* =========================================================================
 * The report follows responsibility
 * ========================================================================= */
describe('daily report attribution', () => {
  const metrics = metricsCode;

  it('the active definition is the last one declared', () => {
    expect(metricsMigration).toBe('0031_report_metrics_completeness.sql');
  });

  it('every figure is counted by responsible recruiter', () => {
    const matches = metrics.match(/responsible_recruiter_id = p_recruiter_id/g) ?? [];
    expect(matches.length).toBe(5);
  });

  it('no figure is counted by who created the record', () => {
    expect(metrics).not.toContain('created_by = p_recruiter_id');
  });

  it('the rewritten function is still the only writer of a snapshot column', () => {
    const writers = migrationFiles.filter((file) => {
      const text = sqlCodeOnly(migration(file));
      return /snapshot_applications\s*=/.test(text) || /set\s+snapshot_/.test(text);
    });
    expect(writers).toEqual(['0026_reports_review_functions.sql']);
  });

  it('a recruiter reading their own figures is never blocked by a later handover', () => {
    // SECURITY INVOKER filters the counts by the caller's current candidate
    // access, so work done before a handover would vanish from its own report.
    expect(metrics).toContain('security definer');
    expect(metrics).toContain('v_caller <> p_recruiter_id');
  });

  it('reading somebody else needs report.view_all inside the same unit', () => {
    expect(metrics).toContain("util.has_permission('report.view_all')");
    expect(metrics).toContain('util.in_business_unit');
    expect(metrics).toContain('42501');
  });

  it('the metrics function reads and never writes', () => {
    expect(metrics).toContain('stable');
    for (const write of ['insert into', 'update public', 'delete from']) {
      expect(metrics.toLowerCase()).not.toContain(write);
    }
  });
});

/* =========================================================================
 * Provenance is untouched, and stays separate
 * ========================================================================= */
describe('provenance survives intact', () => {
  it('the migration never writes created_by, source_type or source_reference', () => {
    expect(attributionCode).not.toMatch(/set\s+created_by\s*=/);
    expect(attributionCode).not.toMatch(/set\s+source_type\s*=/);
    expect(attributionCode).not.toMatch(/set\s+source_reference\s*=/);
  });

  it('the audit trigger still records the actor, not the owner', () => {
    const audit = sqlCodeOnly(migration('0007_audit.sql'));
    expect(audit).toContain('actor_id');
    expect(audit).not.toContain('responsible_recruiter');
  });

  it('the source vocabulary can express a system and an email origin', () => {
    const enums = sqlCodeOnly(migration('0002_enums.sql'));
    expect(enums).toContain("'system'");
    expect(enums).toContain("'email_event'");
  });

  /**
   * This began as "nothing in this build implements email or AI".
   *
   * Build 6 implements email deliberately, so the email half is now scoped to
   * the attribution work it was actually about: the ownership model must not
   * have grown a mailbox dependency. The AI half stays global and unchanged,
   * because no build so far has an interpretation layer and the assertion is
   * what keeps it that way.
   */
  it('the attribution work implements no email or AI integration', () => {
    const forbidden = /imap|smtp\b|mailbox|openai|anthropic|huggingface|hugging_face|embedding/i;
    expect(forbidden.test(attribution)).toBe(false);

    const attributionFiles = appSources.filter(
      ({ path }) =>
        path.includes('/reports/') ||
        path.includes('/assignments/') ||
        path.endsWith('patterns/attribution.tsx'),
    );
    expect(attributionFiles.length).toBeGreaterThan(0);
    expect(attributionFiles.filter(({ text }) => forbidden.test(text)).map(({ path }) => path)).toEqual(
      [],
    );
  });

  /**
   * This began as "no model or AI integration exists anywhere".
   *
   * Build 7A adds one deliberately, so the assertion becomes the containment
   * claim that still holds and is worth keeping: model integration lives in
   * the intelligence module and nowhere else. It would fail the moment
   * somebody wired a provider into the applications module or a page.
   */
  it('model integration is confined to the intelligence module', () => {
    // Tests for INTEGRATION, not for the word: 'openai' legitimately appears
    // in the provider vocabulary in config/statuses.ts, which calls nothing.
    const forbidden =
      /api\.openai\.com|api\.anthropic\.com|huggingface\.co|from ['"](openai|@anthropic-ai|langchain)|process\.env\.(OPENAI|ANTHROPIC|HUGGINGFACE)/i;
    const offenders = appSources
      .filter(({ path }) => !path.startsWith('src/server/modules/intelligence/'))
      .filter(({ text }) => forbidden.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('no CRM module has a model dependency', () => {
    const crm = /\/server\/modules\/(applications|interviews|assessments|activities|candidates|notifications|review|reports|assignments|notes)\//;
    const forbidden = /openai|anthropic|huggingface|langchain|intelligence/i;
    const offenders = appSources
      .filter(({ path }) => crm.test(`/${path}`))
      .filter(({ text }) => forbidden.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

/* =========================================================================
 * The portal never learns who works the file
 * ========================================================================= */
describe('ownership stays internal', () => {
  it('no portal query selects the ownership column', () => {
    const portal = readFileSync(
      resolve(process.cwd(), 'src/server/modules/portal/queries.ts'),
      'utf8',
    );
    expect(portal).not.toContain('responsible_recruiter');
  });

  it('no portal route renders it', () => {
    const offenders = appSources
      .filter(({ path }) => path.includes('(portal)'))
      .filter(({ text }) => /responsibleRecruiter/i.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('no query anywhere selects columns with a wildcard', () => {
    // A wildcard select is how an internal-only column reaches a portal DTO by
    // accident.
    const offenders = appSources
      .filter(({ text }) => /\.select\(\s*['"`]\s*\*\s*['"`]\s*\)/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

/* =========================================================================
 * Performance
 * ========================================================================= */
describe('attribution is indexed', () => {
  it('each event table has a composite index for "this recruiter, this day"', () => {
    for (const index of [
      'applications_responsible_idx',
      'marketing_activities_responsible_idx',
      'interviews_responsible_idx',
      'assessments_responsible_idx',
    ]) {
      expect(attributionCode).toContain(index);
    }
  });

  it('the date predicates are ranges, so the indexes can be used', () => {
    expect(metricsCode).toContain('day_start');
    expect(metricsCode).toContain('day_end');
    // The old per-row cast is not sargable and is gone from the counts.
    expect(metricsCode).not.toContain("(m.activity_date at time zone 'UTC')::date");
  });

  it('the ownership column is not duplicated onto tables that do not need it', () => {
    const added = [...allMigrations.matchAll(/add column responsible_recruiter_id/g)];
    expect(added.length).toBe(4);
    expect(allMigrations).not.toContain('daily_reports\n  add column responsible_recruiter_id');
  });
});
