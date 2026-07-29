/**
 * @jest-environment node
 *
 * Locks the S211 invitation duplicate-send guard (Codex blocker): an invitation
 * to an already-invited candidate is skipped unless an explicit re-invite, while
 * materials/followup/thankyou stay re-sendable.
 */
const {
  shouldSkipDuplicateInvitation,
  sendAllowsAttachments,
  recipientMayReceiveAttachments,
  emailConfidence,
  emailSourceTier,
  emailSourceOutranks,
  emailSourceUpgradeAllowed,
  isHumanAssertedEmailSource,
} = require('../../lib/utils/reviewer-invite');

describe('shouldSkipDuplicateInvitation', () => {
  test('skips an already-invited invitation by default', () => {
    expect(shouldSkipDuplicateInvitation({ templateType: 'invitation', allowResend: false, invited: true })).toBe(true);
  });
  test('does NOT skip a not-yet-invited candidate', () => {
    expect(shouldSkipDuplicateInvitation({ templateType: 'invitation', allowResend: false, invited: false })).toBe(false);
  });
  test('allowResend overrides the guard (deliberate re-invite)', () => {
    expect(shouldSkipDuplicateInvitation({ templateType: 'invitation', allowResend: true, invited: true })).toBe(false);
  });
  test('non-first-contact types are never skipped (materials/followup/thankyou are re-sendable)', () => {
    for (const templateType of ['materials', 'followup', 'thankyou']) {
      expect(shouldSkipDuplicateInvitation({ templateType, allowResend: false, invited: true })).toBe(false);
    }
  });
});

describe('sendAllowsAttachments — no materials on a pre-acceptance invitation', () => {
  test('invitation carries NO attachments', () => {
    expect(sendAllowsAttachments('invitation')).toBe(false);
  });
  test('post-acceptance types may carry attachments', () => {
    for (const t of ['materials', 'followup', 'thankyou']) {
      expect(sendAllowsAttachments(t)).toBe(true);
    }
  });
  test('allowlist (not denylist): retired and UNKNOWN types carry NO materials', () => {
    for (const t of ['hold', 'finalize-ready', 'whatever-new-type', '', undefined]) {
      expect(sendAllowsAttachments(t)).toBe(false);
    }
  });
});

describe('isKnownTemplateType — fail-closed on unknown types (chunk-6 #4)', () => {
  const { isKnownTemplateType } = require('../../lib/utils/reviewer-invite');
  test('active known types pass', () => {
    for (const t of ['invitation', 'materials', 'followup', 'thankyou']) {
      expect(isKnownTemplateType(t)).toBe(true);
    }
  });
  test('retired / unknown / empty / undefined are rejected', () => {
    for (const t of ['hold', 'finalize', 'bogus', '', undefined, null, 'HOLD']) {
      expect(isKnownTemplateType(t)).toBe(false);
    }
  });
});

describe('recipientMayReceiveAttachments — server-authoritative (acceptance), not caller-controlled', () => {
  test('only an accepted recipient may receive attachments', () => {
    expect(recipientMayReceiveAttachments({ wmkf_accepted: true })).toBe(true);
  });
  test('not-yet-accepted / declined / missing → no attachments', () => {
    expect(recipientMayReceiveAttachments({ wmkf_accepted: false })).toBe(false);
    expect(recipientMayReceiveAttachments({ wmkf_accepted: null })).toBe(false);
    expect(recipientMayReceiveAttachments({})).toBe(false);
    expect(recipientMayReceiveAttachments(null)).toBe(false);
  });
});

describe('emailConfidence — Slice G invite-confidence gate', () => {
  test('ready sources are HIGH regardless of identity status', () => {
    for (const source of ['orcid', 'institution_page', 'scholarly_multi']) {
      expect(emailConfidence({ wmkf_emailsource: source })).toMatchObject({ level: 'high', action: 'ready' });
      // even with an unconfirmed identity, the source itself is authoritative
      expect(emailConfidence({ wmkf_emailsource: source, wmkf_identitystatus: 'unresolved' }).level).toBe('high');
    }
  });

  test('search-sourced email stays research-only even on a confirmed/probable identity', () => {
    for (const source of ['serp_search', 'claude_search', 'search_contested']) {
      expect(emailConfidence({ wmkf_emailsource: source, wmkf_identitystatus: 'confirmed' }))
        .toMatchObject({ level: 'low', action: 'research_only' });
      expect(emailConfidence({ wmkf_emailsource: source, wmkf_identitystatus: 'probable' }).level).toBe('low');
      expect(emailConfidence({ wmkf_emailsource: source, wmkf_identitystatus: 'unresolved' }).level).toBe('low');
      expect(emailConfidence({ wmkf_emailsource: source }).level).toBe('low');
    }
  });

  test('single-work and affiliation addresses require a quick check', () => {
    for (const source of ['scholarly_single', 'pubmed', 'affiliation']) {
      expect(emailConfidence({ wmkf_emailsource: source, wmkf_identitystatus: 'confirmed' }))
        .toMatchObject({ level: 'low', action: 'quick_check' });
    }
  });

  test('manually-entered, unknown, and missing sources are LOW', () => {
    expect(emailConfidence({ wmkf_emailsource: 'manual' }).level).toBe('low');
    expect(emailConfidence({ wmkf_emailsource: 'manual', wmkf_identitystatus: 'confirmed' }).level).toBe('low');
    expect(emailConfidence({ wmkf_emailsource: 'search_contested', wmkf_identitystatus: 'confirmed' })).toMatchObject({
      level: 'low',
      action: 'research_only',
    });
    expect(emailConfidence({ wmkf_emailsource: null }).level).toBe('low');
    expect(emailConfidence({}).level).toBe('low');
    expect(emailConfidence({ wmkf_emailsource: 'something_new' }).level).toBe('low');
  });

  test('name-resolved/discovery-tier contested source never inherits anchored search HIGH', () => {
    expect(emailConfidence({ emailSource: 'search_contested', identityStatus: 'confirmed' }).action).toBe('research_only');
    expect(emailConfidence({ emailSource: 'search_contested', identityStatus: 'probable' }).action).toBe('research_only');
  });

  test('accepts the normalized (camelCase) shape too', () => {
    expect(emailConfidence({ emailSource: 'orcid' }).level).toBe('high');
    expect(emailConfidence({ emailSource: 'serp_search', identityStatus: 'confirmed' }).level).toBe('low');
    expect(emailConfidence({ emailSource: 'manual' }).level).toBe('low');
  });

  test('source matching is case/whitespace-insensitive', () => {
    expect(emailConfidence({ wmkf_emailsource: ' ORCID ' }).level).toBe('high');
    expect(emailConfidence({ wmkf_emailsource: 'Serp_Search', wmkf_identitystatus: 'Confirmed' }).level).toBe('low');
  });

  test('always returns a human-readable reason string', () => {
    expect(typeof emailConfidence({ wmkf_emailsource: 'manual' }).reason).toBe('string');
    expect(emailConfidence({ wmkf_emailsource: 'manual' }).reason.length).toBeGreaterThan(0);
  });

  test('an explicit empty address is missing', () => {
    expect(emailConfidence({ email: null, emailSource: null })).toMatchObject({
      level: 'low',
      action: 'missing',
    });
  });
});

// S387: address-provenance precedence. `emailSourceTier` is a SECOND statement of the
// same source→tier facts emailConfidence encodes in its branch order, so the first test
// here locks them together — if a source is ever added to one and not the other, this
// fails rather than silently letting the adapter and the send gate disagree.
describe('emailSourceTier / emailSourceOutranks', () => {
  const KNOWN_SOURCES = [
    'orcid', 'institution_page', 'scholarly_multi',
    'manual', 'staff_verified', 'affiliation', 'scholarly_single', 'pubmed',
    'serp_search', 'claude_search', 'search_contested',
  ];

  test('every known source tiers exactly as emailConfidence classifies it', () => {
    for (const source of KNOWN_SOURCES) {
      expect(emailSourceTier(source)).toBe(emailConfidence({ wmkf_emailsource: source }).action);
    }
  });

  test('an unknown or absent source earns no precedence claim, though it stays sendable-with-check', () => {
    for (const source of ['', null, undefined, 'not_a_real_source']) {
      expect(emailSourceTier(source)).toBeNull();
    }
    // Deliberate asymmetry: the live send gate still asks for a human check rather than
    // refusing an unrecognized source outright.
    expect(emailConfidence({ wmkf_emailsource: 'not_a_real_source' }).action).toBe('quick_check');
  });

  test('case and surrounding whitespace do not change the tier', () => {
    expect(emailSourceTier('  ORCID ')).toBe('ready');
    expect(emailSourceTier('Serp_Search')).toBe('research_only');
  });

  test('outranking is strict, directional, and only between known sources', () => {
    // The live case this was built for: request 1002874, an affiliation-embedded address
    // pinned behind a stored serp_search value.
    expect(emailSourceOutranks('affiliation', 'serp_search')).toBe(true);
    expect(emailSourceOutranks('serp_search', 'affiliation')).toBe(false);
    expect(emailSourceOutranks('scholarly_multi', 'pubmed')).toBe(true);
    expect(emailSourceOutranks('orcid', 'staff_verified')).toBe(true);
    // Equal tier never outranks — no churn, and a staff attestation is not displaced by a
    // same-tier machine source.
    expect(emailSourceOutranks('affiliation', 'staff_verified')).toBe(false);
    expect(emailSourceOutranks('orcid', 'institution_page')).toBe(false);
    expect(emailSourceOutranks('serp_search', 'claude_search')).toBe(false);
    // Unknown on either side answers false in BOTH directions.
    expect(emailSourceOutranks('affiliation', 'not_a_real_source')).toBe(false);
    expect(emailSourceOutranks('not_a_real_source', 'serp_search')).toBe(false);
    expect(emailSourceOutranks('affiliation', null)).toBe(false);
  });

  // Reversed after adversarial review: a stored human assertion is TERMINAL against
  // machine evidence. Its quick-check tier is what keeps a human in the loop at send for
  // an address someone had to vouch for, and the person row is shared across requests, so
  // an automatic promotion to `ready` would delete that acknowledgement everywhere —
  // including on the request where the staffer made the assertion.
  test('a stored human assertion is never upgraded by machine evidence', () => {
    for (const stored of ['manual', 'staff_verified', 'MANUAL', ' staff_verified ']) {
      for (const incoming of ['orcid', 'institution_page', 'scholarly_multi']) {
        // The tier comparison still says "stronger"…
        expect(emailSourceOutranks(incoming, stored)).toBe(true);
        // …but the upgrade is refused.
        expect(emailSourceUpgradeAllowed(incoming, stored)).toBe(false);
      }
    }
    expect(isHumanAssertedEmailSource('manual')).toBe(true);
    expect(isHumanAssertedEmailSource('staff_verified')).toBe(true);
    expect(isHumanAssertedEmailSource('affiliation')).toBe(false);
    expect(isHumanAssertedEmailSource(null)).toBe(false);
  });

  test('machine sources still upgrade each other', () => {
    expect(emailSourceUpgradeAllowed('affiliation', 'serp_search')).toBe(true);
    expect(emailSourceUpgradeAllowed('institution_page', 'claude_search')).toBe(true);
    expect(emailSourceUpgradeAllowed('scholarly_multi', 'pubmed')).toBe(true);
    // …and never downgrade or churn.
    expect(emailSourceUpgradeAllowed('serp_search', 'affiliation')).toBe(false);
    expect(emailSourceUpgradeAllowed('affiliation', 'scholarly_single')).toBe(false);
  });

  test('a human assertion may still be superseded BY a human (the adapter overwrite path)', () => {
    // `manual` and `search_contested` overwrite unconditionally in
    // researcher.upsertByPotentialReviewer, so these two are deliberately NOT routed
    // through the upgrade predicate — asserted here so the exemption stays visible.
    expect(emailSourceUpgradeAllowed('manual', 'staff_verified')).toBe(false);
    expect(emailSourceUpgradeAllowed('search_contested', 'manual')).toBe(false);
  });
});
