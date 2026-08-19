/**
 * @jest-environment node
 */

const {
  classifyStructuralInstitutionSameness,
  normalizeStructuralTokens,
} = require('../../lib/services/institution-structural-sameness');
const fs = require('fs');
const path = require('path');

const classify = (left, right) => classifyStructuralInstitutionSameness(left, right);

describe('provider-independent Tier-0 institution sameness', () => {
  test('normalizes punctuation and hyphens as word boundaries', () => {
    expect(normalizeStructuralTokens('Lamont-Doherty Earth Observatory'))
      .toBe('lamont doherty earth observatory');
    expect(classify(
      'University of California, Los Angeles',
      'University of California Los Angeles',
    )).toMatchObject({ verdict: 'same', reasonCode: 'identical_organization_tokens' });
  });

  test('auto-clears the captured Lamont-Doherty address decoration', () => {
    expect(classify(
      'Lamont-Doherty Earth Observatory, Columbia University, Palisades, NY 10964.',
      'Lamont Doherty Earth Observatory, Columbia University',
    )).toMatchObject({
      verdict: 'same',
      disposition: 'auto_clear',
      reasonCode: 'same_organization_with_safe_decoration',
      ignoredSuffix: ['Palisades', 'NY 10964.'],
    });
  });

  test.each([
    [
      'Department of Earth, Atmospheric, and Planetary Science, Purdue University, West Lafayette, IN 47907.',
      'Purdue University',
    ],
    [
      'Department of Microbiology, Harvard Medical School, Boston, MA, USA.',
      'Harvard Medical School',
    ],
    [
      'Department of Bioengineering, Stanford University, Stanford, CA 94305.',
      'Stanford University',
    ],
    [
      'Department of Chemistry and Biochemistry, University of California, Santa Barbara, Santa Barbara, United States.',
      'University of California Santa Barbara',
    ],
  ])('auto-clears a full institution core with academic and locality decoration', (evidence, recorded) => {
    expect(classify(evidence, recorded)).toMatchObject({
      verdict: 'same',
      disposition: 'auto_clear',
      remedyId: null,
    });
  });

  test.each([
    ['University of California, Los Angeles', 'University of California'],
    ['University of Texas, Dallas', 'University of Texas'],
    ['University of Wisconsin, Madison', 'University of Wisconsin'],
  ])('does not collapse a campus into its bare parent: %s vs %s', (campus, parent) => {
    expect(classify(campus, parent)).toMatchObject({
      verdict: 'insufficient',
      disposition: 'surface',
    });
  });

  test.each([
    ['University of California, Los Angeles', 'University of California, San Diego'],
    ['University of Texas, Austin', 'University of Texas, Dallas'],
    ['University of Wisconsin, Madison', 'University of Wisconsin, Milwaukee'],
    ['Department of Geology, University of Kansas, Lawrence, KS, USA.', 'University of Pennsylvania'],
  ])('never clears distinct institutions: %s vs %s', (left, right) => {
    expect(classify(left, right)).toMatchObject({
      verdict: 'insufficient',
      disposition: 'surface',
    });
  });

  test('does not collapse a school or institute into its parent university', () => {
    expect(classify(
      'Department of Biochemistry, Duke University School of Medicine, Durham, NC, USA.',
      'Duke University',
    )).toMatchObject({ verdict: 'insufficient', disposition: 'surface' });
  });

  test('does not ignore a second organization in a semicolon-delimited affiliation', () => {
    expect(classify(
      'Department of Biochemistry, University of California, San Francisco, CA; Howard Hughes Medical Institute',
      'University of California, San Francisco',
    )).toMatchObject({ verdict: 'insufficient', disposition: 'surface' });
  });

  test('does not misread an organization acronym as locality decoration', () => {
    expect(classify(
      'Stanford University, NIH, Bethesda, MD',
      'Stanford University',
    )).toMatchObject({ verdict: 'insufficient', disposition: 'surface' });
  });

  test('does not ignore a named organization before an address suffix', () => {
    expect(classify(
      'Stanford University, Genentech, South San Francisco, CA 94080',
      'Stanford University',
    )).toMatchObject({ verdict: 'insufficient', disposition: 'surface' });
  });

  test('missing operands fail closed with a real remedy id', () => {
    expect(classify(null, 'Stanford University')).toEqual({
      verdict: 'insufficient',
      disposition: 'surface',
      reasonCode: 'missing_institution_operand',
      remedyId: 'confirm_identity',
    });
  });

  test('classification is symmetric', () => {
    const decorated = 'Department of Bioengineering, Stanford University, Stanford, CA 94305.';
    const recorded = 'Stanford University';
    expect(classify(decorated, recorded)).toEqual(classify(recorded, decorated));
  });

  test('never auto-clears a distinct or related-surface pair in the full frozen pair corpus', () => {
    const caseDir = path.join(process.cwd(), 'benchmarks/institution-pair-consistency/cases');
    const rows = fs.readdirSync(caseDir)
      .filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) => fs.readFileSync(path.join(caseDir, name), 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line)));
    expect(rows.length).toBeGreaterThanOrEqual(157);
    const forbiddenClears = rows.filter((row) => (
      row.expected !== 'same'
      && classify(row.left, row.right).disposition === 'auto_clear'
    ));
    expect(forbiddenClears).toEqual([]);
  });
});
