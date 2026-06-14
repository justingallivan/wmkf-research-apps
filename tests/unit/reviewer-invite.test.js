/**
 * @jest-environment node
 *
 * Locks the S211 invitation duplicate-send guard (Codex blocker): an invitation
 * to an already-invited candidate is skipped unless an explicit re-invite, while
 * materials/followup/thankyou stay re-sendable.
 */
const { shouldSkipDuplicateInvitation, sendAllowsAttachments, templateCarriesCalendarInvite, recipientMayReceiveAttachments, emailConfidence } = require('../../lib/utils/reviewer-invite');

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
  test('non-invitation types are never skipped (materials/followup are re-sendable)', () => {
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
  test('allowlist (not denylist): hold, finalize-trigger, and any UNKNOWN type carry NO materials', () => {
    for (const t of ['hold', 'finalize-ready', 'whatever-new-type', '', undefined]) {
      expect(sendAllowsAttachments(t)).toBe(false);
    }
  });
});

describe('templateCarriesCalendarInvite — the .ics save-the-date lane', () => {
  test('hold carries the calendar invite', () => {
    expect(templateCarriesCalendarInvite('hold')).toBe(true);
  });
  test('material-bearing + invitation types do NOT carry a calendar invite', () => {
    for (const t of ['materials', 'followup', 'thankyou', 'invitation', undefined]) {
      expect(templateCarriesCalendarInvite(t)).toBe(false);
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
  test('authoritative sources are HIGH regardless of identity status', () => {
    for (const source of ['orcid', 'pubmed', 'institution_page']) {
      expect(emailConfidence({ wmkf_emailsource: source }).level).toBe('high');
      // even with an unconfirmed identity, the source itself is authoritative
      expect(emailConfidence({ wmkf_emailsource: source, wmkf_identitystatus: 'unresolved' }).level).toBe('high');
    }
  });

  test('search-sourced email is HIGH only on a confirmed/probable identity', () => {
    for (const source of ['serp_search', 'claude_search']) {
      expect(emailConfidence({ wmkf_emailsource: source, wmkf_identitystatus: 'confirmed' }).level).toBe('high');
      expect(emailConfidence({ wmkf_emailsource: source, wmkf_identitystatus: 'probable' }).level).toBe('high');
      // unconfirmed / unresolved / missing identity → LOW (not anchored)
      expect(emailConfidence({ wmkf_emailsource: source, wmkf_identitystatus: 'unresolved' }).level).toBe('low');
      expect(emailConfidence({ wmkf_emailsource: source }).level).toBe('low');
    }
  });

  test('affiliation-sourced email is LOW even on a confirmed identity (Codex R2)', () => {
    expect(emailConfidence({ wmkf_emailsource: 'affiliation', wmkf_identitystatus: 'confirmed' }).level).toBe('low');
  });

  test('manually-entered, unknown, and missing sources are LOW', () => {
    expect(emailConfidence({ wmkf_emailsource: 'manual' }).level).toBe('low');
    expect(emailConfidence({ wmkf_emailsource: 'manual', wmkf_identitystatus: 'confirmed' }).level).toBe('low');
    expect(emailConfidence({ wmkf_emailsource: null }).level).toBe('low');
    expect(emailConfidence({}).level).toBe('low');
    expect(emailConfidence({ wmkf_emailsource: 'something_new' }).level).toBe('low');
  });

  test('accepts the normalized (camelCase) shape too', () => {
    expect(emailConfidence({ emailSource: 'orcid' }).level).toBe('high');
    expect(emailConfidence({ emailSource: 'serp_search', identityStatus: 'confirmed' }).level).toBe('high');
    expect(emailConfidence({ emailSource: 'manual' }).level).toBe('low');
  });

  test('source matching is case/whitespace-insensitive', () => {
    expect(emailConfidence({ wmkf_emailsource: ' ORCID ' }).level).toBe('high');
    expect(emailConfidence({ wmkf_emailsource: 'Serp_Search', wmkf_identitystatus: 'Confirmed' }).level).toBe('high');
  });

  test('always returns a human-readable reason string', () => {
    expect(typeof emailConfidence({ wmkf_emailsource: 'manual' }).reason).toBe('string');
    expect(emailConfidence({ wmkf_emailsource: 'manual' }).reason.length).toBeGreaterThan(0);
  });
});
