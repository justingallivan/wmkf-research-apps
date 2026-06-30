/**
 * @jest-environment node
 *
 * Regression for Codex P1: the manual reviewer-invite draft path
 * (render-emails.js → email-generator.buildTemplateData → {{recipientName}})
 * must not leak whitespace artifacts from the stored `wmkf_name`.
 *
 * render-emails.js normalizes `person.wmkf_name` at the origin before building
 * the `candidate`, so the {{recipientName}} token renders clean. As defense-in-
 * depth, parseRecipientName (the single token chokepoint) also display-normalizes
 * its input, so even a raw name reaching buildTemplateData renders clean.
 */

const { ContactParser } = require('../../lib/utils/contact-parser');
const { buildTemplateData } = require('../../lib/utils/email-generator');

describe('render-emails recipientName normalization', () => {
  test('normalized candidate name yields a clean {{recipientName}} token', () => {
    const candidate = { name: ContactParser.normalizeDisplayName('Test Case ') };
    const data = buildTemplateData(candidate, {}, {});
    expect(data.recipientName).toBe('Test Case');
  });

  test('internal doubled whitespace is collapsed at the origin', () => {
    const candidate = { name: ContactParser.normalizeDisplayName('Test  Case') };
    const data = buildTemplateData(candidate, {}, {});
    expect(data.recipientName).toBe('Test Case');
  });

  test('defense-in-depth: a raw name reaching buildTemplateData is still cleaned', () => {
    // parseRecipientName normalizes at entry, so even without the render-emails
    // origin fix the token does not leak (no-honorific path previously left
    // trailing whitespace in cleanName).
    expect(buildTemplateData({ name: 'Test Case ' }, {}, {}).recipientName).toBe('Test Case');
    expect(buildTemplateData({ name: 'Dr. Jane  Smith ' }, {}, {}).recipientName).toBe('Jane Smith');
  });
});
