/**
 * @jest-environment node
 *
 * Reviewer Identity Resolver — Phase 2 classifier (docs/REVIEWER_IDENTITY_
 * RESOLVER_PHASE2_DESIGN.md §3 + §3.1). Locks the rules: lone WEAK anchor →
 * unresolved, two corroborating weak → probable, ONE STRONG anchor (S215:
 * institution-corroborated ORCID) → probable on its own, ORCID multi-match →
 * ambiguous, name-mismatched Scholar = rejected ANCHOR (not identity rejection),
 * confirmed/rejected not reachable yet.
 */
const {
  resolveIdentity, evidenceFromEnrichment, mayPersistIdentity,
  RESOLVER_VERSION, RESOLVER_SOURCED_FIELDS,
} = require('../../lib/services/reviewer-identity-resolver');

const NOW = '2026-06-02T00:00:00.000Z';
const r = (hyp, ev) => resolveIdentity(hyp, ev, { now: NOW });

const scholarPass = (id = 'TSAI') => ({ scholarId: id, googleScholarUrl: `https://scholar.google.com/citations?user=${id}`, displayName: 'Li-Huei Tsai', nameMismatch: false, institutionMismatch: false, skipped: null });
const scholarNameMismatch = () => ({ scholarId: 'NAK', googleScholarUrl: 'https://scholar.google.com/citations?user=NAK', displayName: 'Masayuki Nakano', nameMismatch: true, institutionMismatch: false, skipped: 'name_mismatch' });
const orcidResolved = (id = '0000-0001') => ({ status: 'resolved', orcidId: id, orcidUrl: `https://orcid.org/${id}`, name: 'Li-Huei Tsai' });
const orcidCorroborated = (id = '0000-0001') => ({ status: 'resolved', orcidId: id, orcidUrl: `https://orcid.org/${id}`, name: 'Li-Huei Tsai', institutionCorroborated: true, matchedInstitution: 'Massachusetts Institute of Technology' });
const orcidAmbiguous = (n = 2) => ({ status: 'ambiguous', orcidId: null, candidateCount: n });

describe('resolveIdentity — PR1 status rules', () => {
  test('Tsai/Nakano: name-mismatched Scholar is a REJECTED ANCHOR, not identity rejection', () => {
    const out = r({ name: 'Li-Huei Tsai' }, { scholar: scholarNameMismatch(), orcid: null });
    expect(out.status).toBe('unresolved');           // not 'rejected'
    expect(out.anchors).toHaveLength(0);
    expect(out.rejectedAnchors).toHaveLength(1);
    expect(out.rejectedAnchors[0].type).toBe('scholar_profile');
    expect(out.rejectedAnchors[0].reason).toBe('name_mismatch');
    expect(out.confidenceBand).toBeNull();
  });

  test('lone weak anchor (Scholar only) → unresolved', () => {
    const out = r({ name: 'Li-Huei Tsai' }, { scholar: scholarPass(), orcid: null });
    expect(out.status).toBe('unresolved');
    expect(out.anchors).toHaveLength(1);
  });

  test('lone weak anchor (ORCID only) → unresolved', () => {
    const out = r({ name: 'Li-Huei Tsai' }, { scholar: null, orcid: orcidResolved() });
    expect(out.status).toBe('unresolved');
    expect(out.anchors).toHaveLength(1);
  });

  test('two corroborating weak anchors (Scholar + ORCID) → probable, band medium', () => {
    const out = r({ name: 'Li-Huei Tsai' }, { scholar: scholarPass(), orcid: orcidResolved() });
    expect(out.status).toBe('probable');
    expect(out.confidenceBand).toBe('medium');
    expect(out.anchors).toHaveLength(2);
  });

  test('institution-corroborated lone ORCID is a STRONG anchor → probable on its own (S215)', () => {
    const out = r({ name: 'Li-Huei Tsai' }, { scholar: null, orcid: orcidCorroborated() });
    expect(out.status).toBe('probable');
    expect(out.confidenceBand).toBe('medium');
    expect(out.anchors).toHaveLength(1);
    expect(out.anchors[0].type).toBe('orcid_public_institution_corroborated');
    expect(out.anchors[0].weight).toBe('strong');
    expect(out.anchors[0].parserOutput.matchedInstitution).toBe('Massachusetts Institute of Technology');
  });

  test('corroborated ORCID reaches probable even when Scholar is anchor-rejected (the rescue case)', () => {
    const out = r({ name: 'Li-Huei Tsai' }, { scholar: scholarNameMismatch(), orcid: orcidCorroborated() });
    expect(out.status).toBe('probable');
    expect(out.anchors).toHaveLength(1);
    expect(out.anchors[0].weight).toBe('strong');
    expect(out.rejectedAnchors).toHaveLength(1); // Scholar still recorded as a rejected anchor
  });

  test('ORCID ambiguity still wins over a corroborated ORCID is N/A — ambiguous never carries institutionCorroborated', () => {
    // Guard: an ambiguous ORCID abstain carries no orcidId, so it can never be promoted to strong.
    const out = r({ name: 'Wei Zhang' }, { scholar: null, orcid: orcidAmbiguous(2) });
    expect(out.status).toBe('ambiguous');
    expect(out.anchors).toHaveLength(0);
  });

  test('ORCID multi-match → ambiguous with a competitor + no band', () => {
    const out = r({ name: 'Wei Zhang' }, { scholar: null, orcid: orcidAmbiguous(3) });
    expect(out.status).toBe('ambiguous');
    expect(out.confidenceBand).toBeNull();
    expect(out.competitors).toHaveLength(1);
    expect(out.competitors[0].conflictingEvidence[0]).toMatch(/3 plausible ORCID/);
  });

  test('ORCID ambiguity takes precedence even when Scholar passes', () => {
    const out = r({ name: 'Wei Zhang' }, { scholar: scholarPass('ZHANG'), orcid: orcidAmbiguous(2) });
    expect(out.status).toBe('ambiguous');
  });

  test('no evidence → unresolved', () => {
    const out = r({ name: 'Nobody' }, { scholar: null, orcid: null });
    expect(out.status).toBe('unresolved');
    expect(out.anchors).toHaveLength(0);
    expect(out.rejectedAnchors).toHaveLength(0);
  });

  test('confirmed is never produced in PR1 (weak-only evidence)', () => {
    const out = r({ name: 'Li-Huei Tsai' }, { scholar: scholarPass(), orcid: orcidResolved() });
    expect(out.status).not.toBe('confirmed');
    expect(out.status).not.toBe('rejected');
  });

  test('stamps resolverVersion + resolvedAt', () => {
    const out = r({ name: 'X' }, { scholar: null, orcid: null });
    expect(out.resolverVersion).toBe(RESOLVER_VERSION);
    expect(out.resolvedAt).toBe(NOW);
  });
});

describe('mayPersistIdentity gate', () => {
  test('only confirmed/probable permit persisting identity fields', () => {
    expect(mayPersistIdentity('confirmed')).toBe(true);
    expect(mayPersistIdentity('probable')).toBe(true);
    expect(mayPersistIdentity('ambiguous')).toBe(false);
    expect(mayPersistIdentity('unresolved')).toBe(false);
    expect(mayPersistIdentity('rejected')).toBe(false);
  });

  test('RESOLVER_SOURCED_FIELDS excludes faculty/website (provenance unknown in PR1)', () => {
    expect(RESOLVER_SOURCED_FIELDS).toContain('wmkf_googlescholarid');
    expect(RESOLVER_SOURCED_FIELDS).toContain('wmkf_orcid');
    expect(RESOLVER_SOURCED_FIELDS).not.toContain('wmkf_website');
    expect(RESOLVER_SOURCED_FIELDS).not.toContain('wmkf_facultypageurl');
  });
});

describe('evidenceFromEnrichment — normalizes contactEnrichment', () => {
  test('pulls scholar tier + orcid tier into the evidence contract', () => {
    const ce = {
      affiliation: 'MIT',
      tierResults: {
        scholar_profile: { scholarId: 'ABC', scholarProfileUrl: 'https://scholar.google.com/citations?user=ABC', scholarDisplayName: 'Li-Huei Tsai', nameMismatch: false, institutionMismatch: false },
        orcid: { status: 'resolved', orcidId: '0000-0002', orcidUrl: 'https://orcid.org/0000-0002' },
      },
    };
    const ev = evidenceFromEnrichment(ce, { claimedInstitution: 'MIT' });
    expect(ev.scholar.scholarId).toBe('ABC');
    expect(ev.scholar.displayName).toBe('Li-Huei Tsai');
    expect(ev.orcid.orcidId).toBe('0000-0002');
    expect(ev.affiliation).toBe('MIT');
  });

  test('drops an errored orcid tier; absent scholar tier → null', () => {
    const ev = evidenceFromEnrichment({ tierResults: { orcid: { error: 'boom' } } }, {});
    expect(ev.orcid).toBeNull();
    expect(ev.scholar).toBeNull();
  });

  test('a skipped (name-mismatch) scholar tier still surfaces for anchor rejection', () => {
    const ce = { tierResults: { scholar_profile: { scholarId: 'NAK', nameMismatch: true, skipped: 'name_mismatch' } } };
    const ev = evidenceFromEnrichment(ce, {});
    expect(ev.scholar.nameMismatch).toBe(true);
    const out = r({ name: 'Li-Huei Tsai' }, ev);
    expect(out.rejectedAnchors[0].reason).toBe('name_mismatch');
  });
});
