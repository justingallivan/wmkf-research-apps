/**
 * @jest-environment node
 */

const {
  buildReviewerProvenance,
  saveSourceListForCandidate,
  provenanceGroupOf,
  provenanceLabelForCandidate,
  hasGroundedProvenanceRankingBonus,
  isIdentityReviewExemptProvenance,
  requiresStaffIdentityConfirmation,
  formatReferredByReason,
  parseReferredByReason,
  splitReferredByReason,
  PROVENANCE_KINDS,
} = require('../../lib/utils/reviewer-provenance');
// The client selectability gate is asserted against the server predicate in this file so
// the two can never drift apart silently again (S387).
const { isCandidateSelectable } = require('../../shared/components/reviewers/reviewer-search-logic');

describe('reviewer provenance DTO helper', () => {
  test('maps literature candidates to ordered scholarly sources plus provenance kind for save', () => {
    const candidate = {
      name: 'Ada Reviewer',
      source: 'claude_suggestion',
      verificationSource: 'pubmed',
      publications: [{ pmid: '123', doi: '10.1/example' }],
    };

    expect(buildReviewerProvenance(candidate)).toEqual({
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: ['doi:10.1/example', 'pmid:123'],
    });
    expect(saveSourceListForCandidate(candidate)).toEqual(['pubmed', 'literature_retrieved']);
  });

  test('does not infer provenance from legacy Claude flags alone', () => {
    const candidate = { name: 'Parametric Only', isClaudeSuggestion: true, source: 'claude_suggestion' };
    expect(buildReviewerProvenance(candidate).kind).toBe('barred_parametric');
    expect(saveSourceListForCandidate(candidate)).toEqual(['barred_parametric']);
    expect(provenanceGroupOf(candidate)).toBe('needs_identity_review');
  });

  test('maps applicant recommended rows from their actual origin', () => {
    const candidate = { name: 'Applicant Pick', isApplicantRecommended: true };
    expect(buildReviewerProvenance(candidate)).toMatchObject({
      kind: 'applicant_suggested',
      sources: ['applicant_form'],
      seedRole: 'applicant_suggested',
    });
    expect(provenanceGroupOf(candidate)).toBe('applicant_suggested');
  });

  // Slice E (S235) — the BARRED/unknown-kind fallback must not gate a row whose IDENTITY
  // is positively resolved. A BARRED Track-A row upgraded by a shared-ORCID Track-B match
  // keeps the barred kind but gains confirmed identity; it is a legitimate, selectable
  // reviewer, and the server (save-candidates) must NOT 422 it. The genuinely-unresolved
  // BARRED row (no positive identity, covered above at "does not infer…") stays gated.
  test('a positively-resolved BARRED row is selectable, not needs_identity_review', () => {
    const confirmedBarred = {
      name: 'Upgraded By Orcid',
      isClaudeSuggestion: true,
      source: 'claude_suggestion', // → barred_parametric kind (no scholarly source)
      identityStatus: 'confirmed',
      verified: true,
      verificationStatus: 'verified',
      orcid: '0000-0002-1825-0097',
    };
    expect(buildReviewerProvenance(confirmedBarred).kind).toBe('barred_parametric');
    expect(provenanceGroupOf(confirmedBarred)).not.toBe('needs_identity_review');
    expect(provenanceGroupOf(confirmedBarred)).toBe('literature_retrieved');
  });

  test('a probable-identity row is also selectable despite a barred kind', () => {
    const probableBarred = {
      name: 'Probable Person', isClaudeSuggestion: true, source: 'claude_suggestion',
      verificationStatus: 'probable',
    };
    expect(provenanceGroupOf(probableBarred)).toBe('literature_retrieved');
  });

  test('an unresolved row still routes to needs_identity_review (gate intact)', () => {
    const unresolved = {
      name: 'Deferred Person', isClaudeSuggestion: true, source: 'claude_suggestion',
      needsIdentification: true, identityStatus: 'unresolved', verificationStatus: 'unresolved',
    };
    expect(provenanceGroupOf(unresolved)).toBe('needs_identity_review');
  });

  // S235 — PI-named / cited candidates (the proposal author named/cited THIS person) stay
  // SELECTABLE even when the automatic identity match is unresolved; only system-discovered
  // candidates are hard-blocked. (The save path force-nulls their contact until confirmed.)
  test('a PI-named / cited candidate stays selectable (cited_or_proposal_named) when unresolved', () => {
    const proposalNamed = {
      name: 'Olga Smirnova', source: 'proposal_named',
      needsIdentification: true, identityStatus: 'unresolved', verificationStatus: 'unresolved',
    };
    expect(provenanceGroupOf(proposalNamed)).toBe('cited_or_proposal_named');

    const cited = { name: 'Cited Author', source: 'cited_reference', identityStatus: 'unresolved' };
    expect(provenanceGroupOf(cited)).toBe('cited_or_proposal_named');
  });

  test('a system-discovered (literature_retrieved) unresolved candidate stays gated (needs_identity_review)', () => {
    const deferred = {
      name: 'Deferred Track-B', sources: ['openalex'],
      needsIdentification: true, identityStatus: 'unresolved',
    };
    expect(provenanceGroupOf(deferred)).toBe('needs_identity_review');
  });
});

// S249 referral capture — a contacted reviewer suggested this person.
describe('referred provenance (S249)', () => {
  const referred = (over = {}) => ({ name: 'Tim Newhouse', referredBy: 'Dr. Abby Doyle', ...over });

  test('a referredBy candidate gets kind=referred + seedRole=referred_by + the referrer passthrough', () => {
    const p = buildReviewerProvenance(referred());
    expect(p.kind).toBe(PROVENANCE_KINDS.REFERRED);
    expect(p.seedRole).toBe('referred_by');
    expect(p.referredBy).toBe('Dr. Abby Doyle');
  });

  test('non-referred provenance objects keep their shape (no referredBy key)', () => {
    const p = buildReviewerProvenance({ name: 'X', source: 'proposal_named' });
    expect(p).not.toHaveProperty('referredBy');
  });

  test('referred is a grounded-ranking-bonus kind (≈ proposal_named)', () => {
    expect(hasGroundedProvenanceRankingBonus(referred())).toBe(true);
  });

  test('referred is identity-review-exempt → selectable-with-verify even when unresolved', () => {
    expect(isIdentityReviewExemptProvenance(PROVENANCE_KINDS.REFERRED)).toBe(true);
    const unresolvedReferral = referred({
      needsIdentification: true, identityStatus: 'unresolved', verificationStatus: 'unresolved',
    });
    expect(provenanceGroupOf(unresolvedReferral)).toBe('cited_or_proposal_named');
  });

  test('the card label names the referrer', () => {
    expect(provenanceLabelForCandidate(referred())).toBe('Externally-Referred · Dr. Abby Doyle');
    expect(provenanceLabelForCandidate({ name: 'Y', referredBy: '', provenanceKind: 'referred' })).toBe('Externally-Referred');
  });

  test('referredBy survives a roster round-trip (provenance object reload)', () => {
    const first = buildReviewerProvenance(referred());
    // Simulate reload: the candidate now carries the persisted provenance object.
    const reloaded = buildReviewerProvenance({ name: 'Tim Newhouse', provenance: first });
    expect(reloaded.kind).toBe(PROVENANCE_KINDS.REFERRED);
    expect(reloaded.referredBy).toBe('Dr. Abby Doyle');
  });

  test('save-source list carries the referred kind', () => {
    expect(saveSourceListForCandidate(referred())).toContain('referred');
  });

  // Durability (Codex review fix): a my-candidates reload rebuilds the row with
  // sources ['staff_manual','referred'] + referredBy parsed from the match reason.
  // The kind must re-derive to referred, NOT degrade to barred_parametric.
  test('a reloaded referral DTO (sources include referred) re-derives kind referred', () => {
    const reloaded = { name: 'Tim Newhouse', sources: ['staff_manual', 'referred'], referredBy: 'Dr. Abby Doyle' };
    const p = buildReviewerProvenance(reloaded);
    expect(p.kind).toBe(PROVENANCE_KINDS.REFERRED);
    expect(p.referredBy).toBe('Dr. Abby Doyle');
    expect(provenanceGroupOf(reloaded)).toBe('cited_or_proposal_named'); // still selectable-with-verify
  });

  test('sources-plural alone (referredBy parse failed) still re-derives kind referred', () => {
    const p = buildReviewerProvenance({ name: 'X', sources: ['staff_manual', 'referred'] });
    expect(p.kind).toBe(PROVENANCE_KINDS.REFERRED);
  });

  test('early-return path carries a top-level referredBy onto a provenance object that lacks it', () => {
    const provenanceWithoutReferrer = { kind: 'referred', sources: [], seedRole: 'referred_by', groundingWorkIds: [] };
    const p = buildReviewerProvenance({ name: 'X', provenance: provenanceWithoutReferrer, referredBy: 'Dr. Abby Doyle' });
    expect(p.referredBy).toBe('Dr. Abby Doyle');
  });
});

// S387: an applicant card was selectable while the promotion route 422'd it — the client
// group test read three of the server gate's four clauses. These lock the two clauses that
// were missing, and lock the group ↔ server-gate equivalence itself.
describe('applicant identity gate parity with promote-applicant-reviewer', () => {
  const applicant = (extra) => ({
    name: 'Applicant Pick',
    email: 'applicant.pick@example.edu',
    emailSource: 'applicant_form',
    emailPersistAllowed: true,
    addressTrustReceipt: {
      receiptId: 'receipt-applicant-pick',
      personConfirmed: true,
      email: 'applicant.pick@example.edu',
    },
    isApplicantRecommended: true,
    ...extra,
  });

  test('institutionMismatch routes an applicant row to needs identity review', () => {
    const candidate = applicant({ institutionMismatch: true });
    expect(requiresStaffIdentityConfirmation(candidate)).toBe(true);
    expect(provenanceGroupOf(candidate)).toBe('needs_identity_review');
    expect(isCandidateSelectable(candidate)).toBe(false);
  });

  test('an identityStatus outside confirmed/probable routes to needs identity review', () => {
    for (const identityStatus of ['ambiguous', 'abstain', 'unknown']) {
      const candidate = applicant({ identityStatus });
      expect(requiresStaffIdentityConfirmation(candidate)).toBe(true);
      expect(provenanceGroupOf(candidate)).toBe('needs_identity_review');
      expect(isCandidateSelectable(candidate)).toBe(false);
    }
  });

  test('the enrichment identity verdict is read when no top-level identityStatus is persisted', () => {
    const candidate = applicant({ contactEnrichment: { identity: { status: 'ambiguous' } } });
    expect(requiresStaffIdentityConfirmation(candidate)).toBe(true);
    expect(provenanceGroupOf(candidate)).toBe('needs_identity_review');
  });

  test('a resolved applicant row stays selectable in its own group', () => {
    for (const identityStatus of ['confirmed', 'probable']) {
      const candidate = applicant({ identityStatus });
      expect(requiresStaffIdentityConfirmation(candidate)).toBe(false);
      expect(provenanceGroupOf(candidate)).toBe('applicant_suggested');
      expect(isCandidateSelectable(candidate)).toBe(true);
    }
  });

  test('a staff-confirmed applicant row becomes selectable again', () => {
    const candidate = applicant({ institutionMismatch: true, pdIdentityConfirmed: true });
    expect(requiresStaffIdentityConfirmation(candidate)).toBe(true);
    expect(provenanceGroupOf(candidate)).toBe('applicant_suggested');
    expect(isCandidateSelectable(candidate)).toBe(true);
  });

  // The defect was a selectable card the server refuses. Assert the equivalence over the
  // whole flag cross-product, so re-adding a clause to one side alone fails here.
  test('applicant selectability requires both server identity clearance and resolved contact identity', () => {
    const values = [undefined, true, false];
    const statuses = [null, 'confirmed', 'probable', 'unresolved', 'ambiguous', 'abstain'];
    for (const needsIdentification of values) {
      for (const institutionMismatch of values) {
        for (const identityStatus of statuses) {
          for (const verificationStatus of [null, 'unresolved', 'verified']) {
            const candidate = applicant({
              needsIdentification, institutionMismatch, identityStatus, verificationStatus,
            });
            const serverWouldRefuse = requiresStaffIdentityConfirmation(candidate);
            const contactIdentityResolved = identityStatus === 'confirmed' || identityStatus === 'probable';
            expect(isCandidateSelectable(candidate)).toBe(!serverWouldRefuse && contactIdentityResolved);
          }
        }
      }
    }
  });

  // Guardrail for the deliberate narrowing: the other kinds must NOT inherit this gate,
  // because save-candidates gates on the explicit unresolved markers instead.
  test('institutionMismatch alone does not gate a literature-retrieved row', () => {
    const candidate = {
      name: 'Lit Row', source: 'claude_suggestion', verificationSource: 'pubmed',
      identityStatus: 'confirmed', institutionMismatch: true,
    };
    expect(provenanceGroupOf(candidate)).toBe('literature_retrieved');
  });
});

// The referrer has no dedicated Dataverse field — it survives only inside the
// match-reason text. These fixtures are the discriminating ones: every name here
// carries a period, which is exactly what the pre-S424 non-greedy parse truncated.
describe('referral clause encode/decode', () => {
  test.each([
    ['Dr. Abby Doyle', 'Synthesis expert.'],
    ['Dr. Abby Doyle', ''],
    ['A. B. Doyle', 'Met at Gordon conf. Follow up.'],
    ['Abby Doyle', 'Plain name, plain note.'],
    ['Prof. J. Smith-O’Neill', ''],
  ])('round-trips %j alongside note %j', (name, note) => {
    expect(parseReferredByReason(formatReferredByReason(name, note))).toBe(name);
  });

  test('a name ending in a period keeps one, not two, and re-encodes stably', () => {
    const reason = formatReferredByReason('Abby Doyle Jr.', 'Suffix carries the period.');
    expect(reason).toBe('Referred by Abby Doyle Jr.\nSuffix carries the period.');
    const parsed = parseReferredByReason(reason);
    expect(parsed).toBe('Abby Doyle Jr');
    // Idempotent: re-encoding what we parsed reproduces the same stored string.
    expect(formatReferredByReason(parsed, 'Suffix carries the period.')).toBe(reason);
  });

  test('the referral clause owns line 1, so later annotations cannot re-enter the name', () => {
    // save-candidates appends its PD-confirmation and coauthor-COI suffixes with a
    // leading space; the trailing newline keeps them off line 1.
    let reason = formatReferredByReason('Dr. Abby Doyle');
    reason += ' [Identity confirmed by PD; contact entered manually]';
    reason += ' [Coauthor COI: Has co-authored with proposal authors]';
    expect(parseReferredByReason(reason)).toBe('Dr. Abby Doyle');
  });

  test('the clause terminator is a newline, not a period', () => {
    // Guards the parse contract: if this newline is ever trimmed in transit, the
    // decode silently falls back to the lossy legacy branch below.
    expect(formatReferredByReason('Dr. Abby Doyle', 'note')).toBe('Referred by Dr. Abby Doyle.\nnote');
    expect(formatReferredByReason('Dr. Abby Doyle')).toBe('Referred by Dr. Abby Doyle.\n');
  });

  test('a name with internal whitespace or newlines is collapsed before encoding', () => {
    expect(parseReferredByReason(formatReferredByReason('Dr.  Abby\nDoyle'))).toBe('Dr. Abby Doyle');
  });

  test('no referrer means no clause', () => {
    expect(formatReferredByReason('', 'Just a note.')).toBe('Just a note.');
    expect(formatReferredByReason(null)).toBe('');
    expect(parseReferredByReason('Manually added by staff.')).toBeNull();
    expect(parseReferredByReason(null)).toBeNull();
  });

  test('legacy space-joined rows keep their original (lossy) parse — no regression', () => {
    // Written before the line-1 contract. Genuinely ambiguous: the note and the
    // name are separated by the same ". " that appears inside the title.
    expect(parseReferredByReason('Referred by Dr. Abby Doyle. Synthesis expert.')).toBe('Dr');
    // Legacy rows with a period-free name were, and remain, parsed correctly.
    expect(parseReferredByReason('Referred by Abby Doyle. Synthesis expert.')).toBe('Abby Doyle');
  });
});

// Drives the labeled "Referred by:" line on the Invite Reviewers card, which must
// not also repeat the referrer inside the "Why:" rationale.
describe('splitReferredByReason (display split)', () => {
  test('separates the referrer from the rationale that follows it', () => {
    expect(splitReferredByReason(formatReferredByReason('Dr. Abby Doyle', 'Synthesis expert.')))
      .toEqual({ referredBy: 'Dr. Abby Doyle', rest: 'Synthesis expert.' });
  });

  test('a referral with no note leaves no rationale behind', () => {
    // The prod shape: "Why:" must disappear entirely rather than render empty.
    expect(splitReferredByReason(formatReferredByReason('Mikhail Shapiro')))
      .toEqual({ referredBy: 'Mikhail Shapiro', rest: '' });
  });

  test('a non-referral keeps its whole reason as the rationale', () => {
    expect(splitReferredByReason('Manually added by staff.'))
      .toEqual({ referredBy: null, rest: 'Manually added by staff.' });
    expect(splitReferredByReason('')).toEqual({ referredBy: null, rest: '' });
  });

  test('downstream annotations stay in the rationale, not the referrer', () => {
    const reason = `${formatReferredByReason('Dr. Abby Doyle')} [Identity confirmed by PD; contact entered manually]`;
    expect(splitReferredByReason(reason)).toEqual({
      referredBy: 'Dr. Abby Doyle',
      rest: '[Identity confirmed by PD; contact entered manually]',
    });
  });

  test('a legacy row still splits, on its legacy (lossy) boundary', () => {
    expect(splitReferredByReason('Referred by Abby Doyle. Synthesis expert.'))
      .toEqual({ referredBy: 'Abby Doyle', rest: 'Synthesis expert.' });
  });
});
