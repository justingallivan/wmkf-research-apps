/**
 * build-research-copi-confirm-workbook.mjs — the owner's approval workbook for
 * Stage B of the Research Institution at Award backfill, built from a resolve
 * run (plan docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.2).
 * No Dataverse access; reads only files in --dir.
 *
 * Rows are approved by group where the evidence is strong (one decision per
 * group, with an Exclude? column for exceptions) and checked one by one only
 * where a person is needed (approvalBucket in scripts/lib/research-copi-stage-b.mjs).
 * Answers from an earlier workbook carry over by row key; --override sets an
 * answer the owner gave elsewhere ("<key>=Yes", comma-separated).
 *
 *   node scripts/build-research-copi-confirm-workbook.mjs --dir=<stage-b folder> \
 *     [--prior=<earlier confirm .xlsx>] [--override=<key>=<answer>,...] [--out=<file name>]
 *
 * Reads research-copi-iaa-resolve.jsonl and research-copi-iaa-review.xlsx from
 * --dir; writes research-copi-confirm-v2.xlsx there (names; keep it out of git).
 */

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { APPROVAL_GROUPS, approvalBucket } from './lib/research-copi-stage-b.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const DIR = arg('dir');
if (!DIR) { console.error('--dir=<folder with the resolve output> is required'); process.exit(2); }
const OUT = path.join(DIR, arg('out') || 'research-copi-confirm-v2.xlsx');
const repoAbs = path.resolve('.');
if (path.resolve(OUT).startsWith(`${repoAbs}${path.sep}`)) { console.error('The workbook holds names: write it outside the repository.'); process.exit(2); }

const lines = fs.readFileSync(path.join(DIR, 'research-copi-iaa-resolve.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => !x.meta);

async function sheetRows(file, onlyFirst = false) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out = [];
  for (const ws of onlyFirst ? [wb.worksheets[0]] : wb.worksheets) {
    const head = ws.getRow(1).values;
    ws.eachRow((r, i) => {
      if (i === 1) return;
      const row = { sheet: ws.name };
      head.forEach((h, k) => { if (h) row[h] = r.getCell(k).value ?? ''; });
      out.push(row);
    });
  }
  return out;
}
const review = new Map((await sheetRows(path.join(DIR, 'research-copi-iaa-review.xlsx'), true)).map((r) => [r.key, r]));

// Earlier answers: the first column of every sheet, keyed by the hidden `key` column.
const prior = new Map();
const priorFile = arg('prior');
if (priorFile) {
  for (const r of await sheetRows(priorFile)) {
    const answer = String(Object.values(r)[1] ?? '').trim();
    if (r.key && answer) prior.set(String(r.key), answer);
  }
}
for (const pair of (arg('override') || '').split(',').filter(Boolean)) {
  const at = pair.lastIndexOf('=');
  prior.set(pair.slice(0, at), pair.slice(at + 1));
}

const why = (v) => (v || '').split('+').filter(Boolean).map((s) => ({
  'pi-email-domain': 'email domain matches the PI',
  'domain-map': 'colleagues with this email domain are linked to it',
  'account-name': 'stated institution name',
  'contact-account': "contact's current account",
}[s] || s)).join('; ');
const what = (x) => (x.cohort === 'contact' ? 'Set contact current institution'
  : x.actions.includes('create-contact') ? 'New contact, added as co-PI'
    : x.actions.includes('link-proposed-contact') ? 'Same new contact as another row, added as co-PI'
      : x.actions.includes('create-junction-row') ? 'Existing contact, added as co-PI'
        : 'Already a co-PI; set institution only');
const firstLink = (web) => String(web || '').split('\n')[0].split(' — ').pop();

const groupRows = new Map(Object.keys(APPROVAL_GROUPS).map((g) => [g, []]));
const checks = [];
for (const x of lines) {
  const b = approvalBucket(x);
  const r = review.get(x.key) || {};
  const p = prior.get(x.key);
  // A group member you have not answered individually stays in its group; an
  // unanswered recorded row is checked on its own, since that group was reviewed row by row.
  if (b.group === 'recorded' && !p) checks.push({ type: 'recorded-unanswered', x, r });
  else if (b.group) groupRows.get(b.group).push({ x, r, p });
  for (const type of b.checks) checks.push({ type, x, r, p: type === 'web-suggestion' ? undefined : p });
}

const wb = new ExcelJS.Workbook();
const yesNo = (list = 'Yes,No,Unsure') => ({ type: 'list', allowBlank: true, formulae: [`"${list}"`], showErrorMessage: true, errorTitle: 'Choose one', error: `Pick one of: ${list}.` });
const sheet = (name, cols) => {
  const ws = wb.addWorksheet(name);
  ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.getColumn(cols.length).hidden = true;
  return ws;
};
const wrap = (ws) => ws.eachRow((row, i) => { if (i > 1) row.alignment = { vertical: 'top', wrapText: true }; });

// 1. Groups
const g1 = sheet('1. Approve groups', [['Approve?', 'c', 10], ['Group', 'g', 70], ['Rows', 'n', 7], ['Excluded so far', 'ex', 14], ['Note', 'note', 40], ['key', 'key', 8]]);
for (const [g, members] of groupRows) {
  if (!members.length) continue;
  const excluded = members.filter((m) => m.p && m.p !== 'Yes').length;
  // Every recorded member here already has your row-by-row answer (unanswered ones are checks).
  const recordedAllYes = g === 'recorded';
  g1.addRow({ c: recordedAllYes ? 'Yes' : '', g: APPROVAL_GROUPS[g], n: members.length, ex: excluded || '', note: recordedAllYes ? 'You answered these row by row on 2026-10-20' : '', key: `group|${g}` });
}
g1.eachRow((row, i) => { if (i > 1) row.getCell(1).dataValidation = yesNo('Yes,No'); });
wrap(g1);

// 2. Individual checks
const QUESTIONS = {
  'single-signal': (x, r) => [`Institution at Award: ${r['Proposed Institution at Award'] || ''}?`, `Based on ${why(x.iaaVia)} only`],
  'web-suggestion': (x, r) => [`New contact's current institution: ${r['Suggested account for new contact (web)'] || ''}?`, firstLink(r['Web results (current page)'])],
  'possible-duplicate': (x, r) => ['Already one of these contacts? If yes, say which in Note.', r['Possible existing contacts'] || ''],
  'contact-account-web': (x, r) => [`Current institution: latest award says ${r['Proposed contact account'] || '?'}, web says ${r['Suggested account for new contact (web)'] || 'several places'}. Which?`, firstLink(r['Web results (current page)'])],
  'recorded-unanswered': (x, r) => [`Institution at Award: ${r['Proposed Institution at Award'] || ''}?`, `Based on ${why(x.iaaVia)}`],
};
const LISTS = { 'possible-duplicate': 'Yes,No,Unsure', 'contact-account-web': 'Latest award,Web,Neither' };
const g2 = sheet('2. Check these', [['Answer', 'c', 14], ['Request', 'req', 10], ['Year', 'y', 6], ['Person', 'p', 26], ['Question', 'q', 60], ['Evidence or link', 'e', 50], ['Note', 'note', 30], ['key', 'key', 8]]);
const order = ['possible-duplicate', 'contact-account-web', 'single-signal', 'web-suggestion', 'recorded-unanswered'];
checks.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || `${a.r.Request}`.localeCompare(`${b.r.Request}`));
for (const ck of checks) {
  const [q, e] = QUESTIONS[ck.type](ck.x, ck.r);
  const row = g2.addRow({ c: ck.p || '', req: ck.r.Request, y: ck.r.Year, p: ck.r.Person, q, e, key: `${ck.type}|${ck.x.key}` });
  row.getCell(1).dataValidation = yesNo(LISTS[ck.type]);
}
wrap(g2);

// 3. Group members, for reference and exceptions
const g3 = sheet('3. Rows in each group', [['Exclude?', 'c', 10], ['Group', 'g', 24], ['Request', 'req', 10], ['Year', 'y', 6], ['Person', 'p', 26], ['What happens', 'w', 30], ['Institution', 'i', 34], ['Based on', 'b', 36], ['key', 'key', 8]]);
for (const [g, members] of groupRows) {
  for (const m of members.sort((a, b) => `${a.r.Request}`.localeCompare(`${b.r.Request}`))) {
    const row = g3.addRow({
      c: m.p && m.p !== 'Yes' ? 'Yes' : '', g, req: m.r.Request, y: m.r.Year, p: m.r.Person, w: what(m.x),
      i: m.x.cohort === 'contact' ? m.r['Proposed contact account'] : m.r['Proposed Institution at Award'],
      b: m.x.cohort === 'contact' ? m.r['Contact account from'] : why(m.x.iaaVia), key: m.x.key,
    });
    row.getCell(1).dataValidation = yesNo('Yes');
  }
}
wrap(g3);

await wb.xlsx.writeFile(OUT);
console.log(`Groups: ${[...groupRows].filter(([, m]) => m.length).map(([g, m]) => `${g} ${m.length}`).join(', ')}`);
console.log(`Checks: ${JSON.stringify(checks.reduce((t, c) => ({ ...t, [c.type]: (t[c.type] || 0) + 1 }), {}))}`);
console.log(`Carried answers: ${[...prior.keys()].filter((k) => lines.some((x) => x.key === k)).length}`);
console.log(`Wrote ${OUT}`);
