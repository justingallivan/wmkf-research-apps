/**
 * build-research-copi-staff-workbook.mjs — the staff review workbook for the
 * Stage B rows the owner does not judge by group (plan
 * docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.2).
 * A staff member works it in AkoyaGO; the agent reads the answers back into
 * the apply step by the hidden key column. No Dataverse access; reads only
 * files in --dir.
 *
 *   node scripts/build-research-copi-staff-workbook.mjs --dir=<stage-b folder> [--out=<file name>]
 *
 * Reads research-copi-iaa-resolve.jsonl and research-copi-iaa-review.xlsx from
 * --dir; writes research-copi-staff-review.xlsx there (names; keep it out of git).
 */

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { approvalBucket } from './lib/research-copi-stage-b.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const DIR = arg('dir');
if (!DIR) { console.error('--dir=<folder with the resolve output> is required'); process.exit(2); }
const OUT = path.join(DIR, arg('out') || 'research-copi-staff-review.xlsx');
const repoAbs = path.resolve('.');
if (path.resolve(OUT).startsWith(`${repoAbs}${path.sep}`)) { console.error('The workbook holds names: write it outside the repository.'); process.exit(2); }

const lines = fs.readFileSync(path.join(DIR, 'research-copi-iaa-resolve.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => !x.meta);

const text = (v) => (v && typeof v === 'object' ? v.text || v.hyperlink || '' : v ?? '');
const reviewWb = new ExcelJS.Workbook();
await reviewWb.xlsx.readFile(path.join(DIR, 'research-copi-iaa-review.xlsx'));
const review = new Map();
{
  const ws = reviewWb.worksheets[0];
  const head = ws.getRow(1).values;
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const row = {};
    head.forEach((h, k) => { if (h) row[h] = String(text(r.getCell(k).value)); });
    review.set(row.key, row);
  });
}

const why = (v) => (v || '').split('+').filter(Boolean).map((s) => ({
  'pi-email-domain': "the co-PI's email domain matches the PI's, so the applicant institution",
  'domain-map': 'other contacts with this email domain are linked to it',
  'account-name': 'the institution named in the proposal matches this account name',
  'contact-account': "the contact's current institution in AkoyaGO",
}[s] || s)).join('; ');
const webLinks = (v) => String(v || '').split('\n').filter(Boolean).slice(0, 3).join('\n');

// Sort each flagged row into one part.
const parts = { p1: [], p2: [], p3: [], p4: [] };
for (const x of lines) {
  const r = review.get(x.key) || {};
  const b = approvalBucket(x);
  if (x.class === 'possible-existing-contact') parts.p1.push({ x, r, kind: 'duplicate' });
  else if (x.class === 'is-pi' && x.cohort === 'extracted') parts.p1.push({ x, r, kind: 'is-pi' });
  else if (x.class === 'no-account-match' || x.class === 'conflicting-evidence') parts.p3.push({ x, r });
  else if (x.cohort === 'contact' && x.class !== 'ready') parts.p4.push({ x, r, kind: x.class });
  if (b.checks.includes('single-signal')) parts.p2.push({ x, r });
  if (b.checks.includes('web-suggestion')) parts.p4.push({ x, r, kind: 'web-suggestion' });
}
const byRequest = (a, b) => `${a.r.Request}`.localeCompare(`${b.r.Request}`) || `${a.r.Person}`.localeCompare(`${b.r.Person}`);
Object.values(parts).forEach((p) => p.sort(byRequest));

const wb = new ExcelJS.Workbook();
const list = (items) => ({ type: 'list', allowBlank: true, formulae: [`"${items.join(',')}"`], showErrorMessage: true, errorTitle: 'Choose one', error: `Pick one of: ${items.join(', ')}.` });
const sheet = (name, cols) => {
  const ws = wb.addWorksheet(name);
  ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } };
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 3 }];
  ws.getColumn(cols.length).hidden = true;
  return ws;
};
const finish = (ws, choices, answerCols = 3) => ws.eachRow((row, i) => {
  if (i === 1) return;
  row.alignment = { vertical: 'top', wrapText: true };
  row.getCell(1).dataValidation = list(choices);
  for (let c = 1; c <= answerCols; c += 1) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8DC' } };
});
const ANSWER = [['Decision', 'd', 22], ['Name as shown in AkoyaGO', 'n', 30], ['Notes', 'note', 30]];
const CONTEXT = [['Request', 'req', 10], ['Year', 'y', 6], ['Person', 'p', 24], ['Email in proposal', 'em', 28], ['Institution named in proposal', 'st', 30], ['Applicant on the request', 'ap', 28]];
const ctx = ({ r }) => ({ req: r.Request, y: r.Year, p: r.Person, em: r['Proposal email'], st: r['Stated institution'], ap: r.Applicant });

// ── How to ──────────────────────────────────────────────────────────────────
const howTo = wb.addWorksheet('How to');
howTo.getColumn(1).width = 120;
const HOW = [
  ['h', 'Research co-PI institution review'],
  ['', 'We are recording, for every Research award since 2017, which institution each co-PI was at when the award was made ("Institution at Award"). Most of the 188 co-PIs were matched automatically. The rows in this workbook are the ones the matching could not settle. Your answers are read back by a script that makes the changes in Dynamics, so please do not create contacts, Personnel rows or Institution at Award values yourself for parts 1–4.'],
  ['', 'Fill in only the yellow columns. Pick the Decision from the drop-down. When the Decision asks for a name, type the contact or account name exactly as AkoyaGO shows it (copy and paste is best). Use Notes for anything unusual. Leave a row blank if you run out of time; blank rows are simply not written.'],
  ['', 'Do not add, delete or re-sort rows, and do not unhide columns. A hidden column links each row back to our data.'],
  ['h', 'Finding things in AkoyaGO'],
  ['', 'A request: search the request number (for example 990039). The proposal PDF and other application files are in the request\'s documents. The cover page, the personnel or key-personnel section and the biosketches name each co-PI and their institution.'],
  ['', 'A contact: search the person\'s last name, then compare first name, email addresses (a contact can hold up to three), institution and the requests they are linked to.'],
  ['', 'An account (institution): search part of the name. Institutions change names and merge (for example "Fred Hutchinson Cancer Research Center" is now "Fred Hutchinson Cancer Center"), so also try short forms and check the account\'s other-name fields. Pick the account that represents the institution as a whole unless the proposal clearly names a separate affiliated institute that has its own account.'],
  ['', 'If these steps do not match what you see in AkoyaGO, use whatever search you normally use; the questions are what matter.'],
  ['h', `Part 1 — Is this an existing contact? (${parts.p1.length} rows)`],
  ['', 'The proposal names this person as a co-PI, but AkoyaGO already has a contact with the same or a similar name and we could not tell whether it is the same person. The "Possible matches" column lists the candidates.'],
  ['', 'Same person → choose "Same person" and paste the matching contact\'s name and email in the name column. Different person → "New person". If the proposal does not really name this person as a co-PI → "Not a co-PI". Unsure → "Can\'t tell".'],
  ['', 'Rows marked "Email belongs to the PI": the proposal\'s co-PI email matched the request\'s PI. Check the proposal: is there a separate co-PI with this name (choose "Same person"/"New person"), or did the PI get listed twice ("Not a co-PI")?'],
  ['h', `Part 2 — Confirm the Institution at Award (${parts.p2.length} rows)`],
  ['', 'We found the institution from only one piece of evidence (shown in "Why we chose it"). Open the proposal and check where the co-PI was at the time. Matches → "Correct". Different institution → "Different account" and type the account name. No account exists for it → "No account". Unsure → "Can\'t tell".'],
  ['h', `Part 3 — Find the institution account (${parts.p3.length} rows)`],
  ['', 'We could not match the institution named in the proposal to any AkoyaGO account, or two pieces of evidence pointed to different accounts. Search AkoyaGO for the institution. Found → "Account found" and type the name. Does not exist → "No account" (please do not create one; we will decide those together). The person is not a co-PI → "Not a co-PI".'],
  ['h', `Part 4 — Current institution (${parts.p4.length} rows)`],
  ['', 'This is where the person is NOW, which can differ from where they were at the award. It fills the contact\'s own institution in AkoyaGO, and only when that is empty. Use the links provided and the person\'s current faculty page.'],
  ['', '"Keep proposed" uses the institution in the Proposed column. "Use web suggestion" uses the one the web search suggested. "Different account" → type the name. "Leave blank" if you cannot find a current, reliable page.'],
  ['h', 'Part 5 — Fixes to make directly in AkoyaGO'],
  ['', 'These are existing records that are wrong. Make each change yourself, then mark the Done column. If a fix is not what it seems, write what you found and do not change anything.'],
  ['h', 'When you finish'],
  ['', 'Save the file and send it back. Nothing is written to Dynamics until the answers have been reviewed.'],
];
for (const [kind, line] of HOW) {
  const row = howTo.addRow([line]);
  row.alignment = { wrapText: true, vertical: 'top' };
  if (kind === 'h') { row.font = { bold: true, size: 13 }; row.height = 22; }
}

// ── Part 1 ─────────────────────────────────────────────────────────────────
const p1 = sheet('1. Existing contact', [...ANSWER, ...CONTEXT, ['Why flagged', 'w', 26], ['Possible matches in AkoyaGO', 'm', 44], ['key', 'key', 8]]);
// Rows the owner has already answered; staff can skip them.
const OWNER_ANSWERS = {
  'p1|ext|2bca4627a9d206f8': ['Not a co-PI', 'Owner, 2026-10-21: he is the current PI. Smith was PI at award, left UF, and the PI was changed to Mehrad. No change needed.'],
  'p1|ext|e69301fc2aab7096': ['Not a co-PI', 'He is the PI in AkoyaGO. The proposal has two PIs (Biyu He and Eric Oermann); AkoyaGO records Oermann. No change needed.'],
};
for (const it of parts.p1) {
  const [d, note] = OWNER_ANSWERS[`p1|${it.x.key}`] || [];
  p1.addRow({
    d, note,
    ...ctx(it),
    w: it.kind === 'is-pi' ? 'Email belongs to the PI' : 'Same or similar name already in AkoyaGO',
    m: it.kind === 'is-pi' ? it.r.Contact : it.r['Possible existing contacts'],
    key: `p1|${it.x.key}`,
  });
}
finish(p1, ['Same person', 'New person', 'Not a co-PI', "Can't tell"]);

// ── Part 2 ─────────────────────────────────────────────────────────────────
const p2 = sheet('2. Confirm institution', [...ANSWER, ...CONTEXT, ['Proposed Institution at Award', 'i', 30], ['Why we chose it', 'w', 44], ['key', 'key', 8]]);
for (const it of parts.p2) p2.addRow({ ...ctx(it), i: it.r['Proposed Institution at Award'], w: why(it.x.iaaVia), key: `p2|${it.x.key}` });
finish(p2, ['Correct', 'Different account', 'No account', "Can't tell"]);

// ── Part 3 ─────────────────────────────────────────────────────────────────
const p3 = sheet('3. Find institution', [...ANSWER, ...CONTEXT, ['What we found', 'w', 50], ['key', 'key', 8]]);
for (const it of parts.p3) {
  p3.addRow({
    ...ctx(it),
    w: it.x.class === 'conflicting-evidence'
      ? `Evidence disagrees: ${it.r.Why.split('\n')[0].replace(/domain-map: /, 'colleagues at this email domain → ').replace(/; account-name: /, '; name in proposal → ')}`
      : it.x.cohort === 'recorded'
        ? `Already a co-PI in AkoyaGO (${it.r.Contact}). The contact has no institution and the email domain did not identify one; check the proposal.`
        : 'No account matched the institution named in the proposal',
    key: `p3|${it.x.key}`,
  });
}
finish(p3, ['Account found', 'No account', 'Not a co-PI', "Can't tell"]);

// ── Part 4 ─────────────────────────────────────────────────────────────────
const KIND4 = {
  'web-suggestion': 'New contact: the web suggests this current institution',
  'contact-account-web-disagrees': 'Web shows a different current institution than their latest award',
  'contact-account-web-ambiguous': 'Web shows several institutions',
  'contact-account-unresolved': 'Latest award institution unknown (if this person is also in Part 3, start from that answer)',
};
const p4 = sheet('4. Current institution', [...ANSWER, ['Request', 'req', 10], ['Year', 'y', 6], ['Person', 'p', 24], ['Contact in AkoyaGO', 'c', 34], ['Why flagged', 'w', 30], ['Proposed (latest award)', 'i', 30], ['Web suggestion', 's', 28], ['Web results', 'links', 60], ['key', 'key', 8]]);
for (const it of parts.p4) {
  const isNew = it.kind === 'web-suggestion';
  p4.addRow({
    req: it.r.Request, y: it.r.Year, p: it.r.Person,
    c: isNew ? '(new contact, not yet created)' : it.r.Contact,
    w: KIND4[it.kind],
    i: isNew ? '' : it.r['Proposed contact account'],
    s: it.r['Suggested account for new contact (web)'],
    links: webLinks(it.r['Web results (current page)']),
    key: `p4|${it.kind}|${it.x.key}`,
  });
}
finish(p4, ['Keep proposed', 'Use web suggestion', 'Different account', 'Leave blank']);

// ── Part 5 ─────────────────────────────────────────────────────────────────
const p5 = sheet('5. Fix in AkoyaGO', [['Done', 'd', 10], ['What you found', 'note', 34], ['Request', 'req', 10], ['Problem', 'prob', 50], ['What to do', 'todo', 70], ['key', 'key', 8]]);
const MERGE = 'Find both contacts for the PI (search the last name). Merge them in AkoyaGO, keeping the contact that has the institution (account) filled in and the longer history. After merging, open the request and check that the PI and the Personnel list point to the surviving contact. Do not merge if the two are not clearly the same person.';
const FIXES = [
  ['992966', 'The PI has two contacts. The award points at the older one; a newer (Dec 2025) contact has the institution.', MERGE],
  ['994465', 'The PI has two contacts with different emails; a staff-created 2025 contact duplicates an older one.', MERGE],
  ['1001530', 'The PI has two contacts; the integration created a new one in 2025 although one already existed.', MERGE],
  ['1001618', 'The PI has two contacts; the integration created a new one in 2025 although one already existed.', MERGE],
  ['1002341', 'The PI has two contacts; the integration created a new one in 2025 although one already existed.', MERGE],
  ['1002353', 'The PI has two contacts; the integration created a new one in 2025 although one already existed.', MERGE],
  ['1000954', 'The PI in the Personnel list is a different contact from the request\'s PI (project leader), and the co-PI slot holds the PI.', 'Check the proposal for the real PI and co-PIs. Make the Personnel PI row and the project leader the same person, and remove the PI from the co-PI slot and co-PI Personnel row if they are not also a co-PI. Note what you changed.'],
  ['1001012', 'The request\'s liaison is recorded as a co-PI (in a co-PI slot and a co-PI Personnel row).', 'Confirm from the proposal that the liaison is not a co-PI, then remove them from the co-PI slot and delete the co-PI Personnel row. Leave the liaison field as it is.'],
  ['1001565', 'One co-PI (Simon Billinge) has moved from Columbia to UC Santa Barbara since this award. His contact has no current institution.', 'Set his contact\'s institution (account) to UC Santa Barbara only if it is still empty. Do not change anything on the request.'],
];
for (const [req, prob, todo] of FIXES) p5.addRow({ req, prob, todo, key: `p5|${req}` });

// PI contacts held back from the ORCID backfill (research-pi-orcid-resolve.jsonl
// action held_by_*), named from research-pi-orcid-review.xlsx by contactid.
const ORCID_TODO = 'Search the person\'s last name for a second contact (one may have been created when they reviewed for us). If two contacts are clearly the same person, merge them as above, keeping the one linked to the award. If there is only one, write that in "What you found".';
const orcidActions = new Map(fs.readFileSync(path.join(DIR, '..', 'research-pi-orcid-resolve.jsonl'), 'utf8').trim().split('\n')
  .map((l) => JSON.parse(l)).filter((x) => /^held_by_/.test(x.action)).map((x) => [x.contactid, x.action]));
const orcidWb = new ExcelJS.Workbook();
await orcidWb.xlsx.readFile(path.join(DIR, '..', 'research-pi-orcid-review.xlsx'));
{
  const ws = orcidWb.worksheets[0];
  const head = ws.getRow(1).values;
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const row = {};
    head.forEach((h, k) => { if (h) row[h] = String(text(r.getCell(k).value)); });
    const action = orcidActions.get(row.contactid);
    if (!action) return;
    const where = action === 'held_by_other_contact' ? 'another contact' : 'a reviewer record linked to a different contact';
    p5.addRow({
      req: '(search by name)',
      prob: `PI ${row.Person}, ${row['Grant institution (award years)']}: their ORCID (${row['Proposed ORCID (click to open)']}) is already on ${where}, so the person probably has two contacts.`,
      todo: ORCID_TODO,
      key: `p5|orcid|${row.contactid}`,
    });
  });
}
p5.eachRow((row, i) => {
  if (i === 1) return;
  row.alignment = { vertical: 'top', wrapText: true };
  row.getCell(1).dataValidation = list(['Done', 'Not done', 'Needs discussion']);
  [1, 2].forEach((c) => { row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8DC' } }; });
});

await wb.xlsx.writeFile(OUT);
console.log(`Part 1 ${parts.p1.length}, Part 2 ${parts.p2.length}, Part 3 ${parts.p3.length}, Part 4 ${parts.p4.length}, Part 5 ${p5.rowCount - 1}`);
console.log(`Wrote ${OUT}`);
