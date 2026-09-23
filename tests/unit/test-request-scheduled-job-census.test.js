/** @jest-environment node */
/**
 * Census of every cron route (Test Request Factory Stage 1c). Scheduled jobs
 * must not act on test requests: every route under pages/api/cron is recorded
 * here with a classification, and every job classified `guarded` must keep a
 * test-request skip in the file that selects its candidates. Adding, removing
 * or rescheduling a cron fails this test until the record is updated
 * deliberately. The design doc's Stage 1c record explains each decision.
 * This file pins that the skip exists; the ordering (no claim, mint, provider
 * call, write or send before classification) is asserted by each job's own
 * focused tests.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const GUARD = /createRequestTestStateLookup\(|resolveRequestTestState|resolveTestState\(|TEST_REQUEST_ORDINARY_OData_FILTER/;

// route → { scheduled, class, guardFiles?, note }
//   guarded     — acts on request-linked rows; skips test requests at selection
//   allowed     — runs work a staff member launched on a chosen request (owner decision)
//   operational — global monitoring, pricing, retention or reference data; no per-request action
//   n/a         — cannot reach a test request
const RECORDED_CRONS = {
  'auth-bypass-check': { scheduled: true, class: 'operational' },
  'drain-cycle-dossiers': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/cycle-dossier-service.js'], note: 'cycle-wide report: roster excludes test requests' },
  'drain-review-panels': { scheduled: true, class: 'allowed', note: 'staff-launched AI panel on chosen requests' },
  'drain-review-syntheses': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/review-synthesis-drain.js'] },
  'drain-reviewer-acceptances': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/reviewer-acceptance-drain.js'] },
  'drain-submissions': { scheduled: true, class: 'n/a', note: 'creates new applicant requests; the app cannot write the marker' },
  'file-review-docx': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/review-documents/individual-file-service.js'] },
  'generate-grantee-titles': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/cron/generate-grantee-titles-service.js'] },
  'grantee-deliverable-reminders': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/cron/grantee-deliverable-reminders-service.js', 'lib/services/scheduled-email-service.js'] },
  'health-check': { scheduled: true, class: 'operational' },
  'log-analysis': { scheduled: true, class: 'operational' },
  maintenance: { scheduled: true, class: 'operational', note: 'retention/GC sub-tasks; request-linked ones (expired materials close, BILL onboarding sweep, upload-staging GC, review-draft GC) are recorded decisions in the Stage 1c record' },
  'pricing-canary': { scheduled: true, class: 'operational' },
  'pricing-refresh': { scheduled: true, class: 'operational' },
  'reconcile-identities': { scheduled: true, class: 'operational' },
  'refresh-irs-bmf': { scheduled: true, class: 'operational' },
  'reviewer-email-reconcile': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/reviewer-email-reconciler.js'] },
  'reviewer-reminders': { scheduled: false, class: 'guarded', guardFiles: ['lib/services/reviewer-reminder-sweep.js'] },
  'secret-check': { scheduled: true, class: 'operational' },
  'send-review-thankyous': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/reviewer-thankyou-sweep.js'] },
  'site-visit-materials-reminders': { scheduled: false, class: 'guarded', guardFiles: ['lib/services/site-visit-materials/reminder-sweep.js'] },
  'spend-check': { scheduled: true, class: 'operational', note: 'aggregate spend; report exclusion is Stage 1d' },
  'sweep-stale-invites': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/reviewer-suggestion-sweep.js'] },
};

test('every cron route is recorded', () => {
  const routes = fs.readdirSync(path.join(ROOT, 'pages/api/cron'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort();
  expect(routes).toEqual(Object.keys(RECORDED_CRONS).sort());
});

test('the recorded schedule matches vercel.json', () => {
  const scheduled = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).crons
    .map((cron) => cron.path.replace(/^\/api\/cron\//, ''))
    .sort();
  const recorded = Object.entries(RECORDED_CRONS).filter(([, v]) => v.scheduled).map(([k]) => k).sort();
  expect(scheduled).toEqual(recorded);
});

test.each(Object.entries(RECORDED_CRONS)
  .filter(([, v]) => v.class === 'guarded')
  .flatMap(([route, v]) => v.guardFiles.map((file) => [route, file])))(
  '%s keeps its test-request skip in %s',
  (_route, file) => {
    expect(fs.readFileSync(path.join(ROOT, file), 'utf8')).toMatch(GUARD);
  },
);
