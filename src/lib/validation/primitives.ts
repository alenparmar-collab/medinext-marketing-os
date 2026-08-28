import { z } from 'zod';

/**
 * Shared validation primitives.
 *
 * Rules that are also data-integrity invariants are duplicated as database
 * constraints, on purpose: Zod produces the good error message, Postgres
 * produces the guarantee. Neither substitutes for the other.
 */
export const uuid = z.string().uuid('Must be a valid identifier');

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

export const requiredText = (field: string, max = 200) =>
  z.string().trim().min(1, `${field} is required`).max(max, `${field} is too long`);

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/**
 * Phone is stored as entered. Normalising to E.164 needs a country context we
 * do not collect, and a wrong normalisation is worse than none.
 */
export const phone = z
  .string()
  .trim()
  .max(32, 'Phone number is too long')
  .regex(/^[+()\d\s.-]*$/, 'Phone number contains unexpected characters')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker (YYYY-MM-DD)');

/** Trims, drops blanks, de-duplicates, and caps length. */
export const stringList = (max = 40) =>
  z
    .array(z.string().trim().min(1).max(120))
    .max(max, `At most ${max} entries`)
    .transform((values) => Array.from(new Set(values.filter(Boolean))))
    .default([]);

/** Splits a comma-separated form field into a clean array. */
export const commaSeparatedList = (max = 40) =>
  z
    .string()
    .optional()
    .transform((value) =>
      Array.from(
        new Set(
          (value ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ).slice(0, max),
    );

/**
 * Splits a newline-separated form field into a clean array.
 *
 * Used for locations, which routinely contain commas ("Manchester, UK"). A
 * comma-separated control silently turns one location into two, so anything
 * comma-bearing gets one entry per line instead.
 */
export const newlineSeparatedList = (max = 40) =>
  z
    .string()
    .optional()
    .transform((value) =>
      Array.from(
        new Set(
          (value ?? '')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ).slice(0, max),
    );
