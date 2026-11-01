import {
  EDITABLE_TEXT_DEFAULTS,
  EDITABLE_TEXT_GROUPS,
} from '../../shared/config/editableTextDefaults';
import {
  DELIBERATION_SHARE_SEED_BRIEFING_COPY,
  DELIBERATION_SHARE_SEED_SUBJECT,
  renderDeliberationShareSubject,
} from '../../shared/config/deliberationShareEmail';

describe('editableTextDefaults catalog grouping metadata', () => {
  const validGroupIds = new Set(EDITABLE_TEXT_GROUPS.map((g) => g.id));

  test('EDITABLE_TEXT_GROUPS has the expected ordered ids', () => {
    expect(EDITABLE_TEXT_GROUPS.map((g) => g.id)).toEqual(['reviewers', 'grantees', 'applicants', 'internal', 'labels']);
    EDITABLE_TEXT_GROUPS.forEach((g) => {
      expect(typeof g.title).toBe('string');
      expect(g.title.length).toBeGreaterThan(0);
      expect(typeof g.description).toBe('string');
      expect(g.description.length).toBeGreaterThan(0);
    });
  });

  test.each(EDITABLE_TEXT_DEFAULTS.map((entry) => [entry.key, entry]))(
    '%s has a valid group, emailKey, and emailLabel',
    (key, entry) => {
      expect(validGroupIds.has(entry.group)).toBe(true);
      expect(typeof entry.emailKey).toBe('string');
      expect(entry.emailKey.length).toBeGreaterThan(0);
      expect(typeof entry.emailLabel).toBe('string');
      expect(entry.emailLabel.length).toBeGreaterThan(0);
      expect(entry.key.startsWith(`${entry.emailKey}.`)).toBe(true);
    },
  );

  test('Presentation materials invitation and reminder keys are grouped with applicant-facing mail and preserve their required tokens', () => {
    const keys = [
      'email.site_visit_materials_invite.subject',
      'email.site_visit_materials_invite.body',
      'email.site_visit_materials_reminder.subject',
      'email.site_visit_materials_reminder.body',
    ];
    const entries = keys.map((key) => EDITABLE_TEXT_DEFAULTS.find((entry) => entry.key === key));
    expect(entries.every(Boolean)).toBe(true);
    expect(entries.map((entry) => entry.emailLabel)).toEqual([
      'Presentation materials invitation', 'Presentation materials invitation',
      'Presentation materials reminder', 'Presentation materials reminder',
    ]);
    expect(entries.map((entry) => entry.label)).toEqual([
      'Presentation materials invitation subject', 'Presentation materials invitation body',
      'Presentation materials reminder subject', 'Presentation materials reminder body',
    ]);
    expect(entries.map((entry) => entry.group)).toEqual(['applicants', 'applicants', 'applicants', 'applicants']);
    expect(entries.map((entry) => entry.emailKey)).toEqual([
      'email.site_visit_materials_invite', 'email.site_visit_materials_invite',
      'email.site_visit_materials_reminder', 'email.site_visit_materials_reminder',
    ]);
    expect(entries[1].placeholders).toEqual(expect.arrayContaining([
      '{{proposalTitle}}', '{{institution}}', '{{visitDate}}', '{{dueDate}}',
      '{{checklist}}', '{{uploadLink}}', '{{signature}}',
    ]));
    expect(entries[3].placeholders).toEqual(expect.arrayContaining([
      '{{missingItemsGrammar}}', '{{missingItems}}', '{{uploadLink}}', '{{signature}}',
    ]));
    expect(entries[1].requiredPlaceholders).toEqual(['{{checklist}}']);
    expect(entries[3].requiredPlaceholders).toEqual(['{{missingItems}}']);
    for (const entry of entries) {
      expect(entry.placeholders.every((placeholder) => /^\{\{[A-Za-z]+\}\}$/.test(placeholder))).toBe(true);
    }
  });

  test('Proposal review packet sharing fields are paired beside Discussion session agenda defaults', () => {
    const subject = EDITABLE_TEXT_DEFAULTS.find((entry) => entry.key === 'email.deliberation_share.subject');
    const body = EDITABLE_TEXT_DEFAULTS.find((entry) => entry.key === 'email.deliberation_share.body');
    const briefingKeys = [
      'email.deliberation_share.briefing_heading',
      'email.deliberation_share.briefing_link_text',
      'email.deliberation_share.briefing_description',
      'email.deliberation_share.briefing_expiry_lead_in',
      'email.deliberation_share.review_bundle_link_text',
    ];
    const briefingEntries = briefingKeys.map((key) => EDITABLE_TEXT_DEFAULTS.find((entry) => entry.key === key));
    expect(subject).toMatchObject({
      label: 'Proposal review packet sharing subject',
      description: expect.stringContaining('blank or missing shared value retains the built-in subject'),
    });
    expect(body).toMatchObject({
      label: 'Proposal review packet sharing message',
      description: expect.stringContaining('blank or missing shared value retains the built-in message'),
    });
    expect(subject).toMatchObject({
      group: 'internal',
      emailKey: 'email.deliberation_share',
      emailLabel: 'Proposal review packet sharing',
      placeholders: ['{{requestNumber}}'],
      multiline: false,
    });
    expect(body).toMatchObject({
      group: 'internal',
      emailKey: 'email.deliberation_share',
      emailLabel: 'Proposal review packet sharing',
      placeholders: [],
      multiline: true,
    });
    expect(briefingEntries.every(Boolean)).toBe(true);
    expect(briefingEntries.map((entry) => entry.label)).toEqual([
      'Proposal review packet heading', 'Proposal review packet link text',
      'Proposal review packet description', 'Proposal review packet expiry wording',
      'Review bundle link text',
    ]);
    briefingEntries.forEach((entry) => {
      expect(entry).toMatchObject({
        group: 'internal',
        emailKey: 'email.deliberation_share',
        emailLabel: 'Proposal review packet sharing',
        placeholders: [],
        multiline: false,
      });
    });
    expect(DELIBERATION_SHARE_SEED_BRIEFING_COPY).toEqual({
      heading: 'Proposal review packet:',
      linkText: 'Open the proposal review packet',
      description: expect.stringContaining('presentation materials'),
      expiryLeadIn: 'The link expires on',
      reviewBundleLinkText: 'Download all reviews (PDF)',
    });
  });

  test('Proposal review packet subject replaces the request token and removes fallback punctuation when no number exists', () => {
    expect(renderDeliberationShareSubject(DELIBERATION_SHARE_SEED_SUBJECT, '1002912'))
      .toBe('Proposal review packet — 1002912');
    expect(renderDeliberationShareSubject(DELIBERATION_SHARE_SEED_SUBJECT, null))
      .toBe('Proposal review packet');
  });
});
