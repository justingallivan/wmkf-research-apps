/**
 * Focused compatibility checks for security-driven dependency overrides.
 *
 * @jest-environment node
 */

describe('security dependency compatibility', () => {
  it('preserves the honorarium UUID-v5 identity contract with the real uuid package', async () => {
    const { v5: uuidv5 } = await import('uuid');
    const namespace = 'b1d9f0c2-4a3e-5c6d-8e7f-0a1b2c3d4e5f';

    expect(uuidv5('sug-1111', namespace)).toBe('ff022dc4-f4cf-535b-a697-05ae01730958');
  });

  it('keeps ExcelJS conditional-format UUID generation working', async () => {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Compatibility');
    sheet.getCell('A1').value = 1;
    sheet.addConditionalFormatting({
      ref: 'A1',
      rules: [{
        type: 'expression',
        formulae: ['A1>0'],
        style: { font: { bold: true } },
      }],
    });

    const bytes = await workbook.xlsx.writeBuffer();
    const roundTripped = new ExcelJS.Workbook();
    await roundTripped.xlsx.load(bytes);

    expect(roundTripped.getWorksheet('Compatibility').conditionalFormattings).toHaveLength(1);
  });

  it('provides both brace-expansion APIs and bounds exploit-class output length', () => {
    const legacyExpand = require('brace-expansion');
    const chainedGroups = '{a,b}'.repeat(100);
    const pathologicalDepth = '{a,b}'.repeat(1_500);
    const options = { max: 1_000, maxLength: 1_000 };

    expect(typeof legacyExpand).toBe('function');
    expect(legacyExpand('{a,b}')).toEqual(['a', 'b']);
    expect(legacyExpand.expand('{1..2}')).toEqual(['1', '2']);

    const bounded = legacyExpand(chainedGroups, options);
    const totalLength = bounded.reduce((sum, value) => sum + value.length, 0);
    expect(totalLength).toBeLessThanOrEqual(options.maxLength);
    expect(legacyExpand(pathologicalDepth)).toEqual([pathologicalDepth]);
  });
});
