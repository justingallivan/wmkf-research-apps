/**
 * lookup-research-copi-current-emails.mjs — current-email lookup for the co-PIs
 * that Stage B of the Research Institution at Award backfill will create as new
 * contacts (plan docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.2).
 * Their only address is the proposal-era one, which may be years old.
 *
 * Runs the Reviewer Finder's ContactEnrichmentService with FREE tiers only
 * (owner, 2026-10-23): affiliation-embedded email, PubMed, ORCID, the structured
 * NCBI + Europe PMC tier, OpenAlex and resolved institution pages. Claude and
 * SerpAPI tiers stay off and no paid keys are passed. persist:false and the
 * legacy identity mode keep it write-free: no Dataverse, no Postgres. Reads
 * only files in --dir and --staff.
 *
 *   node scripts/lookup-research-copi-current-emails.mjs --dir=<stage-b-2 folder> \
 *     --staff=<returned staff workbook> [--limit=N]
 *
 * Writes research-copi-current-emails.csv to --dir (names; keep it out of git).
 * Email choice per row: a staff-supplied address, else a found address the
 * service rates `ready`, else the proposal address; a found address that
 * differs from the choice and is not `ready` is flagged for owner review.
 */

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }
// Never the shadow/combined identity modes: those write comparisons to Postgres.
process.env.REVIEWER_IDENTITY_RESOLVER_MODE = 'legacy';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const DIR = arg('dir');
const STAFF = arg('staff');
const LIMIT = Number(arg('limit') || 0);
if (!DIR || !STAFF) { console.error('--dir=<folder with the resolve output> and --staff=<staff workbook> are required'); process.exit(2); }
const OUT = path.join(DIR, 'research-copi-current-emails.csv');
const repoAbs = path.resolve('.');
if (path.resolve(OUT).startsWith(`${repoAbs}${path.sep}`)) { console.error('The CSV holds names: write it outside the repository.'); process.exit(2); }

const text = (v) => (v && typeof v === 'object' ? (v.richText ? v.richText.map((x) => x.text).join('') : v.text || v.hyperlink || v.result || '') : v ?? '');
async function sheetRows(file, from = 0, to = undefined) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const rows = [];
  for (const ws of wb.worksheets.slice(from, to)) {
    const head = ws.getRow(1).values.map(text);
    ws.eachRow((r, i) => {
      if (i === 1) return;
      const row = {};
      head.forEach((h, k) => { if (h) row[h] = String(text(r.getCell(k).value)).trim(); });
      rows.push(row);
    });
  }
  return rows;
}
// Staff keys carry a part prefix ("p1|ext|…", "p4|contact-account-web-ambiguous|con|…").
const rowKey = (k) => k.match(/(ext\|[0-9a-f]+|rec\|.+|con\|.+)$/)?.[1] || k;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

const lines = fs.readFileSync(path.join(DIR, 'research-copi-iaa-resolve.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => !x.meta);
const review = new Map((await sheetRows(path.join(DIR, 'research-copi-iaa-review.xlsx'))).map((r) => [r.key, r]));

// Staff answers: Part 1 "New person" turns a possible duplicate into a new
// contact; any address the staff wrote in Notes (or the name column) is theirs.
const staffNew = new Set();
const staffEmail = new Map();
for (const r of await sheetRows(STAFF, 1, 5)) {
  if (!r.key) continue;
  const key = rowKey(r.key);
  if (r.key.startsWith('p1|') && r.Decision === 'New person') staffNew.add(key);
  const proposal = String(r['Email in proposal'] || '').toLowerCase();
  const found = [...`${r.Notes || ''} ${r['Name as shown in AkoyaGO'] || ''}`.matchAll(EMAIL)].map((m) => m[0].toLowerCase()).filter((e) => e !== proposal);
  if (r.key.startsWith('p1|') && r.Decision !== 'New person') continue; // Part 1 notes name the existing contact's address
  if (found.length === 1) staffEmail.set(key, found[0]);
}

const targets = lines.filter((x) => x.cohort === 'extracted' && (x.contactMatch === 'new-contact' || staffNew.has(x.key)));
const work = LIMIT ? targets.slice(0, LIMIT) : targets;
console.log(`New-contact co-PIs: ${targets.length} (${staffNew.size} from staff "New person"); looking up ${work.length}. Staff-supplied addresses: ${[...staffEmail.keys()].filter((k) => targets.some((x) => x.key === k)).length}.`);

const { ContactEnrichmentService } = (await import('../lib/services/contact-enrichment-service.js')).default
  ?? await import('../lib/services/contact-enrichment-service.js');
const credentials = { orcidClientId: process.env.ORCID_CLIENT_ID, orcidClientSecret: process.env.ORCID_CLIENT_SECRET };

const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cols = ['key', 'request', 'year', 'person', 'searchAffiliation', 'proposalEmail', 'staffEmail', 'foundEmail', 'foundSource', 'foundAction', 'foundReason', 'foundYear', 'chosenEmail', 'chosenFrom', 'review'];
const out = [cols.join(',')];
const tally = {};
for (const [i, x] of work.entries()) {
  const r = review.get(x.key) || {};
  const name = r.Person;
  const proposalEmail = (r['Proposal email'] || '').toLowerCase();
  const affiliation = r['Suggested account for new contact (web)'] || r['Proposed Institution at Award'] || r['Stated institution']?.replace(/\s*\((stated|email domain)\)$/, '') || '';
  let ce = {};
  try {
    const res = await ContactEnrichmentService.enrichCandidate({ name, affiliation }, {
      credentials, usePubmed: true, useOrcid: true, useClaudeSearch: false, useSerpSearch: false, persist: false,
    });
    ce = res.contactEnrichment || {};
  } catch (err) {
    ce = { emailAction: 'error', emailActionReason: err.message };
  }
  const found = (ce.email || '').toLowerCase();
  const staff = staffEmail.get(x.key) || '';
  let chosen; let from;
  if (staff) { chosen = staff; from = 'staff'; }
  else if (found && ce.emailAction === 'ready') { chosen = found; from = 'lookup'; }
  else { chosen = proposalEmail; from = proposalEmail ? 'proposal' : 'none'; }
  const review_ = (found && found !== chosen && ce.emailAction !== 'ready') ? 'found address not confirmed' : (!chosen ? 'no address' : '');
  tally[from] = (tally[from] || 0) + 1;
  out.push([x.key, x.requestNum, (x.meetingDate || '').slice(0, 4), name, affiliation, proposalEmail, staff, found, ce.emailSource, ce.emailAction, ce.emailActionReason, ce.emailYear, chosen, from, review_].map(csv).join(','));
  console.log(`${i + 1}/${work.length} ${x.requestNum} ${from}${found ? ` (found: ${ce.emailAction})` : ''}`);
}
fs.writeFileSync(OUT, `${out.join('\n')}\n`);
console.log(`Chosen from: ${JSON.stringify(tally)}`);
console.log(`Wrote ${OUT}`);
