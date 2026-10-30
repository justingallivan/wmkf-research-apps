#!/usr/bin/env node
'use strict';
/**
 * check:request-meeting-date-reads — ratchet gate for the request meeting date.
 *
 * Owner decision (2026-10-29, docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md
 * §5, §7 Q8d): no app code reads `akoya_request.wmkf_meetingdate`; a request's
 * cycle comes from its Grant Cycle link and cycle dates from the linked calendar
 * row. About thirty app readers remained when this gate was added (owner,
 * 2026-10-30: guard and ratchet now, convert in follow-up PRs).
 *
 * Plain-text census of `lib/`, `pages/` and `shared/`: per file, the number of
 * `wmkf_meetingdate` mentions (the Grant Cycle table's Board-date column has the
 * same logical name, so the text cannot tell the two apart) plus calls to the
 * meeting-date helpers `meetingDateToCycleCode(` and `cycleCodeToOdataFilter(`.
 * Every file with a non-zero count must appear in RECORDED with that exact count:
 *   - an unrecorded file fails (a new reader);
 *   - a count above the record fails (a new reader in a recorded file);
 *   - a count below the record, or a recorded file now at zero or gone, fails
 *     until the record is lowered (the ratchet only moves down).
 * The map itself is pinned by
 * tests/unit/request-meeting-date-reads-recorded-set.test.js, so any edit to it
 * is a reviewed change in both places.
 *
 * Kinds (documentation; the gate treats them alike):
 *   grant-cycle-column  the calendar's own Board-date column, not the request's
 *   request-write       a deliberate write of the request field
 *   factory             Test Request Factory (writes, readback, read-only preview)
 *   helper-definition   the old helpers' definition, kept for scripts
 *   explorer-fallback   Dynamics Explorer prompt: link first, meeting date only
 *                       when the link is blank (owner, §7 Q8a)
 *   export-column       Bulk Export "Meeting date" column (out of scope, §7 Q8c)
 *   pending-reader      an app reader still to convert; remove as each converts
 *
 * Exit 1 on any violation; 0 otherwise.
 *   node scripts/check-request-meeting-date-reads.js [--report] [--root <dir>]
 */

const fs = require('fs');
const path = require('path');

const SCAN_DIRS = ['lib', 'pages', 'shared'];
const SCAN_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const PATTERN = /wmkf_meetingdate|\bmeetingDateToCycleCode\s*\(|\bcycleCodeToOdataFilter\s*\(/g;

/** Tracked recorded set: relative path → [count, kind]. Pinned by the recorded-set test. */
const RECORDED = Object.freeze({
  'lib/bill/honorarium-onboard-orchestrator.js': [3, 'request-write'],
  'lib/dataverse/adapters/operations-grant-cycle.js': [2, 'grant-cycle-column'],
  'lib/services/dataverse-export/constants.js': [1, 'export-column'],
  'lib/services/meeting-tracker/program-briefing-service.js': [1, 'grant-cycle-column'],
  'lib/services/test-requests/admin-preview-service.js': [6, 'factory'],
  'lib/services/test-requests/admin-run-service.js': [1, 'factory'],
  'lib/services/test-requests/basic-clone-steps.js': [7, 'factory'],
  'lib/services/test-requests/policy.js': [3, 'factory'],
  'lib/services/test-requests/preview.js': [3, 'factory'],
  'lib/services/test-requests/production-write-fence.js': [1, 'factory'],
  'lib/services/test-requests/run-runner.js': [1, 'factory'],
  'lib/services/test-requests/sandbox-clone.js': [6, 'factory'],
  'lib/services/test-requests/source-bundle.js': [1, 'factory'],
  'lib/services/workbench/dashboard-service.js': [1, 'grant-cycle-column'],
  'lib/services/workbench/grantee-deliverables/awardees-service.js': [1, 'grant-cycle-column'],
  'lib/utils/cycle-code.js': [6, 'helper-definition'],
  'shared/components/workbench/OverviewTab.js': [1, 'grant-cycle-column'],
  'shared/config/cycleCalendar.js': [1, 'grant-cycle-column'],
  'shared/config/prompts/dynamics-explorer.js': [4, 'explorer-fallback'],
});

function walk(dir, root, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(abs, root, out); continue; }
    if (!entry.isFile() || !SCAN_EXT.has(path.extname(entry.name))) continue;
    out.push(path.relative(root, abs).split(path.sep).join('/'));
  }
  return out;
}

function countMentions(source) {
  return (source.match(PATTERN) || []).length;
}

function run({ root, report, recorded = RECORDED }) {
  const files = SCAN_DIRS.flatMap((dir) => walk(path.join(root, dir), root, [])).sort();
  const found = {};
  for (const rel of files) {
    const n = countMentions(fs.readFileSync(path.join(root, rel), 'utf8'));
    if (n) found[rel] = n;
  }

  const errors = [];
  for (const [rel, n] of Object.entries(found)) {
    const record = recorded[rel];
    if (!record) {
      errors.push(`UNRECORDED: ${rel} mentions the request meeting date or its helpers ${n} time(s). Read the request's cycle from its Grant Cycle link (lib/dataverse/adapters/operations-grant-cycle.js) instead.`);
    } else if (n > record[0]) {
      errors.push(`GREW: ${rel} has ${n} mention(s), recorded ${record[0]}. New request meeting-date reads are not allowed; use the Grant Cycle link.`);
    } else if (n < record[0]) {
      errors.push(`STALE count: ${rel} has ${n} mention(s), recorded ${record[0]}. Lower the record here and in the pin test.`);
    }
  }
  for (const rel of Object.keys(recorded)) {
    if (!found[rel]) errors.push(`STALE record: ${rel} has no mentions left (or no longer exists). Remove it here and from the pin test.`);
  }

  if (report) {
    console.log(`request-meeting-date-reads census (${Object.keys(found).length} file(s)):`);
    for (const [rel, n] of Object.entries(found)) {
      const record = recorded[rel];
      console.log(`  - ${rel} ${n}${record ? ` [${record[1]}]` : ' UNRECORDED'}`);
    }
  }
  return { found, errors };
}

function parseArgs(argv) {
  const out = { root: path.resolve(__dirname, '..'), report: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--report') out.report = true;
    else if (argv[i] === '--root') { out.root = path.resolve(argv[i + 1]); i += 1; }
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const { found, errors } = run(args);
  if (errors.length) {
    console.error(`request-meeting-date-reads FAILED: ${errors.length} violation(s).`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  const pending = Object.values(RECORDED).filter(([, kind]) => kind === 'pending-reader').length;
  console.log(`request-meeting-date-reads OK — ${Object.keys(found).length} recorded file(s), ${pending} pending reader(s) to convert, 0 new.`);
}

module.exports = { RECORDED, countMentions, run };
