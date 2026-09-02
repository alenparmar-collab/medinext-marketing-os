import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { CONFIDENCE, CONTEXT, PROMPT_VERSION } from '@/config/intelligence';
import { redactSecrets } from '@/server/modules/email/crypto';
import { validateInterpretation } from './schema';
import { matchCandidate, type MatchableCandidate } from './matching';
import { prefilter } from './prefilter';
import {
  ProviderRefusedError,
  ProviderUnavailableError,
  type EmailIntelligenceProvider,
  type InterpretationRequest,
} from './providers/types';

/**
 * INTERPRETATION ONLY.
 *
 * This module reads an email and records what a model made of it. It creates
 * and modifies no candidate, application, interview, assessment, marketing
 * activity, assignment or notification, and it imports nothing that could.
 *
 * The boundary is the build. A model that can reach a CRM write is a model
 * that can be talked into one by an email, and emails are written by people
 * who would like that very much. Acting on a proposal — with a decision step,
 * a review queue and an authorised human — is Build 7B.
 *
 * A test asserts this file imports no CRM module and touches no CRM table.
 */
type Db = SupabaseClient<Database>;

export interface ProcessOptions {
  emailMessageId: string;
  requestedBy?: string | null;
  /** Recorded on the run; a reprocess is a new run, never an edit. */
  reason?: string;
}

export interface ProcessResult {
  runId: string;
  runNumber: number;
  status: 'completed' | 'review_required' | 'failed' | 'ignored';
  eventType: string | null;
  eventConfidence: number | null;
  proposedCandidateId: string | null;
  candidateMatchConfidence: number | null;
  error: string | null;
}

/**
 * Interprets one email.
 *
 * The shape of the guarantees:
 *
 *   * A run row exists before the provider is called, so a crash mid-flight
 *     leaves a record rather than silence.
 *   * The partial unique index refuses a second active run for the same email,
 *     so a double-clicked reprocess spends one provider call.
 *   * Failure is terminal for THAT run and produces a new run on retry, so a
 *     retry never edits history into a different answer.
 *   * Confidence below the threshold produces `review_required`, not
 *     `completed`. Nothing downstream may treat those as the same.
 */
export async function processEmailForIntelligence(
  db: Db,
  provider: EmailIntelligenceProvider,
  options: ProcessOptions,
): Promise<ProcessResult> {
  const email = await loadEmail(db, options.emailMessageId);

  const { data: run, error: runError } = await db
    .from('email_intelligence_runs')
    .insert({
      business_unit_id: email.business_unit_id,
      email_message_id: email.id,
      provider: provider.kind,
      model: provider.model,
      prompt_version: PROMPT_VERSION,
      status: 'pending',
      requested_by: options.requestedBy ?? null,
    })
    .select('id, run_number')
    .single();

  if (runError || !run) {
    // The commonest cause is the partial unique index: another run for this
    // email is already in flight, which is a correct refusal rather than a
    // fault.
    throw runError ?? new Error('Could not open an intelligence run.');
  }

  const finish = (
    fields: Record<string, unknown>,
  ): Promise<{ error: unknown }> =>
    db
      .from('email_intelligence_runs')
      .update({ completed_at: new Date().toISOString(), ...fields })
      .eq('id', run.id) as unknown as Promise<{ error: unknown }>;

  // ---- Pre-filter: decide whether this is worth a provider call ----------
  const filtered = prefilter({
    subject: email.subject,
    bodyText: email.body_text,
    bodyHtml: email.body_html,
    headers: email.headers ?? {},
    fromAddress: email.from_address,
  });

  if (filtered.skip) {
    await finish({
      status: 'ignored',
      event_type: 'other',
      event_confidence: 1,
      summary: filtered.reason,
      validation_ok: true,
      validation_result: { skipped: true, reason: filtered.reason },
    });

    return {
      runId: run.id,
      runNumber: run.run_number,
      status: 'ignored',
      eventType: 'other',
      eventConfidence: 1,
      proposedCandidateId: null,
      candidateMatchConfidence: null,
      error: null,
    };
  }

  await db
    .from('email_intelligence_runs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', run.id);

  try {
    const request = await buildRequest(db, email);
    const response = await provider.interpret(request);

    // ---- Validation: provider output is untrusted input ------------------
    const validation = validateInterpretation(response.raw);

    if (!validation.ok || !validation.interpretation) {
      await finish({
        status: 'failed',
        validation_ok: false,
        validation_result: { issues: validation.issues },
        error_code: 'invalid_output',
        error_message:
          'The interpretation did not match the required schema and was discarded.',
      });

      return {
        runId: run.id,
        runNumber: run.run_number,
        status: 'failed',
        eventType: null,
        eventConfidence: null,
        proposedCandidateId: null,
        candidateMatchConfidence: null,
        error: 'The interpretation did not match the required schema.',
      };
    }

    const interpretation = validation.interpretation;

    // ---- Candidate matching, decided here rather than by the model -------
    const candidates = await loadCandidates(db, email.business_unit_id);
    const match = matchCandidate(interpretation, candidates);

    // A reading stands on its own only if BOTH the classification and any
    // candidate proposal are strong. A confident classification attached to a
    // guessed person is not a confident result.
    const classificationIsStrong = interpretation.event_confidence >= CONFIDENCE.high;
    const proposalIsStrong = match.candidateId === null || match.confidence >= CONFIDENCE.high;
    const status =
      classificationIsStrong && proposalIsStrong ? 'completed' : 'review_required';

    await finish({
      status,
      event_type: interpretation.event_type,
      event_confidence: interpretation.event_confidence,
      summary: interpretation.summary,
      proposed_candidate_id: match.candidateId,
      candidate_match_confidence: match.candidateId === null ? null : match.confidence,
      candidate_match_reasons: match.reasons,
      candidate_match_evidence: match.evidence,
      // Stored, not discarded: when matching resolves nobody, this is the only
      // thing that lets a reviewer see WHY rather than just THAT.
      observed_identifiers: interpretation.observed_identifiers,
      extracted_data: interpretation.extracted_data,
      evidence: interpretation.evidence,
      validation_ok: true,
      validation_result: { issues: {} },
      model: response.model,
    });

    return {
      runId: run.id,
      runNumber: run.run_number,
      status,
      eventType: interpretation.event_type,
      eventConfidence: interpretation.event_confidence,
      proposedCandidateId: match.candidateId,
      candidateMatchConfidence: match.candidateId === null ? null : match.confidence,
      error: null,
    };
  } catch (error) {
    const { code, message } = describeFailure(error);

    await finish({
      status: 'failed',
      validation_ok: false,
      error_code: code,
      error_message: message,
    });

    // Deliberately not rethrown. A provider being unavailable is an expected
    // operational event, recorded on the run and retryable, not an exception
    // for a request handler to turn into a 500.
    return {
      runId: run.id,
      runNumber: run.run_number,
      status: 'failed',
      eventType: null,
      eventConfidence: null,
      proposedCandidateId: null,
      candidateMatchConfidence: null,
      error: message,
    };
  }
}

interface EmailRow {
  id: string;
  business_unit_id: string;
  thread_id: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  headers: Record<string, string> | null;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  received_at: string;
}

async function loadEmail(db: Db, emailMessageId: string): Promise<EmailRow> {
  const { data, error } = await db
    .from('email_messages')
    .select(
      'id, business_unit_id, thread_id, subject, body_text, body_html, headers, from_address, from_name, to_addresses, received_at',
    )
    .eq('id', emailMessageId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Email not found.');
  return data as EmailRow;
}

/**
 * Everything that is sent to the provider, and nothing else.
 *
 * DATA MINIMISATION, stated explicitly because it is easy to widen by
 * accident:
 *
 *   SENT — this message's subject, sender, recipients, received time, body
 *          (truncated), attachment FILE NAMES, and up to four earlier messages
 *          from the SAME thread, trimmed harder.
 *
 *   NOT SENT — OAuth tokens, mailbox credentials, any message from another
 *              thread or another mailbox, candidate records, internal notes,
 *              attachment CONTENT, or any other part of the CRM.
 *
 * The candidate list never leaves the server: matching happens here, after the
 * provider has answered, so a third party is never handed a roster of the
 * people this company is marketing.
 */
async function buildRequest(db: Db, email: EmailRow): Promise<InterpretationRequest> {
  const { data: contextRows } = await db
    .from('email_messages')
    .select('subject, from_address, received_at, body_text')
    .eq('thread_id', email.thread_id)
    .neq('id', email.id)
    .lte('received_at', email.received_at)
    .order('received_at', { ascending: false })
    .limit(CONTEXT.maxThreadMessages);

  const { data: attachments } = await db
    .from('email_attachments')
    .select('file_name')
    .eq('message_id', email.id);

  return {
    message: {
      subject: email.subject,
      fromAddress: email.from_address,
      fromName: email.from_name,
      toAddresses: email.to_addresses ?? [],
      receivedAt: email.received_at,
      body: truncate(email.body_text ?? '', CONTEXT.maxBodyCharacters),
      // Names only. The bytes are not fetched, let alone sent.
      attachmentNames: (attachments ?? []).map((a) => a.file_name),
    },
    threadContext: (contextRows ?? [])
      .slice()
      .reverse()
      .map((row) => ({
        subject: row.subject,
        fromAddress: row.from_address,
        receivedAt: row.received_at,
        body: truncate(row.body_text ?? '', CONTEXT.maxContextBodyCharacters),
      })),
  };
}

async function loadCandidates(db: Db, businessUnitId: string): Promise<MatchableCandidate[]> {
  // Scoped to the tenant here, so a cross-tenant proposal is not merely
  // refused by the database — it is never constructed.
  const { data, error } = await db
    .from('candidates')
    .select('id, full_name, email, phone')
    .eq('business_unit_id', businessUnitId)
    .is('archived_at', null);

  if (error) throw error;

  return (data ?? []).map((c) => ({
    id: c.id,
    fullName: c.full_name,
    email: c.email,
    phone: c.phone,
  }));
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\r\n/g, '\n').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}\n[truncated]`;
}

/**
 * Turns a failure into something safe to store and show.
 *
 * Provider errors can quote the request, which contains the email and the
 * bearer token. Neither belongs in a column an internal user reads.
 */
function describeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ProviderUnavailableError) {
    return {
      code: 'provider_unavailable',
      message: 'The interpretation provider was unavailable. This run can be retried.',
    };
  }
  if (error instanceof ProviderRefusedError) {
    return {
      code: 'provider_refused',
      message: 'The interpretation provider refused or declined the request.',
    };
  }
  return {
    code: 'unexpected',
    message: redactSecrets(
      error instanceof Error ? error.message : 'Interpretation failed for an unknown reason.',
    ).slice(0, 500),
  };
}
