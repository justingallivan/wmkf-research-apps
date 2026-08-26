/**
 * @jest-environment node
 */

const {
  classifyInvitationLinks,
  INVITATION_LINK_INVALID_REASON,
  validateInvitationTemplateForSave,
} = require('../../lib/utils/invitation-link-validator');

const SENTINEL_LINK = 'https://reviews.example.org/external/review/send_time_token.pending_authority.not_live';

describe('invitation-link-validator', () => {
  test('accepts exactly one three-segment sentinel JWT when a link is expected', () => {
    expect(classifyInvitationLinks({
      subject: 'Invitation',
      body: `Respond here: ${SENTINEL_LINK}`,
      externalLinkExpected: true,
    })).toMatchObject({ valid: true, occurrenceCount: 1, jwts: ['send_time_token.pending_authority.not_live'] });
  });

  test('accepts zero reviewer-link occurrences only when no link is expected', () => {
    expect(classifyInvitationLinks({ subject: 'Update', body: 'No portal link.', externalLinkExpected: false }))
      .toMatchObject({ valid: true, occurrenceCount: 0, jwts: [] });
  });

  test('rejects malformed, distinct-duplicate, unexpected, and unresolved invitation content', () => {
    expect(classifyInvitationLinks({
      body: 'https://reviews.example.org/external/review/token.value',
      externalLinkExpected: false,
    }).reason).toBe(INVITATION_LINK_INVALID_REASON.MALFORMED);
    expect(classifyInvitationLinks({
      body: `${SENTINEL_LINK}\nhttps://reviews.example.org/external/review/other.distinct.token`,
      externalLinkExpected: true,
    }).reason).toBe(INVITATION_LINK_INVALID_REASON.MULTIPLE);
    expect(classifyInvitationLinks({
      body: SENTINEL_LINK,
      externalLinkExpected: false,
    }).reason).toBe(INVITATION_LINK_INVALID_REASON.UNEXPECTED);
    expect(classifyInvitationLinks({
      subject: 'Hello {{reviewerName}}',
      body: SENTINEL_LINK,
      externalLinkExpected: true,
    }).reason).toBe(INVITATION_LINK_INVALID_REASON.UNRESOLVED_PLACEHOLDER);
  });

  test('repeated IDENTICAL copies of the same link are valid (button + plain-text fallback)', () => {
    expect(classifyInvitationLinks({
      body: `${SENTINEL_LINK}\n${SENTINEL_LINK}`,
      externalLinkExpected: true,
    })).toMatchObject({ valid: true, occurrenceCount: 2, jwts: ['send_time_token.pending_authority.not_live'] });
  });

  test('a valid link plus a malformed occurrence is MALFORMED, not silently sendable', () => {
    expect(classifyInvitationLinks({
      body: `${SENTINEL_LINK}\nAlso: https://reviews.example.org/external/review/garbage`,
      externalLinkExpected: true,
    }).reason).toBe(INVITATION_LINK_INVALID_REASON.MALFORMED);
  });

  test('token boundary: trailing prose punctuation is fine; an extended token is not', () => {
    // Sentence period directly after the link — ordinary prose, still valid.
    expect(classifyInvitationLinks({
      body: `Respond via ${SENTINEL_LINK}.`,
      externalLinkExpected: true,
    }).valid).toBe(true);
    // Query string directly after the link — valid.
    expect(classifyInvitationLinks({
      body: `${SENTINEL_LINK}?action=accept`,
      externalLinkExpected: true,
    }).valid).toBe(true);
    // A fourth base64url segment extends the token — no valid 3-segment prefix match.
    expect(classifyInvitationLinks({
      body: 'https://reviews.example.org/external/review/a1.b2.c3.d4',
      externalLinkExpected: true,
    }).reason).toBe(INVITATION_LINK_INVALID_REASON.MALFORMED);
  });

  test('template-save validation requires the literal externalLink placeholder', () => {
    expect(validateInvitationTemplateForSave({ subject: 'Invitation', body: 'Hardcoded link' }).valid).toBe(false);
    expect(validateInvitationTemplateForSave({ subject: 'Invitation', body: 'Use {{externalLink}}' }).valid).toBe(true);
  });
});
