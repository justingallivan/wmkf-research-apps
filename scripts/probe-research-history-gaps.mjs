/**
 * probe-research-history-gaps.mjs — READ-ONLY, counts only (no files, no writes).
 * Answers decision 4 of docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md:
 * how many Research requests (RESEARCH_PROGRAM_IDS; all statuses) the inventory
 * runs could not reach because they have a meeting date before 1990 or no
 * meeting date at all. Prints aggregates only (counts by status, created year,
 * test flag and request-number range), so nothing personal reaches the terminal.
 *
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-research-history-gaps.mjs
 */

import fs from 'fs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { RESEARCH_PROGRAM_IDS } = await import('../shared/config/researchPrograms.js');
enterDynamicsBypassForScript('probe-research-history-gaps');

const PROGRAM_LABELS = { [RESEARCH_PROGRAM_IDS[0]]: 'S&E', [RESEARCH_PROGRAM_IDS[1]]: 'MR' };
const programFilter = `(${RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ')})`;

async function readAll(filter) {
  const result = await DynamicsService.queryAllRecords('akoya_requests', {
    select: 'akoya_requestnum,createdon,wmkf_meetingdate,akoya_requeststatus,_akoya_programid_value,wmkf_istestrequest',
    filter: `${programFilter} and ${filter}`,
  });
  if (result.capped) console.log('  (read hit the 5,000-row cap: counts below are a floor)');
  return result.records;
}

function summarize(label, rows) {
  const by = (fn) => rows.reduce((m, r) => { const k = fn(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  const fmt = (m) => Object.entries(m).sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, n]) => `${k} ${n}`).join(', ') || '-';
  const nums = rows.map((r) => Number(r.akoya_requestnum)).filter(Number.isFinite).sort((a, b) => a - b);
  console.log(`\n=== ${label}: ${rows.length} requests`);
  if (!rows.length) return;
  console.log(`  test flag:     ${fmt(by((r) => (r.wmkf_istestrequest ? 'test' : 'non-test')))}`);
  console.log(`  program:       ${fmt(by((r) => PROGRAM_LABELS[r._akoya_programid_value] || 'other'))}`);
  console.log(`  status:        ${fmt(by((r) => r['akoya_requeststatus@OData.Community.Display.V1.FormattedValue'] || r.akoya_requeststatus || '(none)'))}`);
  console.log(`  created year:  ${fmt(by((r) => String(r.createdon || '').slice(0, 4) || '(none)'))}`);
  if (label.startsWith('Meeting')) console.log(`  meeting year:  ${fmt(by((r) => String(r.wmkf_meetingdate || '').slice(0, 4)))}`);
  if (nums.length) console.log(`  request nums:  ${nums[0]} .. ${nums[nums.length - 1]}`);
}

summarize('Meeting date before 1990', await readAll('wmkf_meetingdate lt 1990-01-01'));
summarize('No meeting date', await readAll('wmkf_meetingdate eq null'));
