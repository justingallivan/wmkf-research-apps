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
const GUARD = /createRequestTestStateLookup\(|resolveRequestTestState|resolveTestState\(|TEST_REQUEST_ORDINARY_OData_FILTER|withOrdinaryTestRequestODataFilter\(/;

// route → { scheduled, class, guardFiles?, note }
//   guarded     — acts on request-linked rows; skips test requests at selection
//   allowed     — runs work a staff member launched on a chosen request (owner decision)
//   operational — global monitoring, pricing, retention or reference data; no per-request action
//   n/a         — cannot reach a test request
const RECORDED_CRONS = {
  'auth-bypass-check': { scheduled: true, class: 'operational' },
  'drain-materials-uploads': { scheduled: true, class: 'allowed', note: 'continues an explicitly submitted token-authorized applicant upload; no request selection or email; materials background plan records this decision' },
  'drain-cycle-dossiers': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/cycle-dossier-service.js'], note: 'cycle-wide report: roster excludes test requests' },
  'drain-transcriptions': {
    scheduled: true,
    scheduleEntries: [
      { path: '/api/cron/drain-transcriptions', schedule: '0 3 * * *' },
      { path: '/api/cron/drain-transcriptions?recovery=1', schedule: '0 * * * *' },
    ],
    class: 'allowed',
    note: 'daily pass performs bounded cleanup and lease recovery; hourly query mode performs bounded workflow recovery; request-bound jobs enter only through staff-authorized request controls, and the worker rechecks request access before a new provider submission',
  },
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
  'staff-deliberations-preparation': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/pre-site-visit/preparation-worker.js'], note: 'every 15 minutes; acts only when enabled, and request selection, claim, promotion fence and retry exclude test requests' },
  'final-writeup-handoff-emails': { scheduled: true, class: 'allowed', note: 'every 15 minutes; retries the group-review email a lead PD started on a chosen request; email is regarding the request, so the delivery seam applies test-request policy' },
  'spend-check': { scheduled: true, class: 'operational', note: 'aggregate spend alarm; counts all spend, test requests included' },
  'sweep-stale-invites': { scheduled: true, class: 'guarded', guardFiles: ['lib/services/reviewer-suggestion-sweep.js'] },
};

test('every cron route is recorded', () => {
  const routes = fs.readdirSync(path.join(ROOT, 'pages/api/cron'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort();
  expect(routes).toHaveLength(27);
  expect(routes).toEqual(Object.keys(RECORDED_CRONS).sort());
});

test('the recorded schedule matches vercel.json', () => {
  const crons = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).crons;
  expect(crons).toHaveLength(26);
  expect(new Set(crons.map(({ path: cronPath }) => cronPath.split('?')[0])).size).toBe(25);
  const transcriptionCrons = crons.filter((cron) =>
    typeof cron.path === 'string' && cron.path.split('?')[0] === '/api/cron/drain-transcriptions'
  ).map(({ path: cronPath, schedule }) => ({ path: cronPath, schedule })).sort((a, b) => a.path.localeCompare(b.path));
  const expectedTranscriptionCrons = RECORDED_CRONS['drain-transcriptions'].scheduleEntries
    .slice().sort((a, b) => a.path.localeCompare(b.path));
  expect(transcriptionCrons).toEqual(expectedTranscriptionCrons);

  const scheduled = crons
    .filter((cron) => !(typeof cron.path === 'string' && cron.path.split('?')[0] === '/api/cron/drain-transcriptions'))
    .map((cron) => cron.path.replace(/^\/api\/cron\//, ''))
    .sort();
  const recorded = Object.entries(RECORDED_CRONS)
    .filter(([route, value]) => value.scheduled && route !== 'drain-transcriptions')
    .map(([route]) => route)
    .sort();
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

test('transcription cron continues durable job work without bypassing request-bound start controls', () => {
  const route = fs.readFileSync(path.join(ROOT, 'pages/api/cron/drain-transcriptions.js'), 'utf8');
  expect(route).toContain('drainTranscriptionCleanup');
  expect(route).toContain('drainTranscriptionWorkflowDispatches');
  expect(route).not.toContain('drainTranscriptionPilot(');

  const meetingRoute = fs.readFileSync(
    path.join(ROOT, 'pages/api/meeting-tracker/visits/[requestId]/transcriptions/[jobId]/start.js'), 'utf8',
  );
  expect(meetingRoute).toContain("requireAppAccess(req, res, 'meeting-tracker')");
  expect(meetingRoute).toContain('startMeetingTranscription');
  const service = fs.readFileSync(path.join(ROOT, 'lib/services/meeting-tracker-transcription/service.js'), 'utf8');
  const start = service.match(/export async function startMeetingTranscription\([\s\S]*?\n}/);
  expect(start).not.toBeNull();
  expect(start[0]).toContain('requireMeetingTranscriptionEnabled(requestId)');
  expect(start[0]).toContain('queueMeetingTranscription');

  const runtime = fs.readFileSync(path.join(ROOT, 'lib/services/transcription-pilot/runtime.js'), 'utf8');
  const queue = runtime.match(/export async function queueMeetingTranscription\([\s\S]*?\n}/);
  expect(queue).not.toBeNull();
  expect(queue[0]).toContain('requireMeetingTranscriptionEnabled(requestId)');
  expect(queue[0]).toContain('queueMeetingTranscriptionJob');
  const store = fs.readFileSync(path.join(ROOT, 'lib/services/transcription-pilot/store.js'), 'utf8');
  const boundQueue = store.match(/async function queueMeetingJob\([\s\S]*?\n  }/);
  expect(boundQueue).not.toBeNull();
  expect(boundQueue[0]).toContain('request_id = $2 AND site_visit_activity_id = $3');
  expect(boundQueue[0]).toContain('INSERT INTO transcription_workflow_dispatches');

  const worker = fs.readFileSync(path.join(ROOT, 'lib/services/transcription-pilot/worker.js'), 'utf8');
  expect(worker).toContain('if (!jobSubmissionEnabled(job))');
  expect(worker).toContain('isMeetingTranscriptionRequestAllowed(job.request_id');
});
