import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ASSIGNABLE_ROLES } from '@/config/permissions';
import {
  DAILY_REPORT_METRICS,
  REVIEW_ITEM_TYPES,
  REVIEW_ITEM_TYPE_META,
  REVIEW_ITEM_STATUS_META,
  REVIEW_RESOLUTION_META,
  USER_STATUSES,
} from '@/config/statuses';
import { DailyReportUpsertSchema, DailyReportConfirmSchema } from '@/server/modules/reports/schemas';
import { ReviewResolveSchema, ReviewCreateSchema } from '@/server/modules/review/schemas';
import { UserRoleGrantSchema, UserStatusSchema } from '@/server/modules/admin/schemas';
import { INTERNAL_NAV } from '@/config/navigation';

/**
 * Build 5 guarantees, asserted rather than described.
 *
 * The database suite (supabase/tests) proves the policies. These tests prove
 * the things that live in TypeScript and in the SQL text: that no code path
 * offers to accept a typed figure, that the review vocabulary stays neutral,
 * and that the escalation guards exist where the design says they do.
 */
const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
const allMigrations = migrationFiles
  .map((f) => readFileSync(resolve(migrationsDir, f), 'utf8'))
  .join('\n');

function sqlCodeOnly(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/comment on [\s\S]*?;/gi, '');
}

const migrationCode = sqlCodeOnly(allMigrations);

function sourceFiles(dir: string, ext = ['.ts', '.tsx']): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path, ext));
    else if (ext.some((e) => entry.name.endsWith(e))) out.push(path);
  }
  return out;
}

const appSources = sourceFiles('src').map((path) => ({
  path,
  text: readFileSync(resolve(process.cwd(), path), 'utf8'),
}));

/* =========================================================================
 * 1 — Report figures are derived, never entered
 * ========================================================================= */
describe('daily report figures cannot be typed in', () => {
  it('the report schema has no field for any of the five figures', () => {
    const shape = Object.keys(DailyReportUpsertSchema.shape);
    for (const metric of DAILY_REPORT_METRICS) {
      expect(shape).not.toContain(metric.key);
    }
    expect(shape.sort()).toEqual(['exceptions', 'notes', 'observations', 'reportDate']);
  });

  it('the confirm schema accepts judgement fields only', () => {
    const shape = Object.keys(DailyReportConfirmSchema.shape);
    expect(shape.sort()).toEqual(['exceptions', 'notes', 'observations', 'reportId']);
  });

  it('a figure supplied by a caller is stripped rather than stored', () => {
    const parsed = DailyReportUpsertSchema.parse({
      reportDate: '2026-08-31',
      notes: 'Busy day',
      applications: 80,
      snapshot_applications: 80,
    } as unknown);
    expect(parsed).not.toHaveProperty('applications');
    expect(parsed).not.toHaveProperty('snapshot_applications');
  });

  it('the snapshot columns are written only by confirm_daily_report', () => {
    // Anything else writing them would be a second, competing source of truth.
    const writers = migrationFiles.filter((file) => {
      const text = sqlCodeOnly(readFileSync(resolve(migrationsDir, file), 'utf8'));
      return /snapshot_applications\s*=/.test(text) || /set\s+snapshot_/.test(text);
    });
    expect(writers).toEqual(['0026_reports_review_functions.sql']);
  });

  it('the metrics function attributes a record by who created it and its own date', () => {
    const fn = readFileSync(
      resolve(migrationsDir, '0026_reports_review_functions.sql'),
      'utf8',
    );
    const body = sqlCodeOnly(fn);
    expect(body).toContain('created_by = p_recruiter_id');
    expect(body).toContain('application_date = p_report_date');
    expect(body).toContain('p_report_date');
  });

  it('every metric key the UI shows exists in the SQL result', () => {
    const fn = sqlCodeOnly(
      readFileSync(resolve(migrationsDir, '0026_reports_review_functions.sql'), 'utf8'),
    );
    const snakeCase = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    for (const metric of DAILY_REPORT_METRICS) {
      expect(fn).toContain(snakeCase(metric.key));
    }
  });

  it('no form control anywhere is named after a report figure', () => {
    const offenders: string[] = [];
    for (const { path, text } of appSources) {
      for (const metric of DAILY_REPORT_METRICS) {
        if (new RegExp(`name=["']${metric.key}["']`).test(text)) offenders.push(`${path}:${metric.key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* =========================================================================
 * 2 — Review queue language stays neutral
 * ========================================================================= */
describe('the review queue never accuses anyone', () => {
  const ACCUSATORY = [
    'fraud',
    'fraudulent',
    'false',
    'fake',
    'misconduct',
    'wrongdoing',
    'lying',
    'lied',
    'dishonest',
    'cheat',
    'suspicious',
    'violation',
    'guilty',
    'abuse',
  ];

  it('no item type, status or resolution label uses accusatory language', () => {
    const labels = [
      ...Object.values(REVIEW_ITEM_TYPE_META).map((m) => m.label),
      ...Object.values(REVIEW_ITEM_STATUS_META).map((m) => m.label),
      ...Object.values(REVIEW_RESOLUTION_META).map((m) => m.label),
    ].map((l) => l.toLowerCase());

    for (const label of labels) {
      for (const word of ACCUSATORY) {
        expect(label.includes(word), `"${label}" contains "${word}"`).toBe(false);
      }
    }
  });

  it('no generated reason string uses accusatory language', () => {
    const checks = sqlCodeOnly(
      readFileSync(resolve(migrationsDir, '0026_reports_review_functions.sql'), 'utf8'),
    ).toLowerCase();

    for (const word of ACCUSATORY) {
      expect(new RegExp(`'[^']*\\b${word}\\b[^']*'`).test(checks), `check reason mentions "${word}"`).toBe(
        false,
      );
    }
  });

  it('the item types in config match the database enum exactly', () => {
    const enumBlock = migrationCode.match(/create type review_item_type as enum \(([\s\S]*?)\)/);
    expect(enumBlock).not.toBeNull();
    const values = [...(enumBlock?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values.sort()).toEqual([...REVIEW_ITEM_TYPES].sort());
  });

  it('closing an item requires a written decision', () => {
    const result = ReviewResolveSchema.safeParse({
      reviewItemId: '00000000-0000-4000-8000-000000000001',
      status: 'dismissed',
      resolution: 'no_action_needed',
      resolutionNotes: '',
    });
    expect(result.success).toBe(false);
  });

  it('a manually raised item still has to say what to look at', () => {
    const result = ReviewCreateSchema.safeParse({
      itemType: 'missing_information',
      priority: 'normal',
      reason: '',
    });
    expect(result.success).toBe(false);
  });
});

/* =========================================================================
 * 3 — Role escalation is closed off
 * ========================================================================= */
describe('administration cannot escalate privilege', () => {
  it('the candidate role cannot be granted from the team screen', () => {
    expect([...ASSIGNABLE_ROLES]).not.toContain('candidate');
    expect(
      UserRoleGrantSchema.safeParse({
        userId: '00000000-0000-4000-8000-000000000001',
        role: 'candidate',
      }).success,
    ).toBe(false);
  });

  it('the database refuses an admin grant from a non-admin', () => {
    expect(migrationCode).toContain('tg_guard_admin_grant');
    expect(migrationCode).toMatch(/only an administrator can grant the administrator role/);
    expect(migrationCode).toContain('create trigger guard_admin_grant');
  });

  it('managers hold neither user.manage nor role.manage', () => {
    const grants = migrationCode.match(
      /insert into public\.role_permissions[\s\S]*?on conflict[^;]*;/g,
    );
    const managerGrants = (grants ?? [])
      .join('\n')
      .match(/\('manager',\s*'([a-z_.]+)'\)/g)
      ?.map((g) => g.replace(/.*'([a-z_.]+)'\)/, '$1'));

    expect(managerGrants).toBeDefined();
    expect(managerGrants).not.toContain('user.manage');
    expect(managerGrants).not.toContain('role.manage');
  });

  it('recruiters can see the review queue but not resolve items', () => {
    const grants = (
      migrationCode.match(/insert into public\.role_permissions[\s\S]*?on conflict[^;]*;/g) ?? []
    ).join('\n');
    expect(grants).toContain("('recruiter', 'review.view')");
    expect(grants).not.toContain("('recruiter', 'review.manage')");
    expect(grants).not.toContain("('recruiter', 'candidate.assign')");
  });

  it('a user cannot change their own account status', () => {
    expect(migrationCode).toContain('tg_guard_user_self_update');
    expect(migrationCode).toContain('create trigger guard_user_self_update');
    for (const column of ['status', 'business_unit_id', 'email', 'sessions_valid_from']) {
      expect(migrationCode).toContain(`new.${column} is distinct from old.${column}`);
    }
  });

  it('the status schema cannot be used to invent a new account state', () => {
    expect(
      UserStatusSchema.safeParse({
        userId: '00000000-0000-4000-8000-000000000001',
        status: 'superuser',
      }).success,
    ).toBe(false);
    expect([...USER_STATUSES]).toContain('suspended');
  });

  it('a candidate portal account cannot be named as an assignee', () => {
    expect(migrationCode).toContain('tg_guard_assignee_is_internal');
    expect(migrationCode).toContain('create trigger guard_assignee_is_internal');
  });
});

/* =========================================================================
 * 4 — Records are moved, never quietly overwritten
 * ========================================================================= */
describe('history survives every change', () => {
  it('reassignment runs as the caller, so it grants no extra authority', () => {
    const fn = readFileSync(
      resolve(migrationsDir, '0029_assignment_transfer.sql'),
      'utf8',
    );
    expect(fn).toContain('security invoker');
    expect(fn).not.toContain('security definer');
  });

  it('no migration ever deletes an assignment, report or review item', () => {
    const forbidden = /delete\s+from\s+public\.(candidate_assignments|daily_reports|review_items)/i;
    expect(forbidden.test(migrationCode)).toBe(false);
  });

  it('neither daily reports nor review items grant DELETE to authenticated', () => {
    const grants = migrationCode.match(/grant[^;]*;/gi) ?? [];
    for (const grant of grants) {
      if (/delete/i.test(grant)) {
        expect(grant).not.toMatch(/daily_reports|review_items/);
      }
    }
  });

  it('a confirmed report cannot be edited back into a draft', () => {
    const rls = readFileSync(
      resolve(migrationsDir, '0025_reports_review_rls.sql'),
      'utf8',
    );
    expect(sqlCodeOnly(rls)).toContain("status = 'draft'");
  });
});

/* =========================================================================
 * 5 — Reporting and review are internal only
 * ========================================================================= */
describe('candidates see none of this', () => {
  it('no policy on daily_reports or review_items mentions a candidate', () => {
    const rls = sqlCodeOnly(
      readFileSync(resolve(migrationsDir, '0025_reports_review_rls.sql'), 'utf8'),
    );
    expect(rls).not.toContain('own_candidate_id');
    expect(rls).not.toContain('candidates');
  });

  it('the portal module exposes no report or review query', () => {
    const portal = readFileSync(
      resolve(process.cwd(), 'src/server/modules/portal/queries.ts'),
      'utf8',
    );
    expect(portal).not.toContain('daily_reports');
    expect(portal).not.toContain('review_items');
  });

  it('no portal route imports a reporting, review or admin module', () => {
    const offenders = appSources
      .filter(({ path }) => path.includes('(portal)'))
      .filter(({ text }) => /@\/server\/modules\/(reports|review|admin)/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});

/* =========================================================================
 * 6 — Navigation and permissions agree
 * ========================================================================= */
describe('navigation matches the permission model', () => {
  it('every Build 5 entry is reachable and gated by a real permission', () => {
    const build5 = ['/reports/daily', '/review', '/reports', '/team'];
    for (const href of build5) {
      const item = INTERNAL_NAV.find((n) => n.href === href);
      expect(item, `${href} is missing from the navigation`).toBeDefined();
      expect(item?.status).toBe('ready');
      expect(item?.permission).toBeDefined();
      expect(PERMISSIONS).toContain(item?.permission);
    }
  });

  it('no navigation entry still claims to be planned for Build 5', () => {
    expect(INTERNAL_NAV.filter((n) => n.plannedIn === 'Build 5')).toEqual([]);
  });
});
