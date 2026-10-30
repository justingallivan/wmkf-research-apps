#!/usr/bin/env node
'use strict';
/**
 * Self-test for check:request-meeting-date-reads. Builds temp `--root` fixture
 * trees (never touches the real lib/pages/shared) and proves:
 *   countMentions  the field, `_formatted`, and both helper calls count; the
 *                  helpers' bare names (imports, comments) and other fields do not
 *   GREEN  recorded files at their exact counts → exit 0
 *   RED    unrecorded file; recorded file that grew; recorded file that shrank;
 *          recorded file now at zero; recorded file deleted; a mention under
 *          pages/ and shared/ (not only lib/)
 *   SCOPE  scripts/ and tests/ are not scanned
 * The fixture runs use the gate's `run()` with a fixture record, and one real
 * child-process run proves the exit code CI sees on the actual tree.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-request-meeting-date-reads.js');
const { countMentions, run } = require(GATE);

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
}

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-date-gate-'));
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), src);
  }
  return root;
}

console.log('check-request-meeting-date-reads self-test');

console.log('countMentions():');
check('select string counts', countMentions("select: 'akoya_requestid,wmkf_meetingdate'") === 1);
check('formatted value counts', countMentions('r.wmkf_meetingdate_formatted') === 1);
check('helper calls count', countMentions('meetingDateToCycleCode(d); cycleCodeToOdataFilter (c)') === 2);
check('helper import names alone do not count', countMentions("import { meetingDateToCycleCode, cycleCodeToOdataFilter } from './x';") === 0);
check('other fields do not count', countMentions("select: 'wmkf_reviewduedate,akoya_decisiondate,meetingDate'") === 0);

const RECORD = {
  'lib/a.js': [1, 'pending-reader'],
  'lib/b.js': [2, 'grant-cycle-column'],
};
const BASE = {
  'lib/a.js': "const SELECT = 'akoya_requestid,wmkf_meetingdate';\n",
  'lib/b.js': "// wmkf_meetingdate column\nconst c = 'wmkf_meetingdate';\n",
  'lib/clean.js': "const SELECT = 'akoya_requestid';\n",
  'scripts/probe.js': "const s = 'wmkf_meetingdate'; cycleCodeToOdataFilter('D26');\n",
  'tests/unit/x.test.js': "expect(row.wmkf_meetingdate).toBe(1);\n",
};

console.log('run():');
{
  const { errors } = run({ root: tree(BASE), recorded: RECORD });
  check('GREEN exact counts, scripts/ and tests/ ignored', errors.length === 0, errors.join(' | '));
}
const RED = {
  'unrecorded lib file': { ...BASE, 'lib/new.js': "orderby: 'wmkf_meetingdate desc'\n" },
  'unrecorded pages file': { ...BASE, 'pages/api/x.js': 'meetingDateToCycleCode(r.date)\n' },
  'unrecorded shared file': { ...BASE, 'shared/components/X.js': 'cycleCodeToOdataFilter(code)\n' },
  'recorded file grew': { ...BASE, 'lib/a.js': `${BASE['lib/a.js']}const order = 'wmkf_meetingdate desc';\n` },
  'recorded file shrank': { ...BASE, 'lib/b.js': "const c = 'wmkf_meetingdate';\n" },
  'recorded file at zero': { ...BASE, 'lib/a.js': "const SELECT = 'akoya_requestid';\n" },
};
const EXPECT = {
  'unrecorded lib file': /UNRECORDED: lib\/new\.js/,
  'unrecorded pages file': /UNRECORDED: pages\/api\/x\.js/,
  'unrecorded shared file': /UNRECORDED: shared\/components\/X\.js/,
  'recorded file grew': /GREW: lib\/a\.js has 2/,
  'recorded file shrank': /STALE count: lib\/b\.js has 1/,
  'recorded file at zero': /STALE record: lib\/a\.js/,
};
for (const [label, files] of Object.entries(RED)) {
  const { errors } = run({ root: tree(files), recorded: RECORD });
  check(`RED ${label}`, errors.length === 1 && EXPECT[label].test(errors[0]), errors.join(' | ') || 'no error');
}
{
  const files = { ...BASE };
  delete files['lib/b.js'];
  const { errors } = run({ root: tree(files), recorded: RECORD });
  check('RED recorded file deleted', errors.length === 1 && /STALE record: lib\/b\.js/.test(errors[0]), errors.join(' | '));
}

console.log('real tree (child process):');
try {
  execFileSync(process.execPath, [GATE], { stdio: 'pipe' });
  check('gate exits 0 on the tracked tree', true);
} catch (e) {
  check('gate exits 0 on the tracked tree', false, String(e.stderr || e.message).slice(0, 400));
}

if (failures) {
  console.error(`\ncheck-request-meeting-date-reads self-test FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log('\ncheck-request-meeting-date-reads self-test OK');
