/**
 * @jest-environment node
 *
 * Detector + reflow for hard-wrapped proposal abstracts (lib/utils/abstract-format).
 * Calibrated against real abstracts (S340): a mid-sentence single newline is an
 * unambiguous hard-wrap artifact; sentence-ending / short-line / blank-line
 * breaks are intentional and must be preserved.
 */

const { hasAbstractWrapArtifacts, reflowAbstract, abstractNeedsReflow } = require('../../lib/utils/abstract-format');

describe('hasAbstractWrapArtifacts', () => {
  test('flags a fixed-column hard-wrap (line ends mid-sentence)', () => {
    const a = 'Quantum tunneling is a physical process in which a particle such as an\nelectron can tunnel through a barrier without the necessary energy.';
    expect(hasAbstractWrapArtifacts(a)).toBe(true);
  });

  test('does NOT flag clean single-line prose', () => {
    expect(hasAbstractWrapArtifacts('A single flowing sentence with no newlines at all.')).toBe(false);
  });

  test('does NOT flag single-newline paragraph separators (each ends a sentence)', () => {
    const a = 'The project expands access to diagnostic imaging.\nA second goal is to train local technicians.';
    expect(hasAbstractWrapArtifacts(a)).toBe(false);
  });

  test('does NOT flag blank-line paragraphs', () => {
    expect(hasAbstractWrapArtifacts('First paragraph.\n\nSecond paragraph.')).toBe(false);
  });

  test('empty / null are not flagged', () => {
    expect(hasAbstractWrapArtifacts('')).toBe(false);
    expect(hasAbstractWrapArtifacts(null)).toBe(false);
  });
});

describe('reflowAbstract', () => {
  test('fully-wrapped no-blank-line block flows to one paragraph (1002794 shape)', () => {
    const a =
      'Quantum tunneling is a physical process in which a particle, such as an electron or an\n' +
      'atom, can tunnel through a potential barrier without the necessary energy. It underpins\n' +
      'many fundamental phenomena in modern science, from fusion to scanning tunneling microscopy.\n' +
      'Multiple Nobel Prizes were awarded to tunneling discoveries, including the most recent one.\n' +
      'In this proposal the PI will introduce a new approach to measure the tunneling time using a\n' +
      'genuine pump-probe measurement, closing a critical loophole left open by previous studies.';
    expect(reflowAbstract(a)).not.toContain('\n');
  });

  test('single-newline paragraph separators are preserved', () => {
    const a =
      'The project will expand access to diagnostic imaging for the surrounding community.\n' +
      'A second, distinct goal is to train and retain local radiology technicians on site.';
    expect(reflowAbstract(a).split('\n')).toHaveLength(2);
  });

  test('a low-density mid-sentence wrap (short line, lowercase continuation) is joined', () => {
    // Regression: a single short mid-sentence break used to survive the reflow,
    // leaving a stray <br> the banner claimed was cleaned.
    const a = 'Our team of researchers\nwill investigate three aims. Aim one is complete.';
    const out = reflowAbstract(a);
    expect(out).toContain('Our team of researchers will investigate');
  });

  test('a header-style short line (capitalized continuation) keeps its break and is unchanged', () => {
    const a = 'Overall Goal\nEliminate the remaining start-up obligations and secure the capital base.';
    expect(reflowAbstract(a)).toBe(a); // unchanged -> the render gate must NOT flag it
  });

  test('blank-line paragraphs preserved; internal wraps reflow', () => {
    const a =
      'This first paragraph is long enough that its opening line clearly exceeds the wrap\n' +
      'width and then finishes on a second line.\n\n' +
      'This second paragraph likewise runs well past the wrap column on its first line and\n' +
      'then completes on its own second line.';
    const paras = reflowAbstract(a).split('\n\n');
    expect(paras).toHaveLength(2);
    expect(paras[0]).not.toContain('\n');
    expect(paras[1]).not.toContain('\n');
  });

  test('empty stays empty', () => {
    expect(reflowAbstract('')).toBe('');
    expect(reflowAbstract(null)).toBe('');
  });
});

describe('abstractNeedsReflow (render gate flag ⟺ reflow changes it)', () => {
  test('true for a hard-wrapped block (reflow would change it)', () => {
    const a = 'Our team of researchers\nwill investigate three aims. Aim one is complete.';
    expect(abstractNeedsReflow(a)).toBe(true);
  });

  test('false for a header-style intentional break (reflow leaves it alone)', () => {
    expect(abstractNeedsReflow('Overall Goal\nEliminate the remaining start-up obligations and secure it.')).toBe(false);
  });

  test('false for clean prose and for single-newline paragraph separators', () => {
    expect(abstractNeedsReflow('A single flowing sentence with no newlines.')).toBe(false);
    expect(abstractNeedsReflow('First paragraph ends here.\nSecond paragraph begins here.')).toBe(false);
  });

  test('false for empty / null', () => {
    expect(abstractNeedsReflow('')).toBe(false);
    expect(abstractNeedsReflow(null)).toBe(false);
  });
});
