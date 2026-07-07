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

describe('greeting surname handling', () => {
  test('trailing generational/degree suffixes are not used as the surname', () => {
    expect(buildTemplateData({ name: 'Kevin Weeks Jr.' }, {}, {}).greeting).toBe('Dear Dr. Weeks');
    expect(buildTemplateData({ name: 'Jane Smith III' }, {}, {}).greeting).toBe('Dear Dr. Smith');
    expect(buildTemplateData({ name: 'John Doe PhD' }, {}, {}).greeting).toBe('Dear Dr. Doe');
  });

  test('an empty/degenerate name falls back to a name-agnostic greeting', () => {
    expect(buildTemplateData({ name: '' }, {}, {}).greeting).toBe('Dear Reviewer');
    expect(buildTemplateData({ name: '   ' }, {}, {}).greeting).toBe('Dear Reviewer');
  });

  test('an ordinary name is unaffected', () => {
    expect(buildTemplateData({ name: 'Dr. Jane Smith' }, {}, {}).greeting).toBe('Dear Dr. Smith');
  });
});

describe('proposalAbstract soft-unwrap', () => {
  // Fixed-column hard-wrap: long lines broken mid-sentence (the failure the
  // owner reported). These reflow to a single flowing line.
  test('fixed-column hard-wraps (long mid-sentence lines) reflow to spaces', () => {
    const abstract =
      'Quantum tunneling is a physical process in which a particle such as an electron or an\n' +
      'atom can tunnel through a potential barrier without ever having the necessary energy.';
    const data = buildTemplateData({ name: 'Jane Smith' }, { abstract }, {});
    expect(data.proposalAbstract).toBe(
      'Quantum tunneling is a physical process in which a particle such as an electron or an ' +
      'atom can tunnel through a potential barrier without ever having the necessary energy.'
    );
    expect(data.proposalAbstract).not.toContain('\n');
  });

  // A fully hard-wrapped block with NO blank lines (real case: request 1002794),
  // where some wrapped lines happen to end a sentence right at the wrap column.
  // Those sentence-ends are wrap coincidences, not paragraph breaks — the whole
  // block must flow to continuous prose with no invented <br>s.
  test('a fully-wrapped no-blank-line block flows to one paragraph (no invented breaks)', () => {
    const abstract =
      'Quantum tunneling is a physical process in which a particle, such as an electron or an\n' +
      'atom, can tunnel through a potential barrier without the necessary energy. It underpins\n' +
      'many fundamental phenomena in modern science, from fusion to scanning tunneling microscopy.\n' +
      'Multiple Nobel Prizes were awarded to tunneling discoveries, including the most recent one.\n' +
      'In this proposal the PI will introduce a new approach to measure the tunneling time using a\n' +
      'genuine pump-probe measurement, closing a critical loophole left open by previous studies.';
    const data = buildTemplateData({ name: 'Jane Smith' }, { abstract }, {});
    expect(data.proposalAbstract).not.toContain('\n');
  });

  // The real over-collapse risk found by probing 40 live abstracts: some
  // applicants separate paragraphs with a SINGLE newline (no blank line), each
  // ending a sentence. A naive collapse merges them; this must NOT.
  test('single-newline paragraph separators (sentence-ending) are preserved', () => {
    const abstract =
      'The project will expand access to diagnostic imaging for the surrounding community.\n' +
      'A second, distinct goal is to train and retain local radiology technicians on site.';
    const data = buildTemplateData({ name: 'Jane Smith' }, { abstract }, {});
    expect(data.proposalAbstract).toContain('\n');
    expect(data.proposalAbstract.split('\n')).toHaveLength(2);
  });

  // A short line (e.g. a header) keeps its break even without ending punctuation.
  test('a short line break (header-style) is preserved', () => {
    const abstract = 'Overall Goal\nEliminate the remaining start-up obligations and secure the capital base.';
    const data = buildTemplateData({ name: 'Jane Smith' }, { abstract }, {});
    expect(data.proposalAbstract.startsWith('Overall Goal\n')).toBe(true);
  });

  // Blank-line paragraphs stay separated; internal hard-wraps within each reflow.
  test('blank-line paragraphs are preserved while internal wraps reflow', () => {
    const abstract =
      'This first paragraph is long enough that its opening line clearly exceeds the wrap\n' +
      'width and then finishes on a second line.\n\n' +
      'This second paragraph likewise runs well past the wrap column on its first line and\n' +
      'then completes on its own second line.';
    const data = buildTemplateData({ name: 'Jane Smith' }, { abstract }, {});
    const paras = data.proposalAbstract.split('\n\n');
    expect(paras).toHaveLength(2);
    expect(paras[0]).not.toContain('\n');
    expect(paras[1]).not.toContain('\n');
  });

  test('an empty abstract stays empty', () => {
    expect(buildTemplateData({ name: 'Jane Smith' }, {}, {}).proposalAbstract).toBe('');
  });
});
