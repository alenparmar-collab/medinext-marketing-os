import { describe, expect, it } from 'vitest';
import { matchCandidate, phoneKey, type MatchableCandidate } from '@/server/modules/intelligence/matching';
import { fixtureInterpretation } from '@/server/modules/intelligence/providers/fixture';
import { CONFIDENCE, MATCH } from '@/config/intelligence';

/**
 * Candidate matching is done by the server, deterministically, from
 * identifiers the model reported observing. These are the rules that decide
 * whether a proposal is worth making at all.
 */
const PRIYA: MatchableCandidate = {
  id: '00000000-0000-4000-a000-000000000001',
  fullName: 'Priya Raman',
  email: 'priya.raman@example.invalid',
  phone: '+44 7700 900123',
};

const KWAME: MatchableCandidate = {
  id: '00000000-0000-4000-a000-000000000002',
  fullName: 'Kwame Boateng',
  email: 'kwame.boateng@example.invalid',
  phone: '+44 7700 900456',
};

/** Same name, different person. Recruitment databases are full of these. */
const OTHER_PRIYA: MatchableCandidate = {
  id: '00000000-0000-4000-a000-000000000009',
  fullName: 'Priya Raman',
  email: 'p.raman@other.invalid',
  phone: null,
};

const observed = (identifiers: {
  email_addresses?: string[];
  phone_numbers?: string[];
  person_names?: string[];
}) =>
  fixtureInterpretation({
    observed_identifiers: {
      email_addresses: identifiers.email_addresses ?? [],
      phone_numbers: identifiers.phone_numbers ?? [],
      person_names: identifiers.person_names ?? [],
    },
  });

describe('exact identifiers', () => {
  it('an exact email address proposes that candidate with high confidence', () => {
    const match = matchCandidate(
      observed({ email_addresses: ['priya.raman@example.invalid'] }),
      [PRIYA, KWAME],
    );

    expect(match.candidateId).toBe(PRIYA.id);
    expect(match.confidence).toBe(MATCH.exactEmail);
    expect(match.confidence).toBeGreaterThanOrEqual(CONFIDENCE.high);
    expect(match.evidence.matchedEmail).toBe(PRIYA.email);
  });

  it('matches an email address regardless of case', () => {
    const match = matchCandidate(
      observed({ email_addresses: ['Priya.Raman@Example.INVALID'] }),
      [PRIYA],
    );
    expect(match.candidateId).toBe(PRIYA.id);
  });

  it('a phone number proposes that candidate, below the email threshold', () => {
    const match = matchCandidate(observed({ phone_numbers: ['07700 900123'] }), [PRIYA, KWAME]);

    expect(match.candidateId).toBe(PRIYA.id);
    expect(match.confidence).toBe(MATCH.exactPhone);
  });

  it('normalises phone formatting rather than comparing strings', () => {
    // Three ways of writing one number.
    for (const written of ['+44 7700 900123', '(0)7700-900123', '00447700900123']) {
      const match = matchCandidate(observed({ phone_numbers: [written] }), [PRIYA]);
      expect(match.candidateId, written).toBe(PRIYA.id);
    }
  });

  it('ignores a number too short to identify anyone', () => {
    expect(phoneKey('12345')).toBeNull();
    const match = matchCandidate(observed({ phone_numbers: ['12345'] }), [PRIYA]);
    expect(match.candidateId).toBeNull();
  });

  it('a phone number corroborated by a name is reported as such', () => {
    const match = matchCandidate(
      observed({ phone_numbers: ['07700 900123'], person_names: ['Priya Raman'] }),
      [PRIYA],
    );

    expect(match.candidateId).toBe(PRIYA.id);
    expect(match.confidence).toBe(MATCH.nameWithCorroboration);
    expect(match.reasons.join(' ')).toContain('name');
  });
});

describe('names are never enough on their own', () => {
  it('a name alone proposes a candidate BELOW the review threshold', () => {
    const match = matchCandidate(observed({ person_names: ['Priya Raman'] }), [PRIYA, KWAME]);

    expect(match.candidateId).toBe(PRIYA.id);
    expect(match.confidence).toBe(MATCH.nameAlone);
    // The rule that matters: a name never produces a proposal anyone acts on.
    expect(match.confidence).toBeLessThan(CONFIDENCE.review);
    expect(match.reasons.join(' ')).toContain('not an identifier');
  });

  it('TWO CANDIDATES WITH THE SAME NAME PROPOSE NOBODY', () => {
    const match = matchCandidate(observed({ person_names: ['Priya Raman'] }), [
      PRIYA,
      OTHER_PRIYA,
      KWAME,
    ]);

    expect(match.candidateId).toBeNull();
    expect(match.confidence).toBe(0);
    expect(match.evidence.ambiguousAmong).toBe(2);
  });

  it('a shared name does not block an exact email match', () => {
    // The email disambiguates, so the ambiguity never arises.
    const match = matchCandidate(
      observed({
        email_addresses: ['priya.raman@example.invalid'],
        person_names: ['Priya Raman'],
      }),
      [PRIYA, OTHER_PRIYA],
    );

    expect(match.candidateId).toBe(PRIYA.id);
    expect(match.confidence).toBe(MATCH.exactEmail);
  });

  it('matches a name despite accents and punctuation', () => {
    const accented: MatchableCandidate = {
      id: 'c-1',
      fullName: 'José Ferreira',
      email: 'jose@example.invalid',
      phone: null,
    };
    const match = matchCandidate(observed({ person_names: ['Jose Ferreira'] }), [accented]);
    expect(match.candidateId).toBe(accented.id);
  });
});

describe('when nothing can be resolved', () => {
  it('no identifiers proposes nobody', () => {
    expect(matchCandidate(observed({}), [PRIYA, KWAME]).candidateId).toBeNull();
  });

  it('an unknown email address proposes nobody', () => {
    const match = matchCandidate(
      observed({ email_addresses: ['stranger@elsewhere.invalid'] }),
      [PRIYA],
    );
    expect(match.candidateId).toBeNull();
    expect(match.confidence).toBe(0);
  });

  it('an empty candidate list proposes nobody', () => {
    const match = matchCandidate(
      observed({ email_addresses: ['priya.raman@example.invalid'] }),
      [],
    );
    expect(match.candidateId).toBeNull();
  });

  it('two candidate records sharing an address proposes nobody', () => {
    const duplicate = { ...PRIYA, id: 'duplicate-record' };
    const match = matchCandidate(
      observed({ email_addresses: ['priya.raman@example.invalid'] }),
      [PRIYA, duplicate],
    );

    expect(match.candidateId).toBeNull();
    expect(match.evidence.ambiguousAmong).toBe(2);
  });

  it('CANNOT PROPOSE A CANDIDATE FROM ANOTHER TENANT', () => {
    // The caller scopes the list to one business unit. Given a scoped list, a
    // candidate from elsewhere is simply not a possible answer — and the
    // database refuses one anyway through the composite foreign key.
    const match = matchCandidate(
      observed({ email_addresses: ['hiroshi.tanaka@example.invalid'] }),
      [PRIYA, KWAME],
    );
    expect(match.candidateId).toBeNull();
  });
});

describe('the model cannot assert identity', () => {
  it('there is no field in which a model could return a candidate id', () => {
    const interpretation = fixtureInterpretation();
    expect(Object.keys(interpretation)).not.toContain('candidate_id');
    expect(Object.keys(interpretation.observed_identifiers).sort()).toEqual([
      'email_addresses',
      'person_names',
      'phone_numbers',
    ]);
  });

  it('an id quoted in the email body cannot become a proposal', () => {
    // An injected uuid arrives as a person_name or not at all; either way it
    // matches no candidate, because matching compares against the database.
    const match = matchCandidate(
      observed({ person_names: ['00000000-0000-4000-a000-000000000001'] }),
      [PRIYA, KWAME],
    );
    expect(match.candidateId).toBeNull();
  });
});
