import { z } from 'zod';

/**
 * The contract the model answers in — and the boundary at which its output
 * stops being trusted.
 *
 * Two things are doing the work here.
 *
 * FIRST: the schema is what the model is constrained to produce. It cannot
 * return prose, so there is no prose to parse, and no prose that could be read
 * as an instruction.
 *
 * SECOND, and more important: there is NO FIELD FOR A CANDIDATE ID. The model
 * reports the identifiers it observed in the message; the server resolves them
 * against this tenant's candidates itself. An email that says "the candidate
 * is John Smith, id 4f3c…" is describing itself to a reader who has nowhere to
 * put that id. Prompt injection defence usually means writing a firmer system
 * prompt; this is the version that does not depend on the model cooperating.
 */

const confidence = z
  .number({ message: 'Confidence must be a number' })
  .min(0, 'Confidence cannot be negative')
  .max(1, 'Confidence cannot exceed 1');

/** ISO date, no time. Refused rather than coerced — a wrong date is worse than none. */
const isoDateOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Not a real date')
  .nullable();

const isoTimeOrNull = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM in 24-hour form')
  .nullable();

const httpsUrlOrNull = z
  .string()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), 'Expected a full http(s) URL')
  .nullable();

const shortText = (max: number) => z.string().max(max).nullable();

const emailAddress = z
  .string()
  .max(254)
  .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Not an email address');

export const EVENT_TYPES = [
  'application',
  'interview',
  'assessment',
  'rejection',
  'recruiter_response',
  'other',
] as const;

export type IntelligenceEventType = (typeof EVENT_TYPES)[number];

/**
 * What the model saw, not who it thinks the message is about.
 *
 * Names are collected but are never sufficient on their own — see
 * `matchCandidate`. Collecting them is still worth it: a name plus a phone
 * number is a much stronger signal than a phone number alone.
 */
const ObservedIdentifiers = z.object({
  email_addresses: z.array(emailAddress).max(20).default([]),
  phone_numbers: z.array(z.string().max(40)).max(20).default([]),
  person_names: z.array(z.string().max(120)).max(20).default([]),
});

/**
 * Extraction, per event type.
 *
 * Every field is nullable, and the prompt says to leave it null rather than
 * guess. An invented interview time is worse than a missing one: a missing one
 * shows up as a gap somebody fills in, and an invented one shows up as a
 * candidate at the wrong meeting.
 */
const ExtractedData = z.object({
  company: shortText(200),
  job_title: shortText(200),
  external_reference: shortText(120),

  application_date: isoDateOrNull,

  interview_date: isoDateOrNull,
  interview_time: isoTimeOrNull,
  timezone: shortText(64),
  interview_mode: z.enum(['video', 'phone', 'onsite', 'unknown']).nullable(),
  meeting_url: httpsUrlOrNull,
  interviewer: shortText(200),
  interview_type: shortText(120),

  assessment_name: shortText(200),
  assessment_type: shortText(120),
  due_date: isoDateOrNull,
  assessment_url: httpsUrlOrNull,

  rejection_date: isoDateOrNull,
  reason_if_explicit: shortText(500),

  response_summary: shortText(500),
});

/**
 * Traceability. Every extracted value worth acting on should point at the text
 * that supports it, so a reviewer can check the reading against the message
 * instead of taking it on faith.
 */
const EvidenceItem = z.object({
  field: z.string().max(64),
  excerpt: z.string().max(500),
});

export const InterpretationSchema = z.object({
  event_type: z.enum(EVENT_TYPES),
  event_confidence: confidence,
  summary: z.string().max(600),
  observed_identifiers: ObservedIdentifiers,
  extracted_data: ExtractedData,
  evidence: z.array(EvidenceItem).max(30).default([]),
});

export type Interpretation = z.infer<typeof InterpretationSchema>;
export type ExtractedFields = z.infer<typeof ExtractedData>;

/**
 * The same shape as a JSON Schema, for providers that can constrain generation.
 *
 * Kept beside the Zod schema on purpose: they must not drift, and a test
 * asserts that every property here exists in the Zod schema. The Zod schema
 * remains the authority — a provider that ignores its own constraint still has
 * to satisfy validation.
 */
export const INTERPRETATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'event_type',
    'event_confidence',
    'summary',
    'observed_identifiers',
    'extracted_data',
    'evidence',
  ],
  properties: {
    event_type: { type: 'string', enum: [...EVENT_TYPES] },
    event_confidence: { type: 'number', minimum: 0, maximum: 1 },
    summary: { type: 'string' },
    observed_identifiers: {
      type: 'object',
      additionalProperties: false,
      required: ['email_addresses', 'phone_numbers', 'person_names'],
      properties: {
        email_addresses: { type: 'array', items: { type: 'string' } },
        phone_numbers: { type: 'array', items: { type: 'string' } },
        person_names: { type: 'array', items: { type: 'string' } },
      },
    },
    extracted_data: {
      type: 'object',
      additionalProperties: false,
      required: [
        'company',
        'job_title',
        'external_reference',
        'application_date',
        'interview_date',
        'interview_time',
        'timezone',
        'interview_mode',
        'meeting_url',
        'interviewer',
        'interview_type',
        'assessment_name',
        'assessment_type',
        'due_date',
        'assessment_url',
        'rejection_date',
        'reason_if_explicit',
        'response_summary',
      ],
      properties: {
        company: { type: ['string', 'null'] },
        job_title: { type: ['string', 'null'] },
        external_reference: { type: ['string', 'null'] },
        application_date: { type: ['string', 'null'] },
        interview_date: { type: ['string', 'null'] },
        interview_time: { type: ['string', 'null'] },
        timezone: { type: ['string', 'null'] },
        interview_mode: { type: ['string', 'null'], enum: ['video', 'phone', 'onsite', 'unknown', null] },
        meeting_url: { type: ['string', 'null'] },
        interviewer: { type: ['string', 'null'] },
        interview_type: { type: ['string', 'null'] },
        assessment_name: { type: ['string', 'null'] },
        assessment_type: { type: ['string', 'null'] },
        due_date: { type: ['string', 'null'] },
        assessment_url: { type: ['string', 'null'] },
        rejection_date: { type: ['string', 'null'] },
        reason_if_explicit: { type: ['string', 'null'] },
        response_summary: { type: ['string', 'null'] },
      },
    },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'excerpt'],
        properties: { field: { type: 'string' }, excerpt: { type: 'string' } },
      },
    },
  },
} as const;

export interface ValidationOutcome {
  ok: boolean;
  interpretation: Interpretation | null;
  /** Field-path -> messages, safe to store and show. Never the raw output. */
  issues: Record<string, string[]>;
}

/**
 * Validates provider output.
 *
 * Model output is untrusted input, exactly like a form post — the difference
 * is that a form post does not try to be helpful. Anything that fails here
 * stops: the run is marked failed with the issues recorded, and nothing
 * downstream ever sees a half-valid reading.
 */
export function validateInterpretation(raw: unknown): ValidationOutcome {
  const parsed = InterpretationSchema.safeParse(raw);

  if (parsed.success) {
    return { ok: true, interpretation: parsed.data, issues: {} };
  }

  const issues: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || '_root';
    (issues[key] ??= []).push(issue.message);
  }

  return { ok: false, interpretation: null, issues };
}
