/**
 * Reviewer email template store invariants (S297 two-layer model: admin org
 * default + per-PD override). The shipped default copy lives in the seed file
 * (lib/seed/email-defaults/reviewer-templates.js), NOT in the store — the store
 * resolves per-PD override over the admin default with no runtime code fallback.
 */
const {
  TEMPLATE_TYPES,
  TEMPLATE_TYPE_LABELS,
  EMPTY_TEMPLATES,
  mergeTemplates,
  toOverrides,
} = require('../../shared/components/reviewers/email-template-store');
const {
  REVIEWER_INVITATION_SEED_SUBJECT,
  REVIEWER_INVITATION_SEED_BODY,
  REVIEWER_MATERIALS_SEED_SUBJECT,
  REVIEWER_MATERIALS_SEED_BODY,
  REVIEWER_FOLLOWUP_SEED_SUBJECT,
  REVIEWER_FOLLOWUP_SEED_BODY,
  REVIEWER_THANKYOU_SEED_SUBJECT,
  REVIEWER_THANKYOU_SEED_BODY,
} = require('../../lib/seed/email-defaults/reviewer-templates');

const SEED_BY_TYPE = {
  invitation: { subject: REVIEWER_INVITATION_SEED_SUBJECT, body: REVIEWER_INVITATION_SEED_BODY },
  materials: { subject: REVIEWER_MATERIALS_SEED_SUBJECT, body: REVIEWER_MATERIALS_SEED_BODY },
  followup: { subject: REVIEWER_FOLLOWUP_SEED_SUBJECT, body: REVIEWER_FOLLOWUP_SEED_BODY },
  thankyou: { subject: REVIEWER_THANKYOU_SEED_SUBJECT, body: REVIEWER_THANKYOU_SEED_BODY },
};

describe('email-template-store', () => {
  test('TEMPLATE_TYPES excludes retired hold/finalize templates', () => {
    expect(TEMPLATE_TYPES).toEqual(['invitation', 'materials', 'followup', 'thankyou']);
    expect(TEMPLATE_TYPES).not.toEqual(expect.arrayContaining(['hold', 'finalize']));
  });

  test('EMPTY_TEMPLATES is a blank skeleton for every type', () => {
    for (const t of TEMPLATE_TYPES) {
      expect(EMPTY_TEMPLATES[t]).toEqual({ subject: '', body: '' });
      expect(typeof TEMPLATE_TYPE_LABELS[t]).toBe('string');
    }
  });

  test('seed file provides non-empty subject + body for every type', () => {
    for (const t of TEMPLATE_TYPES) {
      expect(typeof SEED_BY_TYPE[t].subject).toBe('string');
      expect(SEED_BY_TYPE[t].subject.length).toBeGreaterThan(0);
      expect(typeof SEED_BY_TYPE[t].body).toBe('string');
      expect(SEED_BY_TYPE[t].body.length).toBeGreaterThan(0);
    }
  });

  test('invitation seed carries the server-injected honorarium token (restored S297)', () => {
    expect(REVIEWER_INVITATION_SEED_BODY).toContain('{{customField:honorarium}}');
  });

  test('invitation seed carries the redesigned conflict, response, and campaign copy', () => {
    expect(REVIEWER_INVITATION_SEED_SUBJECT)
      .toBe('Action needed by {{respondBy}}: Review invitation from W. M. Keck Foundation');
    expect(REVIEWER_INVITATION_SEED_BODY).toContain(
      'from Principal Investigator {{piName}} ({{piInstitution}})',
    );
    expect(REVIEWER_INVITATION_SEED_BODY).toContain('{{externalLink}}');
    expect(REVIEWER_INVITATION_SEED_BODY).toContain('If we don’t hear from you by {{respondBy}}');
    expect(REVIEWER_INVITATION_SEED_BODY).toContain('1. You respond — by {{respondBy}}');
    expect(REVIEWER_INVITATION_SEED_BODY).toContain('2. We send the full proposal — around {{proposalDelivery}}');
    expect(REVIEWER_INVITATION_SEED_BODY).toContain('3. Your completed review is due — by {{reviewDue}}');
    expect(REVIEWER_INVITATION_SEED_BODY).not.toMatch(/estimated time|time estimate/i);
    expect(REVIEWER_INVITATION_SEED_BODY).not.toMatch(/respond to this email/i);
  });

  test('materials seed is concise and keeps the deadline, link, and signature placeholders', () => {
    expect(REVIEWER_MATERIALS_SEED_BODY).toBe(
      '{{greeting}},\n\n'
      + 'Please use the link to access the proposal materials and submit your completed review by {{reviewDueDate}}.\n\n'
      + '{{externalLink}}\n\n'
      + '{{signature}}',
    );
    expect(REVIEWER_MATERIALS_SEED_BODY).not.toMatch(/Thank you for agreeing|This link is unique|questions about the review process|time and expertise/);
  });

  test('mergeTemplates: per-PD override wins, admin default fills gaps, all types present', () => {
    const admin = SEED_BY_TYPE;
    const merged = mergeTemplates({ materials: { subject: 'Custom materials' } }, admin);
    expect(merged.materials.subject).toBe('Custom materials'); // override wins
    expect(merged.materials.body).toBe(admin.materials.body);   // gap filled from admin default
    expect(merged.invitation.subject).toBe(admin.invitation.subject); // untouched type = admin default
    for (const t of TEMPLATE_TYPES) expect(merged[t]).toBeDefined();
    expect(merged.hold).toBeUndefined();
  });

  test('mergeTemplates with no admin default degrades to blank (no runtime code fallback)', () => {
    const merged = mergeTemplates(null, null);
    for (const t of TEMPLATE_TYPES) {
      expect(merged[t]).toEqual({ subject: '', body: '' });
    }
  });

  test('toOverrides keeps only fields that differ from the admin default', () => {
    const admin = SEED_BY_TYPE;
    const edited = mergeTemplates(null, admin); // start equal to admin
    edited.followup = { subject: 'My follow-up', body: admin.followup.body }; // change one field
    const overrides = toOverrides(edited, admin);
    expect(overrides).toEqual({ followup: { subject: 'My follow-up' } }); // body equal → omitted
  });

  test('override round-trips through merge', () => {
    const admin = SEED_BY_TYPE;
    const edited = mergeTemplates(null, admin);
    edited.invitation = { subject: 'Hello', body: 'World' };
    const overrides = toOverrides(edited, admin);
    expect(mergeTemplates(overrides, admin)).toEqual(edited);
  });
});
