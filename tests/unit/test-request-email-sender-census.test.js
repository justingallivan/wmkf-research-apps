/** @jest-environment node */
/**
 * Mechanically derived census of every deployed email sender (Test Request
 * Factory Stage 1b). A file that reaches the Dynamics email delivery
 * functions, directly or through the email-activity adapter, must appear here
 * with a classification. Adding or removing a sender fails this test until the
 * record is updated deliberately; the schema proposal's per-route table is a
 * checklist, and this derived set is authoritative.
 *
 * All request-regarding email passes the delivery seam in
 * lib/services/dynamics/email.js (refused for test requests when
 * TEST_REQUEST_ISOLATION=on). Senders that mint links or write records before
 * the seam would see the email also refuse early.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['lib', 'pages', 'shared'];
const TRANSPORT_FILES = new Set([
  'lib/services/dynamics/email.js',
  'lib/services/dynamics-service.js',
  'lib/dataverse/adapters/email-activity.js',
]);
const SENDER_PATTERN = /\.createAndSendEmail\(|\.createEmailActivity\(|DynamicsService\.sendEmail\(|adapters\/email-activity|emailActivityAdapter/;

// file → { audience, early }. `early` lists the exported entry functions that
// must themselves call assertRequestEmailAllowed before minting links, writing
// records or sending (senders the delivery seam cannot see, or that act before
// it).
const RECORDED_SENDERS = {
  'lib/services/admin/test-email-service.js': { audience: 'staff', early: [] },
  'lib/services/meeting-tracker/agenda-service.js': { audience: 'staff', early: [] },
  'lib/services/notification-service.js': { audience: 'staff', early: [] },
  'lib/services/pre-site-visit/distribution/dependencies.js': { audience: 'request-distribution', early: [] },
  'lib/services/pre-site-visit/distribution/send.js': { audience: 'request-distribution', early: [] },
  'lib/services/review-manager/send-emails-service.js': { audience: 'reviewer', early: [] },
  'lib/services/review-manager/withdraw-sufficient-service.js': { audience: 'reviewer', early: [] },
  'lib/services/reviewer-acceptance-email.js': { audience: 'reviewer', early: [] },
  'lib/services/reviewer-due-extension.js': { audience: 'reviewer', early: [] },
  'lib/services/reviewer-engagement/terminal-transition.js': { audience: 'reviewer', early: [] },
  'lib/services/reviewer-reminder-sweep.js': { audience: 'reviewer', early: [] },
  'lib/services/reviewer-thankyou-sweep.js': { audience: 'reviewer', early: [] },
  // deliverScheduledEmail checks the request before its claim (injected
  // resolveTestState); sendEmail's dispatch recheck is the backstop.
  'lib/services/scheduled-email-service.js': { audience: 'grantee', early: [] },
  'lib/services/site-visit-materials/collection-service.js': {
    audience: 'materials',
    early: ['createMaterialsCollection', 'inviteMaterialsContributors', 'remindMaterialsContributors'],
  },
  'lib/services/workbench/grantee-deliverables/send-invite-service.js': { audience: 'grantee', early: ['sendGranteeInvite'] },
};

// lib/ files that reach a sender through its exported send helpers rather than
// the transport, with where their test-request refusal lives.
const RECORDED_INDIRECT = {
  'lib/services/cron/grantee-deliverable-reminders-service.js': 'processRow skips test requests before recipient reads or ledger writes; deliverScheduledEmail checks before claim',
  'lib/services/reviewer-manual-reminder.js': 'sendOneReminder sends with the request as regarding; delivery seam and dispatch recheck',
  'lib/services/site-visit-materials/reminder-sweep.js': 'per-row check before read, preparation or claim; sendReminderEmail (post-claim) does no read',
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(full, out);
    } else if (/\.(m?js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function derivedSenders() {
  const found = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (TRANSPORT_FILES.has(rel)) continue;
      if (SENDER_PATTERN.test(fs.readFileSync(file, 'utf8'))) found.push(rel);
    }
  }
  return found.sort();
}

test('the recorded sender set matches the senders derived from source', () => {
  expect(derivedSenders()).toEqual(Object.keys(RECORDED_SENDERS).sort());
});

const SEND_HELPER = /^(send|deliver|invite|remind|notify|dispatch)|Email/i;

function exportedFunctionBodies(source) {
  const bodies = {};
  const starts = [...source.matchAll(/export (?:async )?function (\w+)\(/g)];
  starts.forEach((match, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    bodies[match[1]] = source.slice(match.index, end);
  });
  return bodies;
}

test('the recorded indirect senders match those derived from source', () => {
  const helpers = {};
  for (const file of Object.keys(RECORDED_SENDERS)) {
    for (const name of Object.keys(exportedFunctionBodies(fs.readFileSync(path.join(ROOT, file), 'utf8')))) {
      if (SEND_HELPER.test(name)) helpers[name] = file;
    }
  }
  const indirect = new Set();
  for (const file of walk(path.join(ROOT, 'lib'))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (RECORDED_SENDERS[rel] || TRANSPORT_FILES.has(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const [name, owner] of Object.entries(helpers)) {
      if (owner !== rel && new RegExp(`\\b${name}\\(`).test(source)) indirect.add(rel);
    }
  }
  expect([...indirect].sort()).toEqual(Object.keys(RECORDED_INDIRECT).sort());
});

test.each(Object.entries(RECORDED_SENDERS).flatMap(([file, v]) => v.early.map((fn) => [fn, file])))(
  '%s in %s refuses test requests early',
  (fn, file) => {
    const body = exportedFunctionBodies(fs.readFileSync(path.join(ROOT, file), 'utf8'))[fn];
    expect(body).toBeDefined();
    expect(body).toMatch(/assertRequestEmailAllowed\(/);
  },
);

test('the delivery seam still guards both email creation and dispatch', () => {
  const seam = fs.readFileSync(path.join(ROOT, 'lib/services/dynamics/email.js'), 'utf8');
  expect(seam).toMatch(/await assertEmailNotAboutTestRequest\(svc, regardingId, regardingType\);/);
  expect(seam).toMatch(/await assertSendNotAboutTestRequest\(svc, emailId\);/);
});
