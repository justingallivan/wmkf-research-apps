/**
 * restore-request-reviewers-selected.mjs — Reverse a soft-delete from
 * reset-request-reviewers.mjs by setting wmkf_selected=true on a request's
 * `wmkf_appreviewersuggestion` rows.
 *
 * The soft-delete only flips wmkf_selected=false; the rows are intact. This
 * flips them back. Dry-run by default; pass --execute to write.
 *
 * Usage:
 *   node scripts/restore-request-reviewers-selected.mjs --request <num|GUID> [--execute]
 */

import fs from 'fs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
} catch {
  console.error('Could not read .env.local — run from the repo root.');
  process.exit(2);
}

const args = process.argv.slice(2);
const valOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const requestArg = valOf('--request');
const EXECUTE = args.includes('--execute');

if (!requestArg) {
  console.error('ERROR: --request <akoya_requestnum|GUID> is required.');
  process.exit(2);
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('restore-request-reviewers-selected');

const mode = EXECUTE ? '\x1b[31mEXECUTE (live changes)\x1b[0m' : 'DRY-RUN (no changes)';
console.log(`\n=== restore-request-reviewers-selected — ${mode} ===`);

// resolve request → GUID
let requestGuid, requestNum;
try {
  if (GUID_RE.test(requestArg)) {
    const rec = await DynamicsService.getRecord('akoya_requests', requestArg, {
      select: 'akoya_requestid,akoya_requestnum',
    });
    requestGuid = rec.akoya_requestid;
    requestNum = rec.akoya_requestnum;
  } else {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_requestnum',
      filter: `akoya_requestnum eq '${String(requestArg).replace(/'/g, "''")}'`,
      top: 2,
    });
    if (records.length === 0) { console.error(`ERROR: no akoya_request '${requestArg}'.`); process.exit(2); }
    if (records.length > 1) { console.error(`ERROR: ${records.length} match — pass the GUID.`); process.exit(2); }
    requestGuid = records[0].akoya_requestid;
    requestNum = records[0].akoya_requestnum;
  }
} catch (e) {
  console.error('ERROR resolving request:', e.message);
  process.exit(2);
}
console.log(`Resolved request: #${requestNum}  (GUID ${requestGuid})\n`);

const { records } = await DynamicsService.queryRecords('wmkf_appreviewersuggestions', {
  select: 'wmkf_appreviewersuggestionid,wmkf_suggestionlabel,wmkf_selected',
  filter: `_wmkf_request_value eq ${requestGuid}`,
  top: 500,
});

if (records.length === 0) { console.log('(no suggestion rows for this request)\n'); process.exit(0); }

const toFix = records.filter((r) => !r.wmkf_selected);
console.log(`Found ${records.length} row(s); ${toFix.length} with selected=false:`);
for (const r of records) {
  console.log(`  • ${(r.wmkf_suggestionlabel || '(no label)').padEnd(60)} selected=${!!r.wmkf_selected}`);
}
console.log('');

if (toFix.length === 0) { console.log('Nothing to restore — all already selected.\n'); process.exit(0); }

if (!EXECUTE) {
  console.log(`→ would set wmkf_selected=true on ${toFix.length} row(s). Re-run with --execute.\n`);
  process.exit(0);
}

let ok = 0, fail = 0;
for (const r of toFix) {
  try {
    await DynamicsService.updateRecord('wmkf_appreviewersuggestions', r.wmkf_appreviewersuggestionid, { wmkf_selected: true });
    console.log(`  \x1b[32mrestored\x1b[0m ${r.wmkf_suggestionlabel}`);
    ok++;
  } catch (e) {
    console.error(`  FAILED ${r.wmkf_appreviewersuggestionid}: ${e.message}`);
    fail++;
  }
}
console.log(`\nDone: restored ${ok}${fail ? `, ${fail} failed` : ''}.\n`);
