# 03 — Roles, Permissions & Authorization Model

## 1. Four roles, one exclusivity rule

| Role | Scope |
|---|---|
| `admin` | Full system access, including user management, permission grants, hard deletes, audit log reads, import execution. |
| `manager` | Manage candidates, marketing, activity, reports and review items across the organisation, bounded by granted permissions. |
| `recruiter` | Candidates currently assigned to them, and the marketing activity of those candidates. |
| `candidate` | Their own portal record set only. |

A user may hold multiple **internal** roles (`manager` + `recruiter` is a realistic
combination). The `candidate` role is mutually exclusive with all internal roles, enforced by
database trigger — a portal account must never be able to escalate laterally into internal
data by acquiring a second role.

## 2. Code checks capabilities, not roles

Application code and RLS policies check **permission codes**, never role names. Role names
appear in exactly two places: the `role_permissions` seed, and the admin UI that edits it.

Why: the brief says the manager acts "according to permissions." That phrasing implies the
boundary is expected to move. If forty call sites say `if (role === 'manager')`, moving the
boundary is a code change and a deploy; if they say `can('report.view_all')`, it is a seed
row. The one-time cost is a permission catalogue.

### Permission catalogue (proposed seed)

Codes are `<domain>.<action>`; `*_all` distinguishes org-wide from assignment-scoped.

| Domain | Codes |
|---|---|
| candidate | `candidate.view_assigned`, `candidate.view_all`, `candidate.create`, `candidate.update`, `candidate.archive`, `candidate.assign`, `candidate.invite_portal` |
| marketing | `marketing_period.view`, `marketing_period.manage`, `activity.log`, `activity.view_all` |
| application | `application.view`, `application.create`, `application.update`, `application.delete` |
| pipeline | `interview.manage`, `assessment.manage`, `rejection.manage`, `offer.manage`, `response.manage` |
| document | `document.view_internal`, `document.upload`, `document.delete`, `document.set_visibility` |
| report | `report.submit_own`, `report.view_own`, `report.view_all`, `report.lock` |
| review | `review.view`, `review.resolve`, `review.assign` |
| notification | `notification.broadcast` |
| admin | `user.manage`, `role.manage`, `permission.manage`, `audit.read`, `import.execute`, `organization.manage`, `unit.manage`, `unit.view_all` |

### Default matrix

| Permission group | admin | manager | recruiter | candidate |
|---|:--:|:--:|:--:|:--:|
| candidate.view_all | ✓ | ✓ | — | — |
| candidate.view_assigned | ✓ | ✓ | ✓ | — |
| candidate.create / update | ✓ | ✓ | update only¹ | — |
| candidate.assign | ✓ | ✓ | — | — |
| application.* | ✓ | ✓ | create/update on assigned | — |
| interview / assessment / offer / rejection manage | ✓ | ✓ | ✓ (assigned) | — |
| document.view_internal | ✓ | ✓ | ✓ (assigned) | — |
| document.set_visibility | ✓ | ✓ | — | — |
| report.view_all / lock | ✓ | ✓ | — | — |
| report.submit_own / view_own | ✓ | ✓ | ✓ | — |
| review.view / resolve | ✓ | ✓ | view only² | — |
| user.manage, role.manage, audit.read, import.execute | ✓ | — | — | — |
| unit.manage, unit.view_all | ✓ | — | — | — |
| portal.* (own records) | — | — | — | ✓ |

All rows above are scoped to the acting user's business unit. ¹ ² Marked cells are **[DECISION NEEDED]** — see doc 15, D-03. I have proposed the
conservative reading; widening either is a one-row change.

The `candidate` role holds no `public.*` permissions at all. Portal access is not a
permission grant, it is a distinct RLS path keyed on `candidates.user_id = auth.uid()`. This
is deliberate: it means a bug in the permission seed cannot accidentally grant a candidate
internal access, because internal reads require a permission the candidate role can never be
given.

## 3. Two scopes, not one

Permission answers *what kind of thing may I do*. Scope answers *to which rows*. Both are
required; either alone is a vulnerability.

```
allowed = has_permission(action)  AND  in_business_unit(record)  AND  in_scope(record)
```

The tenant gate is first and unconditional (decision D-13). No permission short of
`unit.view_all` crosses a business unit, including admin permissions.

Scope resolution for internal users:

| Role | Candidate scope |
|---|---|
| admin | all, and `unit.view_all` by default |
| manager | all candidates **within their business unit** (D-04 resolved: unit-wide, not team-scoped) |
| recruiter | candidates with an **active** row in `candidate_assignments` |

Recruiter scope is *current*, not historical: unassigning a recruiter removes their access
immediately, while the assignment row is retained for audit. This is why assignments are
append-only with `unassigned_at` rather than deleted.

## 4. Where authorization is evaluated

Three layers, each with a different job. None of them is optional.

| Layer | Mechanism | Job |
|---|---|---|
| Database | RLS policies + `SECURITY DEFINER` helpers | The real boundary. Assume everything above it is compromised. |
| Server | `requirePermission()` in every server action / route handler | Fail fast with a clear error; enforce action-level rules RLS cannot express (e.g. "cannot submit a locked report"). |
| UI | Capability-aware rendering | Ergonomics. Never a control. |

If the server layer were removed, the system would still be secure but would return confusing
empty results. If the database layer were removed, the system would be insecure. That
asymmetry is the whole point.

## 5. Claims and the JWT

Supabase issues the JWT. We attach the resolved role set and permission set with a **custom
access token hook** so that policies and server code can read them without a table lookup on
every request.

```sql
create or replace function util.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare claims jsonb; user_roles text[]; user_perms text[]; cand_id uuid;
begin
  select array_agg(role_code) into user_roles
    from public.user_roles where user_id = (event->>'user_id')::uuid;

  select array_agg(distinct rp.permission_code) into user_perms
    from public.role_permissions rp
    where rp.role_code = any(coalesce(user_roles, '{}'));

  select id into cand_id from public.candidates
    where user_id = (event->>'user_id')::uuid;

  claims := coalesce(event->'claims', '{}'::jsonb)
    || jsonb_build_object(
         'app_roles',       to_jsonb(coalesce(user_roles, '{}')),
         'app_permissions', to_jsonb(coalesce(user_perms, '{}')),
         'app_candidate_id', to_jsonb(cand_id)
       );
  return jsonb_set(event, '{claims}', claims);
end $$;
```

### The staleness rule

A JWT is a **cache**, and caches go stale. If an admin revokes a permission, the user's
existing token still carries it until refresh (default ~1 hour).

Therefore:

- **Read-side policies may use JWT claims** for cheap filtering.
- **Every destructive or privilege-sensitive action re-checks against the tables**, not the
  claim. `util.has_permission()` reads `role_permissions` directly.
- Revoking a role or suspending a user writes to a `session_invalidated_at` column on
  `public.users`; the server layer rejects any token issued before that timestamp, forcing a
  refresh.

Skipping this is the most common way JWT-claim authorization quietly becomes wrong. It costs
one column and one comparison.

## 6. Portal account provisioning

A candidate has no login until someone with `candidate.invite_portal` issues one. The flow:

1. Staff triggers invite on a candidate.
2. Server creates a Supabase Auth user (service role, server-only) with the candidate's
   primary email, or looks up an existing one.
3. `candidates.user_id` is set; `user_roles` gets `('candidate')`.
4. Supabase sends the invite/magic-link email.
5. The action is audited with both the actor and the target candidate.

Revocation sets `users.status = 'disabled'` and nulls nothing — the link is retained so
history stays intact, and RLS additionally requires `users.status = 'active'`.

Self-signup is disabled. There is no path from an anonymous visitor to any role.
