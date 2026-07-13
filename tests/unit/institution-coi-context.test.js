import {
  INSTITUTION_COI_RULE_VERSION,
  canonicalizeInstitutionCoiContext,
  hashInstitutionCoiContext,
} from '../../lib/services/institution-coi-context.js';

const REQUEST_ID = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

describe('institution COI context contract', () => {
  const entries = [
    { identity: { name: 'MIT', openAlexId: 'https://openalex.org/I63966007' } },
    { identity: { name: 'Massachusetts Institute of Technology', openAlexId: 'I63966007' } },
    { identity: { name: 'University of Washington', ror: 'https://ror.org/00cvxb145' } },
  ];

  test('requires explicitly server-loaded context', () => {
    expect(() => canonicalizeInstitutionCoiContext({
      requestId: REQUEST_ID,
      institutionEntries: entries,
      authority: 'client_payload',
    })).toThrow(/server_loaded authority/);
  });

  test('canonicalizes, deduplicates, sorts, and hashes deterministically', () => {
    const first = hashInstitutionCoiContext({
      requestId: REQUEST_ID,
      institutionEntries: entries,
      authority: 'server_loaded',
    });
    const second = hashInstitutionCoiContext({
      requestId: REQUEST_ID.toLowerCase(),
      institutionEntries: [...entries].reverse(),
      authority: 'server_loaded',
    });
    expect(first).toEqual(second);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.canonical).toMatchObject({
      contract: 'wmkf.identity-institution-coi-context',
      version: 1,
      ruleVersion: INSTITUTION_COI_RULE_VERSION,
      requestId: REQUEST_ID.toLowerCase(),
    });
    // Exact canonical tuples are retained. The alias and full name share an
    // OpenAlex id but remain distinct inputs because name fallback semantics are
    // part of the versioned rule contract.
    expect(first.canonical.institutions).toHaveLength(3);
    expect(first.canonical.institutions[0].ror).toBeNull();
    expect(first.serialized).toBe('{"contract":"wmkf.identity-institution-coi-context","version":1,"ruleVersion":"institution-coi-v1","requestId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","institutions":[{"baseName":"massachusetts institute of technology","expandedName":"massachusetts institute of technology","openAlexId":"I63966007","ror":null},{"baseName":"mit","expandedName":"massachusetts institute of technology","openAlexId":"I63966007","ror":null},{"baseName":"university of washington","expandedName":"university of washington","openAlexId":null,"ror":"https://ror.org/00cvxb145"}]}');
    expect(first.hash).toBe('4591df9f528007df9c58fa3616c6545381841546b095deab466e8f379a6f9e47');
  });

  test('changes the hash for request, effective institution, or rule-version changes', () => {
    const base = {
      requestId: REQUEST_ID,
      institutionEntries: entries,
      authority: 'server_loaded',
    };
    const hash = hashInstitutionCoiContext(base).hash;
    expect(hashInstitutionCoiContext({ ...base, requestId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB' }).hash).not.toBe(hash);
    expect(hashInstitutionCoiContext({ ...base, institutionEntries: [{ identity: 'Caltech' }] }).hash).not.toBe(hash);
    expect(hashInstitutionCoiContext({ ...base, ruleVersion: 'institution-coi-v2' }).hash).not.toBe(hash);
  });

  test('rejects incomplete or noncanonicalizable context', () => {
    expect(() => canonicalizeInstitutionCoiContext({
      requestId: REQUEST_ID,
      institutionEntries: [],
      authority: 'server_loaded',
    })).toThrow(/at least one institution/);
    expect(() => canonicalizeInstitutionCoiContext({
      requestId: 'not-a-guid',
      institutionEntries: entries,
      authority: 'server_loaded',
    })).toThrow(/requestId/);
    expect(() => canonicalizeInstitutionCoiContext({
      requestId: REQUEST_ID,
      institutionEntries: [{}],
      authority: 'server_loaded',
    })).toThrow(/canonical identity/);
  });
});
