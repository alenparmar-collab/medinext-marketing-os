import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { withServiceRole } from '@/server/privileged/service-client';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import { createApplication } from '@/server/modules/applications/commands';
import { createInterview } from '@/server/modules/interviews/commands';
import { createAssessment } from '@/server/modules/assessments/commands';
import { changeApplicationStatus } from '@/server/modules/applications/commands';
import type { CommandProvenance } from '@/server/modules/provenance';
import type { IntelligenceEventType } from '@/config/statuses';
import { decide, type DecisionInput } from './engine';
import type { Decision } from './engine';

/**
 * Proposal → decision → CRM record.
 *
 * The three rules this file exists to hold:
 *
 *   1. AI PROPOSES, THE SERVER DECIDES. `decide()` is pure and deterministic;
 *      nothing the model returned reaches a write without passing it.
 *
 *   2. EXISTING COMMANDS PERFORM THE WRITE. Not one insert here. The same
 *      createInterview a recruiter's form calls, with the same validation, the
 *      same RLS, the same triggers that write history, activities and
 *      notifications. Automated records are ordinary records with honest
 *      provenance, not a parallel species.
 *
 *   3. AUTOMATION HAS NO AUTHORITY OF ITS OWN. Every write runs as the person
 *      who asked for it, through their RLS-scoped client. There is no service
 *      role in the mutation path — if they could not create the record by
 *      hand, it is not created for them, and the decision engine says so
 *      before anything is attempted.
 */

export interface EvaluateResult {
  reviewItemId: string;
  outcome: Decision['outcome'];
  status: string;
  reasonCodes: string[];
  explanation: string;
  createdRecordId: string | null;
  createdRecordKind: 'application' | 'interview' | 'assessment' | 'rejection' | null;
}

/**
 * Evaluates one completed interpretation and records the decision.
 *
 * Idempotent by construction: the decision row is keyed on
 * (business unit, email, event type), so a redelivered email, a second reading
 * and a retried request all converge on the same row rather than on a second
 * interview.
 */
export async function evaluateIntelligenceRun(
  runId: string,
  actor: ActorContext,
): Promise<EvaluateResult> {
  const supabase = await createServerSupabase();

  const { data: run, error } = await supabase
    .from('email_intelligence_runs')
    .select(
      'id, business_unit_id, email_message_id, status, event_type, event_confidence, proposed_candidate_id, candidate_match_confidence, extracted_data',
    )
    .eq('id', runId)
    .maybeSingle();

  if (error) throw error;
  if (!run) throw new AppError('NOT_FOUND', 'Interpretation not found, or not permitted.');

  // Only a finished, validated reading is worth deciding on. A failed run has
  // no conclusion and a pending one has not produced anything yet.
  if (run.status !== 'completed' && run.status !== 'review_required') {
    throw new AppError(
      'PRECONDITION_FAILED',
      'This reading has not produced a conclusion to decide on.',
    );
  }

  // The database constraint guarantees a completed reading carries a
  // classification, but narrowing it here means the pipeline does not depend on
  // that being true — a run with no conclusion has nothing to decide.
  if (!run.event_type) {
    throw new AppError('PRECONDITION_FAILED', 'This reading has no classification to act on.');
  }
  const eventType = run.event_type;

  const input = await gatherFacts(supabase, { ...run, event_type: eventType }, actor);
  const decision = decide(input);

  // The key is the email, the event type, AND the fingerprint of what this
  // reading proposes to do.
  //
  // Build 7B keyed on (email, event type) alone, which made every re-reading of
  // an email idempotent — including one that had changed its mind. That is the
  // right answer for a redelivery and the wrong one for a correction: a second
  // reading that moves the interview to another day would have collapsed onto
  // the first row and vanished. Adding the fingerprint keeps the redelivery
  // idempotent (same material proposal, same key) while letting a genuinely
  // different reading land as its own decision — which `decide()` has already
  // forced to review, never to a second automatic write.
  const idempotencyKey = `${run.email_message_id}:${eventType}:${decision.fingerprint}`;

  // The decision row is written under the service role because deciding is the
  // engine's act, not the user's: a person who could insert one could invent
  // an approval for a record to hang from. The MUTATION below is not — it runs
  // as the user, through their own client.
  const item = await withServiceRole(
    actor,
    `Record decision for interpretation ${runId} (${decision.outcome})`,
    async (db) => {
      const { data: existing } = await db
        .from('intelligence_review_items')
        .select('id, status, created_application_id, created_interview_id, created_assessment_id')
        .eq('business_unit_id', run.business_unit_id)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) return { ...existing, isNew: false };

      const { data: created, error: insertError } = await db
        .from('intelligence_review_items')
        .insert({
          business_unit_id: run.business_unit_id,
          intelligence_run_id: run.id,
          email_message_id: run.email_message_id,
          event_type: eventType,
          outcome: decision.outcome,
          status: decision.outcome === 'ignore' ? 'ignored' : 'open',
          priority: decision.priority,
          reason_codes: decision.reasonCodes,
          explanation: decision.explanation,
          proposed_candidate_id: run.proposed_candidate_id,
          proposed_data: decision.proposedData,
          candidate_match_confidence: run.candidate_match_confidence,
          event_confidence: run.event_confidence,
          idempotency_key: idempotencyKey,
          proposal_fingerprint: decision.fingerprint,
          // What this reading disagrees with, if anything. Stored on the row so
          // the queue can show it without recomputing a decision.
          supersedes_item_id: decision.interpretationChange?.previousItemId ?? null,
          superseded_fingerprint: decision.interpretationChange?.previousFingerprint ?? null,
          superseded_record_id: decision.interpretationChange?.existingRecordId ?? null,
          superseded_record_kind: decision.interpretationChange?.existingRecordKind ?? null,
          changed_fields: decision.interpretationChange?.changedFields ?? [],
          ...(decision.outcome === 'ignore'
            ? { reviewed_at: new Date().toISOString() }
            : {}),
          // An automatic approval claims itself in the same insert: the row is
          // never claimable by anyone else, and the database's "an approval must
          // have been claimed" rule holds for automation too.
          ...(decision.outcome === 'auto_approve'
            ? { claimed_by: actor.userId, claimed_at: new Date().toISOString() }
            : {}),
        })
        .select('id, status, created_application_id, created_interview_id, created_assessment_id')
        .single();

      if (insertError || !created) {
        throw insertError ?? new Error('The decision could not be recorded.');
      }
      return { ...created, isNew: true };
    },
  );

  // An existing decision is left exactly as it is. This is what stops a
  // reprocess from re-approving something that was already rejected.
  if (!item.isNew) {
    return {
      reviewItemId: item.id,
      outcome: decision.outcome,
      status: item.status,
      reasonCodes: decision.reasonCodes,
      explanation: 'A decision for this email and this exact proposal already exists.',
      createdRecordId:
        item.created_application_id ?? item.created_interview_id ?? item.created_assessment_id,
      createdRecordKind: null,
    };
  }

  if (decision.outcome !== 'auto_approve') {
    return {
      reviewItemId: item.id,
      outcome: decision.outcome,
      status: decision.outcome === 'ignore' ? 'ignored' : 'open',
      reasonCodes: decision.reasonCodes,
      explanation: decision.explanation,
      createdRecordId: null,
      createdRecordKind: null,
    };
  }

  // ---- Auto-approval: the write, as the user ------------------------------
  const written = await performCrmWrite(
    { ...run, event_type: eventType },
    decision.proposedData,
    actor,
    {
      sourceType: 'email_event',
      sourceReference: `intelligence:${run.id}`,
      // Nobody looked at it. The record exists and counts; it is not verified,
      // and every screen that shows provenance says so.
      verified: false,
    },
  );

  // The same bookkeeping a human approval does, minus the reviewer. `outcome`
  // is already auto_approve on the row, which is what tells every screen — and
  // the daily report — that nobody looked at this.
  await markApproved(
    item.id,
    written,
    { reviewed_at: new Date().toISOString(), final_data: decision.proposedData },
    actor,
    { runId: run.id },
  );

  return {
    reviewItemId: item.id,
    outcome: 'auto_approve',
    status: 'approved',
    reasonCodes: [],
    explanation: decision.explanation,
    createdRecordId: written.recordId,
    createdRecordKind: written.kind,
  };
}

/**
 * Marks a decided item approved and names the record it produced.
 *
 * Called after the CRM write, never before — an item marked approved that
 * produced nothing is the failure least likely to be noticed, the screen having
 * already said it worked. The database enforces the same thing from the other
 * side: an approved item must name its record.
 *
 * There is no transaction spanning both writes, because the CRM write goes
 * through the ordinary command as the user and this one goes through the
 * service role. So the gap is handled rather than hidden: one retry, and if
 * that fails too the caller is told WHAT WAS CREATED, by id, instead of being
 * told the approval failed. The record is real — it is in the timeline, the
 * notifications and the daily report — and a reviewer who believes nothing
 * happened is the person most likely to create it a second time.
 */
async function markApproved(
  itemId: string,
  written: { recordId: string; kind: 'application' | 'interview' | 'assessment' | 'rejection' },
  patch: Record<string, unknown>,
  actor: ActorContext,
  context: { runId: string },
): Promise<void> {
  const write = async () =>
    withServiceRole(actor, `Record approval of proposal ${itemId}`, async (db) => {
      const { error } = await db
        .from('intelligence_review_items')
        .update({
          status: 'approved',
          ...patch,
          ...(written.kind === 'application' ? { created_application_id: written.recordId } : {}),
          ...(written.kind === 'interview' ? { created_interview_id: written.recordId } : {}),
          ...(written.kind === 'assessment' ? { created_assessment_id: written.recordId } : {}),
        })
        .eq('id', itemId);

      if (error) throw error;
    });

  try {
    await write();
  } catch {
    try {
      await write();
    } catch {
      throw new AppError(
        'PARTIAL_FAILURE',
        `The ${written.kind} was created (${written.recordId}), but this proposal could not ` +
          'be marked approved. The record stands; do not approve this proposal again — ' +
          'ask an administrator to close it.',
        undefined,
        // Everything needed to close this out by hand, so nobody has to infer
        // what happened from a timestamp. The claim is deliberately NOT
        // released: the item stays claimed precisely so a retry cannot walk
        // back through the CRM write and create the record twice.
        {
          reviewItemId: itemId,
          intelligenceRunId: context.runId,
          createdRecordKind: written.kind,
          createdRecordId: written.recordId,
          failure: 'the approval could not be recorded after the record was created',
        },
      );
    }
  }
}

export interface ApproveInput {
  reviewItemId: string;
  /** Fields the reviewer corrected. Merged over the proposal; never written into it. */
  corrections?: Record<string, unknown>;
  notes?: string | null;
}

/**
 * A human approval.
 *
 * The CRM write happens FIRST, as the reviewer. Only if it succeeds is the
 * item marked approved — because an item marked approved that produced nothing
 * is the failure least likely to be noticed, the screen having already said it
 * worked. The database enforces the same thing from the other side: an
 * approved item must name the record it created.
 */
export async function approveProposal(
  input: ApproveInput,
  actor: ActorContext,
): Promise<EvaluateResult> {
  const supabase = await createServerSupabase();

  const { data: item, error } = await supabase
    .from('intelligence_review_items')
    .select(
      'id, business_unit_id, intelligence_run_id, email_message_id, event_type, status, proposed_candidate_id, proposed_data',
    )
    .eq('id', input.reviewItemId)
    .maybeSingle();

  if (error) throw error;
  if (!item) throw new AppError('NOT_FOUND', 'Proposal not found, or not permitted.');

  // Double-click, retried request, two reviewers on the same item: whichever
  // arrives second finds it decided and stops.
  //
  // This read-then-check is a courtesy, not the protection — between the SELECT
  // above and the write below, another request can do the same thing. The
  // protection is the claim on the next line, which is one atomic UPDATE.
  if (item.status === 'approved') {
    throw new AppError('CONFLICT', 'This proposal has already been approved.');
  }
  if (item.status === 'rejected' || item.status === 'ignored') {
    throw new AppError('CONFLICT', `This proposal was already ${item.status}.`);
  }

  // ---- The claim ----------------------------------------------------------
  //
  // ONE REVIEW ITEM → ONE CRM ACTION, enforced by the database rather than by
  // this process being careful.
  //
  // `claim_proposal` is a single `update ... where claimed_at is null`. Under
  // READ COMMITTED, concurrent updates to the same row serialise and the loser
  // re-evaluates that predicate against the winner's committed row, so it
  // matches nothing and returns null. Twelve simultaneous approvals therefore
  // produce exactly one claim, and only the holder of the claim reaches the CRM
  // write below. Two tabs, two reviewers, a double-click, a retried request and
  // a retried worker are all the same case.
  //
  // It runs through the caller's own client, so the queue policy still decides
  // who may claim at all; the CRM permission is checked separately, below and
  // in the database, because claiming is not approving.
  const { data: claimedId, error: claimError } = await supabase.rpc('claim_proposal', {
    p_item_id: input.reviewItemId,
  });
  if (claimError) throw claimError;
  if (!claimedId) {
    throw new AppError(
      'CONFLICT',
      'Someone else is already acting on this proposal, or it has already been decided.',
    );
  }

  const finalData = { ...item.proposed_data, ...(input.corrections ?? {}) };

  const written = await performCrmWriteOrRelease(
    input.reviewItemId,
    {
      id: item.intelligence_run_id,
      business_unit_id: item.business_unit_id,
      email_message_id: item.email_message_id,
      event_type: item.event_type,
      proposed_candidate_id: item.proposed_candidate_id,
    },
    finalData,
    actor,
    {
      sourceType: 'email_event',
      sourceReference: `intelligence:${item.intelligence_run_id}`,
      // A person read it and said yes, which is what verification has always
      // meant in this codebase.
      verified: true,
    },
  );

  await markApproved(
    item.id,
    written,
    {
      reviewed_by: actor.userId,
      reviewed_at: new Date().toISOString(),
      decision_notes: input.notes ?? null,
      // The proposal is never overwritten. Three values stay legible: what the
      // model said, what the person changed, what was written.
      corrected_data:
        input.corrections && Object.keys(input.corrections).length > 0
          ? input.corrections
          : null,
      final_data: finalData,
    },
    actor,
    { runId: item.intelligence_run_id },
  );

  return {
    reviewItemId: item.id,
    outcome: 'auto_approve',
    status: 'approved',
    reasonCodes: [],
    explanation: 'Approved by a reviewer.',
    createdRecordId: written.recordId,
    createdRecordKind: written.kind,
  };
}

/**
 * The CRM write, with the claim released if it fails.
 *
 * A claim that is never released is a proposal nobody can ever act on: the
 * queue would show it open, every approval would be refused as already claimed,
 * and the only recovery would be a database edit. So a failed write hands the
 * item back — status `open`, claim cleared — and the reviewer can try again
 * once whatever failed is fixed.
 *
 * Releasing is deliberately narrow: it only ever moves an item BACKWARDS to
 * open, and only one this request itself claimed. It can never turn a decided
 * item back into an undecided one.
 */
async function performCrmWriteOrRelease(
  reviewItemId: string,
  run: {
    id: string;
    business_unit_id: string;
    email_message_id: string;
    event_type: string;
    proposed_candidate_id: string | null;
  },
  data: Record<string, unknown>,
  actor: ActorContext,
  provenance: CommandProvenance,
): Promise<{ recordId: string; kind: 'application' | 'interview' | 'assessment' | 'rejection' }> {
  try {
    return await performCrmWrite(run, data, actor, provenance);
  } catch (error) {
    const supabase = await createServerSupabase();
    // Best effort: if the release itself fails the original error is still the
    // one worth reporting, and the item stays claimed rather than being lost.
    await supabase.rpc('release_proposal_claim', { p_item_id: reviewItemId });
    throw error;
  }
}

/**
 * Performs the CRM write through the EXISTING command for that record type.
 *
 * Not one insert in this function. Every branch calls the command a recruiter's
 * form calls, as the acting user, so the write goes through the same
 * validation, the same policies and the same triggers — which is how an
 * interview created from an email ends up in the timeline, the notifications
 * and the daily report without any of those knowing this pipeline exists.
 */
async function performCrmWrite(
  run: {
    id: string;
    business_unit_id: string;
    email_message_id: string;
    event_type: string;
    proposed_candidate_id: string | null;
  },
  data: Record<string, unknown>,
  actor: ActorContext,
  provenance: CommandProvenance,
): Promise<{ recordId: string; kind: 'application' | 'interview' | 'assessment' | 'rejection' }> {
  const str = (key: string): string | null => {
    const value = data[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };

  if (run.event_type === 'application') {
    if (!run.proposed_candidate_id) {
      throw new AppError('PRECONDITION_FAILED', 'No candidate is proposed for this application.');
    }
    const company = str('company');
    const jobTitle = str('job_title');
    if (!company || !jobTitle) {
      throw new AppError('PRECONDITION_FAILED', 'The company and job title are both required.');
    }

    const created = await createApplication(
      {
        candidateId: run.proposed_candidate_id,
        companyName: company,
        positionTitle: jobTitle,
        applicationDate: str('application_date') ?? new Date().toISOString().slice(0, 10),
        status: 'submitted',
        jobId: str('external_reference'),
        jobUrl: null,
        jobLocation: null,
        notes: null,
        marketingPeriodId: null,
      },
      actor,
      provenance,
    );
    return { recordId: created.id, kind: 'application' };
  }

  if (run.event_type === 'interview') {
    const applicationId = str('application_id');
    const scheduledAt = str('scheduled_at');
    const timeZone = str('time_zone');

    if (!applicationId || !scheduledAt || !timeZone) {
      // The decision engine refuses to auto-approve without these, and the
      // review UI refuses to submit without them. Checked again here because a
      // command must not depend on its callers being careful.
      throw new AppError(
        'PRECONDITION_FAILED',
        'An interview needs an application, a time, and a stated time zone.',
      );
    }

    const created = await createInterview(
      {
        applicationId,
        interviewRound: 1,
        scheduledAt,
        timeZone,
        meetingUrl: str('meeting_url'),
        interviewerName: str('interviewer'),
        interviewerEmail: null,
        status: 'scheduled',
        notes: null,
      },
      actor,
      provenance,
    );
    return { recordId: created.id, kind: 'interview' };
  }

  if (run.event_type === 'assessment') {
    const applicationId = str('application_id');
    const assessmentType = str('assessment_type');
    if (!applicationId || !assessmentType) {
      throw new AppError(
        'PRECONDITION_FAILED',
        'An assessment needs an application and a named assessment.',
      );
    }

    const dueDate = str('due_date');
    const created = await createAssessment(
      {
        applicationId,
        assessmentType,
        assessmentUrl: str('assessment_url'),
        receivedAt: new Date().toISOString(),
        deadline: dueDate ? `${dueDate}T23:59:00` : null,
        status: 'pending',
        notes: null,
      },
      actor,
      provenance,
    );
    return { recordId: created.id, kind: 'assessment' };
  }

  if (run.event_type === 'rejection') {
    const applicationId = str('application_id');
    if (!applicationId) {
      throw new AppError(
        'PRECONDITION_FAILED',
        'A rejection needs the application it applies to.',
      );
    }

    // The existing RPC, which writes the status history row and the timeline
    // activity in one transaction and refuses a transition the rules do not
    // allow. A rejection changes a record rather than creating one.
    await changeApplicationStatus(
      {
        applicationId,
        status: 'rejected',
        note:
          `Recorded from email interpretation ${run.id}. ` +
          (str('reason_if_explicit') ?? 'No reason was stated in the message.'),
      },
      actor,
    );
    return { recordId: applicationId, kind: 'rejection' };
  }

  throw new AppError(
    'PRECONDITION_FAILED',
    `There is no automated action for a ${run.event_type} proposal.`,
  );
}

/**
 * Everything the engine is allowed to consider, fetched through the ACTOR's
 * client so the CRM state it sees is the CRM state they may see.
 */
async function gatherFacts(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  run: {
    id: string;
    business_unit_id: string;
    email_message_id: string;
    event_type: string;
    event_confidence: number | null;
    proposed_candidate_id: string | null;
    candidate_match_confidence: number | null;
    extracted_data: Record<string, unknown>;
  },
  actor: ActorContext,
): Promise<DecisionInput> {
  const [email, candidate, prior] = await Promise.all([
    supabase
      .from('email_messages')
      .select('body_text, from_address, received_at')
      .eq('id', run.email_message_id)
      .maybeSingle(),
    run.proposed_candidate_id
      ? supabase
          .from('candidates')
          .select('id, full_name, email')
          .eq('id', run.proposed_candidate_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Every decision already made about this email and event type — not just
    // the one whose key this reading would produce, because the whole point is
    // to notice when this reading would produce a DIFFERENT key. Most recent
    // first; the latest decision is the one a change is measured against.
    supabase
      .from('intelligence_review_items')
      .select(
        'id, status, proposal_fingerprint, proposed_data, proposed_candidate_id, created_application_id, created_interview_id, created_assessment_id',
      )
      .eq('business_unit_id', run.business_unit_id)
      .eq('email_message_id', run.email_message_id)
      .eq('event_type', run.event_type as IntelligenceEventType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const candidateId = run.proposed_candidate_id;

  const [applications, interviews, assessments] = await Promise.all([
    candidateId
      ? supabase
          .from('applications')
          .select('id, company_name, position_title, job_id, status, application_date')
          .eq('candidate_id', candidateId)
      : Promise.resolve({ data: [] as never[] }),
    candidateId
      ? supabase
          .from('interviews')
          .select('id, application_id, scheduled_at, status')
          .eq('candidate_id', candidateId)
      : Promise.resolve({ data: [] as never[] }),
    candidateId
      ? supabase
          .from('assessments')
          .select('id, application_id, assessment_type, deadline, status')
          .eq('candidate_id', candidateId)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  return {
    eventType: run.event_type,
    eventConfidence: run.event_confidence === null ? null : Number(run.event_confidence),
    candidateId,
    candidateMatchConfidence:
      run.candidate_match_confidence === null ? null : Number(run.candidate_match_confidence),
    candidate: candidate.data
      ? {
          id: candidate.data.id,
          fullName: candidate.data.full_name,
          email: candidate.data.email,
        }
      : null,
    extracted: run.extracted_data,
    emailBody: email.data?.body_text ?? '',
    emailFromAddress: email.data?.from_address ?? '',
    emailReceivedAt: email.data?.received_at ?? new Date().toISOString(),
    existingApplications: (applications.data ?? []).map((a) => ({
      id: a.id,
      companyName: a.company_name,
      positionTitle: a.position_title,
      jobId: a.job_id,
      status: a.status,
      applicationDate: a.application_date,
    })),
    existingInterviews: (interviews.data ?? []).map((i) => ({
      id: i.id,
      applicationId: i.application_id,
      scheduledAt: i.scheduled_at,
      status: i.status,
    })),
    existingAssessments: (assessments.data ?? []).map((a) => ({
      id: a.id,
      applicationId: a.application_id,
      assessmentType: a.assessment_type,
      deadline: a.deadline,
      status: a.status,
    })),
    alreadyActioned: prior.data
      ? {
          itemId: prior.data.id,
          status: prior.data.status,
          fingerprint: prior.data.proposal_fingerprint,
          proposedData: (prior.data.proposed_data as Record<string, unknown> | null) ?? null,
          candidateId: prior.data.proposed_candidate_id,
          createdRecordId:
            prior.data.created_interview_id ??
            prior.data.created_assessment_id ??
            prior.data.created_application_id ??
            null,
          createdRecordKind: prior.data.created_interview_id
            ? ('interview' as const)
            : prior.data.created_assessment_id
              ? ('assessment' as const)
              : prior.data.created_application_id
                ? ('application' as const)
                : null,
        }
      : null,
    actorPermissions: actor.permissions as ReadonlySet<string>,
    now: new Date(),
  };
}

export interface ResolveInput {
  reviewItemId: string;
  status: 'rejected' | 'ignored' | 'in_review' | 'open';
  notes?: string | null;
}

/**
 * Rejecting, ignoring, or picking an item up.
 *
 * These need no CRM permission — refusing to create a record is not creating
 * one — so they go through the item's own UPDATE policy, gated on
 * proposal.review.
 */
export async function resolveProposal(
  input: ResolveInput,
  actor: ActorContext,
): Promise<{ id: string; status: string }> {
  const supabase = await createServerSupabase();

  const closing = input.status === 'rejected' || input.status === 'ignored';

  const { data, error } = await supabase
    .from('intelligence_review_items')
    .update({
      status: input.status,
      decision_notes: input.notes ?? null,
      ...(closing
        ? { reviewed_by: actor.userId, reviewed_at: new Date().toISOString() }
        : {}),
    })
    .eq('id', input.reviewItemId)
    .select('id, status')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Proposal not found, or not permitted.');
  return { id: data.id, status: data.status };
}
