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

// file → { audience, early }. `early: true` means the sender must call
// assertRequestEmailAllowed before minting links or writing records.
const RECORDED_SENDERS = {
  'lib/services/admin/test-email-service.js': { audience: 'staff', early: false },
  'lib/services/meeting-tracker/agenda-service.js': { audience: 'staff', early: false },
  'lib/services/notification-service.js': { audience: 'staff', early: false },
  'lib/services/pre-site-visit/distribution/dependencies.js': { audience: 'request-distribution', early: false },
  'lib/services/pre-site-visit/distribution/send.js': { audience: 'request-distribution', early: false },
  'lib/services/review-manager/send-emails-service.js': { audience: 'reviewer', early: false },
  'lib/services/review-manager/withdraw-sufficient-service.js': { audience: 'reviewer', early: false },
  'lib/services/reviewer-acceptance-email.js': { audience: 'reviewer', early: false },
  'lib/services/reviewer-due-extension.js': { audience: 'reviewer', early: false },
  'lib/services/reviewer-engagement/terminal-transition.js': { audience: 'reviewer', early: false },
  'lib/services/reviewer-reminder-sweep.js': { audience: 'reviewer', early: false },
  'lib/services/reviewer-thankyou-sweep.js': { audience: 'reviewer', early: false },
  // Scheduled grantee reminders exist only after a grantee invite, which is
  // refused early for test requests; the seam is the backstop here.
  'lib/services/scheduled-email-service.js': { audience: 'grantee', early: false },
  'lib/services/site-visit-materials/collection-service.js': { audience: 'materials', early: true },
  'lib/services/workbench/grantee-deliverables/send-invite-service.js': { audience: 'grantee', early: true },
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

test.each(Object.entries(RECORDED_SENDERS).filter(([, v]) => v.early).map(([file]) => [file]))(
  '%s refuses test requests early',
  (file) => {
    expect(fs.readFileSync(path.join(ROOT, file), 'utf8')).toMatch(/assertRequestEmailAllowed\(/);
  },
);

test('the delivery seam itself still guards email creation', () => {
  const seam = fs.readFileSync(path.join(ROOT, 'lib/services/dynamics/email.js'), 'utf8');
  expect(seam).toMatch(/await assertEmailNotAboutTestRequest\(svc, regardingId, regardingType\);/);
});
