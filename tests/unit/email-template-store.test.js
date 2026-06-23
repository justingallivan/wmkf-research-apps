/**
 * Reviewer email template store invariants. mergeTemplates iterates TEMPLATE_TYPES
 * and references DEFAULT_TEMPLATES[type], so a type listed without a default would
 * throw.
 */
const {
  TEMPLATE_TYPES,
  TEMPLATE_TYPE_LABELS,
  DEFAULT_TEMPLATES,
  mergeTemplates,
} = require('../../shared/components/reviewers/email-template-store');

describe('email-template-store', () => {
  test('TEMPLATE_TYPES excludes retired hold/finalize templates', () => {
    expect(TEMPLATE_TYPES).toEqual(['invitation', 'materials', 'followup', 'thankyou']);
    expect(TEMPLATE_TYPES).not.toEqual(expect.arrayContaining(['hold', 'finalize']));
    expect(DEFAULT_TEMPLATES.hold).toBeUndefined();
    expect(DEFAULT_TEMPLATES.finalize).toBeUndefined();
  });

  test('every TEMPLATE_TYPE has a default {subject, body} and a label (mergeTemplates invariant)', () => {
    for (const t of TEMPLATE_TYPES) {
      expect(typeof DEFAULT_TEMPLATES[t]?.subject).toBe('string');
      expect(DEFAULT_TEMPLATES[t].subject.length).toBeGreaterThan(0);
      expect(typeof DEFAULT_TEMPLATES[t]?.body).toBe('string');
      expect(DEFAULT_TEMPLATES[t].body.length).toBeGreaterThan(0);
      expect(typeof TEMPLATE_TYPE_LABELS[t]).toBe('string');
    }
  });

  test('mergeTemplates returns all types, stored overrides win, defaults fill gaps', () => {
    const merged = mergeTemplates({ materials: { subject: 'Custom materials' } });
    expect(merged.materials.subject).toBe('Custom materials');
    expect(merged.materials.body).toBe(DEFAULT_TEMPLATES.materials.body); // gap filled from default
    expect(merged.hold).toBeUndefined();
    expect(merged.finalize).toBeUndefined();
    for (const t of TEMPLATE_TYPES) expect(merged[t]).toBeDefined();
  });
});
