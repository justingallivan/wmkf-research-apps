/** Saved-revision workbook. Text is always a string cell, never an Excel formula. */
import ExcelJS from 'exceljs';
import { gradeAt } from './assessments.js';
import { calculateCumulativeTotals } from './calculations.js';

export async function buildRankingWorkbook({
  snapshot,
  collective,
  roundId,
  revealId,
  exportedAt,
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WMKF Proposal Ranking';
  const provenance = [
    `Cycle ${snapshot.cycleCode}`,
    `Round ${roundId}`,
    `Reveal ${revealId}`,
    `Group revision ${collective.version}`,
    `Exported ${exportedAt}`,
  ];
  const group = workbook.addWorksheet('Group recommendation');
  const individuals = workbook.addWorksheet('Individual assessments');
  for (const sheet of [group, individuals]) {
    sheet.addRow(provenance);
    sheet.addRow([]);
    sheet.views = [{ state: 'frozen', ySplit: 3 }];
  }
  group.addRow([
    'Position',
    'Section',
    'Request',
    'Institution',
    'Proposal',
    'Program',
    'Geography',
    'Amount',
    'Cumulative amount',
    'Currency',
    'Reviewer mean',
    'Starting mean rank',
    'Research award count',
    'Latest award year',
    'Research history status',
  ]);
  individuals.addRow([
    'PD',
    'Individual rank',
    'Grade',
    'Confidence',
    'Request',
    'Institution',
    'Proposal',
    'Program',
    'Round',
    'Reveal',
    'Reviewer mean',
  ]);
  const byId = new Map(
    snapshot.proposals.map((p) => [
      p.requestId,
      { ...p, currencyCode: p.currency?.code || null },
    ]),
  );
  const totals = calculateCumulativeTotals(collective.order, byId);
  collective.order.forEach((id, index) => {
    const p = byId.get(id);
    const factor = 10 ** (p.currency?.precision ?? 2);
    const section =
      index < collective.boundaries[0]
        ? 'Recommend funding'
        : index < collective.boundaries[1]
          ? 'Alternates'
          : 'Do not recommend';
    const history = p.researchFunding;
    group.addRow([
      index + 1,
      section,
      String(p.requestNumber || ''),
      String(p.organization || ''),
      String(p.title || ''),
      p.programKey,
      p.institutionGeography || 'Unknown',
      p.amountMinorUnits == null ? null : p.amountMinorUnits / factor,
      totals[index].cumulativeMinorUnits == null
        ? null
        : totals[index].cumulativeMinorUnits / factor,
      p.currency?.code || '',
      p.score?.mean ?? null,
      collective.baseline.scores[id].averageRank,
      ['available', 'provisional'].includes(history?.status)
        ? history.qualifyingGrantCount
        : null,
      ['available', 'provisional'].includes(history?.status)
        ? history.latestAwardYear
        : null,
      history?.status || 'unavailable',
    ]);
  });
  for (const pd of collective.individuals)
    pd.order.forEach((id, index) => {
      const p = byId.get(id);
      individuals.addRow([
        String(pd.name),
        index + 1,
        gradeAt(index, pd.boundaries),
        pd.confidence[id],
        String(p.requestNumber || ''),
        String(p.organization || ''),
        String(p.title || ''),
        p.programKey,
        roundId,
        revealId,
        p.score?.mean ?? null,
      ]);
    });
  for (const sheet of [group, individuals]) {
    sheet.getRow(3).font = { bold: true };
    sheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: sheet.rowCount, column: sheet.columnCount },
    };
    sheet.columns.forEach((column, index) => {
      column.width = index === 4 ? 45 : 22;
    });
    sheet.eachRow((row) => {
      row.alignment = { vertical: 'top', wrapText: true };
    });
  }
  group.getColumn(8).numFmt = '#,##0.00';
  group.getColumn(9).numFmt = '#,##0.00';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
