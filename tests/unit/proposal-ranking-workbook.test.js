import ExcelJS from 'exceljs';
import { buildRankingWorkbook } from '../../lib/services/proposal-ranking/workbook';
test('two sheets use numeric ranks and amounts, literal text, one reveal and no sentiment', async () => {
  const snapshot = {
    cycleCode: 'J27',
    proposals: [
      {
        requestId: 'a',
        requestNumber: '1',
        organization: '=HYPERLINK("evil")',
        title: '+formula',
        programKey: 'mr',
        amountMinorUnits: 12550,
        currency: { code: 'USD', precision: 2 },
        score: { mean: 4 },
        researchFunding: {
          status: 'provisional',
          qualifyingGrantCount: 2,
          latestAwardYear: 2024,
        },
      },
    ],
  };
  const collective = {
    order: ['a'],
    boundaries: [1, 1],
    version: 3,
    baseline: { scores: { a: { averageRank: 1 } } },
    individuals: [
      {
        name: 'Alice',
        order: ['a'],
        boundaries: [1, 1],
        confidence: { a: 'not-sure' },
      },
    ],
    sentiment: { headline: 'SECRET QUOTE' },
  };
  const bytes = await buildRankingWorkbook({
    snapshot,
    collective,
    roundId: 'round',
    revealId: 'reveal',
    exportedAt: 'time',
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  expect(workbook.worksheets.map((s) => s.name)).toEqual([
    'Group recommendation',
    'Individual assessments',
  ]);
  const group = workbook.worksheets[0];
  expect(group.getCell('A4').value).toBe(1);
  expect(group.getCell('H4').value).toBe(125.5);
  expect(group.getCell('M4').value).toBe(2);
  expect(group.getCell('O4').value).toBe('provisional');
  expect(workbook.worksheets[1].getCell('K4').value).toBe(4);
  expect(group.getCell('D4').type).toBe(ExcelJS.ValueType.String);
  expect(group.getCell('D4').value).toBe('=HYPERLINK("evil")');
  expect(JSON.stringify(workbook.model)).not.toContain('SECRET QUOTE');
  expect(workbook.worksheets[1].getCell('D4').value).toBe('not-sure');
});
