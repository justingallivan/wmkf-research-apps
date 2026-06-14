/**
 * Reviewer "hold step" chunk 6 — default email copy for the new template types.
 * mergeTemplates iterates TEMPLATE_TYPES and references DEFAULT_TEMPLATES[type], so a
 * type listed without a default would throw — these tests pin that invariant plus the
 * placeholders the hold/finalize flow depends on.
 */
const {
  TEMPLATE_TYPES,
  TEMPLATE_TYPE_LABELS,
  DEFAULT_TEMPLATES,
  mergeTemplates,
} = require('../../shared/components/reviewers/email-template-store');

describe('email-template-store — hold + finalize copy (chunk 6)', () => {
  test('TEMPLATE_TYPES includes hold and finalize', () => {
    expect(TEMPLATE_TYPES).toEqual(expect.arrayContaining(['hold', 'finalize']));
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

  test('hold + finalize bodies carry the {{externalLink}} placeholder (magic link → portal)', () => {
    expect(DEFAULT_TEMPLATES.hold.body).toContain('{{externalLink}}');
    expect(DEFAULT_TEMPLATES.finalize.body).toContain('{{externalLink}}');
  });

  test('hold copy is materials-free / no-commitment (no proposal-materials promise)', () => {
    // The hold ask must not imply materials are attached/available yet.
    expect(DEFAULT_TEMPLATES.hold.body.toLowerCase()).not.toMatch(/attached proposal|download the proposal|proposal materials are/);
    expect(DEFAULT_TEMPLATES.hold.body.toLowerCase()).toContain('hold');
  });

  test('hold copy conditionalizes the calendar claim (the .ics can degrade to null — Codex chunk-6 #6)', () => {
    // Must NOT unconditionally assert an attachment ("is attached to this message").
    expect(DEFAULT_TEMPLATES.hold.body).not.toMatch(/calendar hold is attached to this message/i);
    // It conditionalizes it instead.
    expect(DEFAULT_TEMPLATES.hold.body.toLowerCase()).toContain('where a panel date');
  });

  test('mergeTemplates returns all types, stored overrides win, defaults fill gaps', () => {
    const merged = mergeTemplates({ hold: { subject: 'Custom hold' } });
    expect(merged.hold.subject).toBe('Custom hold');
    expect(merged.hold.body).toBe(DEFAULT_TEMPLATES.hold.body); // gap filled from default
    expect(merged.finalize.subject).toBe(DEFAULT_TEMPLATES.finalize.subject);
    for (const t of TEMPLATE_TYPES) expect(merged[t]).toBeDefined();
  });
});
