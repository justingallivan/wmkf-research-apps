import { RESOLVER_SOURCED_FIELDS } from '../../lib/services/reviewer-identity-resolver.js';
import {
  IDENTITY_LINEAGE_FIELDS,
  normalizeBindingAnchor,
  selectBindingAnchor,
  validateIdentityBindingTuple,
  parseIdentityFieldLineage,
  serializeIdentityFieldLineage,
  automatedLineageFields,
} from '../../lib/services/reviewer-identity-binding-contract.js';

const ORCID = '0000-0002-1825-0097';
const VALUES = {
  wmkf_googlescholarid: 'abc_123',
  wmkf_googlescholarurl: 'https://scholar.google.com/citations?user=abc_123',
  wmkf_hindex: 17,
  wmkf_i10index: null,
  wmkf_totalcitations: 900,
  wmkf_orcid: ORCID,
  wmkf_orcidurl: `https://orcid.org/${ORCID}`,
};

function lineage() {
  return {
    wmkf_googlescholarid: { source: 'automated', bindingVersion: 2 },
    wmkf_googlescholarurl: { source: 'automated', bindingVersion: 2 },
    wmkf_hindex: { source: 'staff_manual', bindingVersion: 1 },
    wmkf_totalcitations: { source: 'automated', bindingVersion: 2 },
    wmkf_orcid: { source: 'self_reported', bindingVersion: 2 },
    wmkf_orcidurl: { source: 'self_reported', bindingVersion: 2 },
  };
}

describe('reviewer identity binding contract', () => {
  test('lineage allowlist stays identical to the resolver clear/persist set', () => {
    expect(IDENTITY_LINEAGE_FIELDS).toEqual(RESOLVER_SOURCED_FIELDS);
  });

  test('canonicalizes only checksum-valid ORCID, exact OpenAlex, and staff attestation anchors', () => {
    expect(normalizeBindingAnchor(`orcid:https://orcid.org/${ORCID}`).value).toBe(`orcid:${ORCID}`);
    expect(normalizeBindingAnchor('openalex:https://openalex.org/a12345').value).toBe('openalex:A12345');
    expect(normalizeBindingAnchor('staff-attestation:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA').value)
      .toBe('staff-attestation:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(normalizeBindingAnchor('orcid:0000-0002-1825-0098').ok).toBe(false);
    expect(normalizeBindingAnchor('openalex:https://evil.example/A12345').ok).toBe(false);
    expect(normalizeBindingAnchor('openalex:prefix-A12345').ok).toBe(false);
    expect(normalizeBindingAnchor('scholar:abc_123').ok).toBe(false);
    expect(normalizeBindingAnchor('email:reviewer@example.org').ok).toBe(false);
  });

  test('prefers ORCID and rejects malformed supplied identifiers instead of falling through', () => {
    expect(selectBindingAnchor({ orcid: ORCID, openAlexAuthorId: 'A123' })).toBe(`orcid:${ORCID}`);
    expect(() => selectBindingAnchor({ orcid: 'bad', openAlexAuthorId: 'A123' })).toThrow(/malformed ORCID/);
  });

  test('accepts only coherent unbound and bound tuples', () => {
    expect(validateIdentityBindingTuple({ bindingSource: 'legacy_unbound' })).toMatchObject({ ok: true, state: 'unbound' });
    expect(validateIdentityBindingTuple({ bindingSource: 'legacy_unbound', bindingAnchor: 'openalex:A1' }).ok).toBe(false);
    expect(validateIdentityBindingTuple({
      bindingVersion: 2,
      bindingSource: 'self_reported',
      bindingAnchor: `orcid:${ORCID}`,
      boundAt: '2026-07-12T20:00:00.000Z',
      derivedBindingVersion: null,
    })).toMatchObject({ ok: true, state: 'bound' });
    expect(validateIdentityBindingTuple({
      bindingVersion: 2,
      bindingSource: 'automated',
      bindingAnchor: 'openalex:A123',
      boundAt: 'not-a-date',
      derivedBindingVersion: 3,
    }).ok).toBe(false);
    expect(validateIdentityBindingTuple({
      bindingVersion: 1,
      bindingSource: 'automated',
      bindingAnchor: 'staff-attestation:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      boundAt: '2026-07-12T20:00:00.000Z',
    }).ok).toBe(false);
    expect(validateIdentityBindingTuple({
      bindingVersion: 1,
      bindingSource: 'self_reported',
      bindingAnchor: 'openalex:A123',
      boundAt: '2026-07-12T20:00:00.000Z',
    }).ok).toBe(false);
    expect(validateIdentityBindingTuple({
      bindingVersion: 2147483648,
      bindingSource: 'automated',
      bindingAnchor: 'openalex:A123',
      boundAt: '2026-07-12T20:00:00.000Z',
    }).ok).toBe(false);
    expect(validateIdentityBindingTuple({
      bindingVersion: 1,
      bindingSource: 'automated',
      bindingAnchor: 'openalex:A123',
      boundAt: 'July 12 2026 20:00:00 UTC',
    }).ok).toBe(false);
  });

  test('round-trips deterministic strict lineage and identifies only automated fields', () => {
    const raw = serializeIdentityFieldLineage(lineage(), { values: VALUES, currentBindingVersion: 2 });
    expect(raw).toBe(JSON.stringify({ schemaVersion: 1, fields: lineage() }));
    const parsed = parseIdentityFieldLineage(raw, { values: VALUES, currentBindingVersion: 2 });
    expect(parsed.ok).toBe(true);
    expect(automatedLineageFields(parsed.value)).toEqual([
      'wmkf_googlescholarid',
      'wmkf_googlescholarurl',
      'wmkf_totalcitations',
    ]);
  });

  test.each([
    ['malformed JSON', '{'],
    ['array root', '[]'],
    ['unknown top-level key', JSON.stringify({ schemaVersion: 1, fields: lineage(), surprise: true })],
    ['unknown field', JSON.stringify({ schemaVersion: 1, fields: { ...lineage(), wmkf_website: { source: 'automated', bindingVersion: 2 } } })],
    ['unknown source', JSON.stringify({ schemaVersion: 1, fields: { ...lineage(), wmkf_hindex: { source: 'model_guess', bindingVersion: 2 } } })],
    ['future version', JSON.stringify({ schemaVersion: 1, fields: { ...lineage(), wmkf_hindex: { source: 'staff_manual', bindingVersion: 3 } } })],
    ['Dataverse-overflow version', JSON.stringify({ schemaVersion: 1, fields: { ...lineage(), wmkf_hindex: { source: 'staff_manual', bindingVersion: 2147483648 } } })],
  ])('rejects %s lineage', (_label, raw) => {
    expect(parseIdentityFieldLineage(raw, { values: VALUES, currentBindingVersion: 2 }).ok).toBe(false);
  });

  test('rejects missing lineage, lineage on null, noncanonical pairs, invalid metrics, and oversize payloads', () => {
    const missing = { ...lineage() };
    delete missing.wmkf_orcid;
    expect(parseIdentityFieldLineage(JSON.stringify({ schemaVersion: 1, fields: missing }), {
      values: VALUES,
      currentBindingVersion: 2,
    }).ok).toBe(false);

    expect(parseIdentityFieldLineage(JSON.stringify({ schemaVersion: 1, fields: {
      ...lineage(),
      wmkf_i10index: { source: 'automated', bindingVersion: 2 },
    } }), { values: VALUES, currentBindingVersion: 2 }).ok).toBe(false);

    expect(parseIdentityFieldLineage(JSON.stringify({ schemaVersion: 1, fields: lineage() }), {
      values: { ...VALUES, wmkf_orcidurl: `https://orcid.org/${ORCID}?bad=1` },
      currentBindingVersion: 2,
    }).ok).toBe(false);
    expect(parseIdentityFieldLineage(JSON.stringify({ schemaVersion: 1, fields: lineage() }), {
      values: { ...VALUES, wmkf_hindex: 1001 },
      currentBindingVersion: 2,
    }).ok).toBe(false);
    expect(parseIdentityFieldLineage('x'.repeat(2049), { values: VALUES, currentBindingVersion: 2 }).ok).toBe(false);
  });
});
