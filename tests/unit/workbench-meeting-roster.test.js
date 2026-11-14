/** @jest-environment node */
import handler from '../../pages/api/workbench/meeting-roster';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { findSummariesByRequests } from '../../lib/dataverse/adapters/site-visit';
import { requireAppAccess } from '../../lib/utils/auth';
import { isMeetingTranscriptBundleSchemaReady } from '../../lib/utils/meeting-transcript-bundle-readiness';
import { bindPresentationTranscript } from '../../lib/services/post-presentation-materials/presentation-transcript-binding';
import { validateMeetingTranscriptManifest } from '../../lib/services/meeting-tracker-transcription/bundle';
import { resolveSourceProvenance } from '../../lib/services/meeting-tracker-transcription/source-provenance';
import { getMeetingAttendance } from '../../lib/services/meeting-tracker-recordings/zoom-client';
import { getSettingStrict } from '../../lib/services/settings-service';
import { presentationAttendeeNames } from '../../lib/services/workbench/meeting-roster-service';

// The phase rollout setting (phase-admission.js): absent, which outside Production means on.
jest.mock('../../lib/services/settings-service', () => ({ getSettingStrict: jest.fn(async () => ({ found: false, value: null, revision: null })) }));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn(), updateById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  linkedCycleCode: row => row?.cycleCode, linkedCycleExpand: () => 'cycle',
}));
jest.mock('../../lib/dataverse/adapters/site-visit', () => ({
  findSummariesByRequests: jest.fn(),
}));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/utils/meeting-transcript-bundle-readiness', () => ({
  isMeetingTranscriptBundleSchemaReady: jest.fn(),
}));

jest.mock('../../lib/dataverse/adapters/request-document', () => ({ findByRequest: async () => ({ records: [] }) }));
jest.mock('../../lib/services/post-presentation-materials/material-model', () => ({
  projectPostPresentationMaterials: () => ({ winners: [] }),
}));
jest.mock('../../lib/services/post-presentation-materials/presentation-transcript-binding', () => ({
  bindPresentationTranscript: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker-transcription/bundle', () => ({
  validateMeetingTranscriptManifest: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker-transcription/source-provenance', () => ({
  resolveSourceProvenance: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker-recordings/zoom-client', () => ({ getMeetingAttendance: jest.fn() }));

const requestId = '11111111-1111-4111-8111-111111111111';
const visitId = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const visit = { activityid: visitId, _regardingobjectid_value: requestId, _etag: 'W/"123"',
  statecode: 1, statuscode: 2, scheduledstart: '2027-03-01T18:00:00Z', scheduledend: '2027-03-01T19:00:00Z' };
const env = process.env;

async function call(method, body, query = {}) {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  await handler({ method, query: { requestId, ...query }, body }, res);
  return [res.status.mock.calls[0][0], res.json.mock.calls[0][0]];
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...env, VERCEL_ENV: 'preview', MEETING_ROSTER_SCHEMA_READY: 'on', DYNAMICS_URL: 'https://orgd9e66399.crm.dynamics.com',
    DYNAMICS_IMPERSONATION_ENABLED: 'true' };
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: actor } } });
  getById.mockResolvedValue({ akoya_requestid: requestId, cycleCode: 'J27', _etag: visit._etag });
  findSummariesByRequests.mockResolvedValue({ records: [visit] });
});
afterEach(() => { process.env = env; });

async function saveBody() {
  const [, { presentation }] = await call('GET');
  return { requestId, visitId, version: presentation.version, binding: presentation.binding,
    wmkf: ['Avery Morgan', 'Jordan Lee'], consultants: ['Casey Reed'] };
}

test('manually confirms one occurrence and reads a copyable sentence', async () => {
  const body = await saveBody();
  expect((await call('POST', body))[0]).toBe(200);
  const [id, patch, options] = updateById.mock.calls[0];
  expect([id, patch, options]).toEqual([requestId, patch, { ifMatch: visit._etag, actingUserSystemId: actor, noFallback: true }]);
  expect(JSON.parse(patch.wmkf_confirmedmeetingroster)[visitId]).toMatchObject({
    binding: body.binding, confirmedBy: actor, wmkf: body.wmkf, consultants: body.consultants,
  });
  getById.mockResolvedValue({ akoya_requestid: requestId, cycleCode: 'J27', _etag: visit._etag, ...patch });
  expect((await call('GET'))[1].sentence).toBe(
    'WMKF attendees included Avery Morgan and Jordan Lee. Casey Reed attended as a consultant.',
  );
  findSummariesByRequests.mockResolvedValue({ records: [{ ...visit, scheduledend: '2027-03-01T19:30:00Z' }] });
  expect((await call('GET'))[1]).toMatchObject({ stale: true, sentence: '' });
  expect((await call('POST', body))[0]).toBe(409);
  expect(updateById).toHaveBeenCalledTimes(1);
});

test('never writes a stale version or a presentation outside the request', async () => {
  const body = await saveBody();
  getById.mockResolvedValue({ akoya_requestid: requestId, cycleCode: 'J27', _etag: 'W/"124"' });
  expect((await call('POST', body))[0]).toBe(409);
  getById.mockResolvedValue({ akoya_requestid: requestId, cycleCode: 'J27', _etag: visit._etag });
  findSummariesByRequests.mockResolvedValue({ records: [{ ...visit, _regardingobjectid_value: actor }] });
  expect((await call('POST', body))[0]).toBe(409);
  expect(updateById).not.toHaveBeenCalled();
});

test('rejects production-backed Preview before reading a request', async () => {
  process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com';
  expect((await call('POST', { requestId }))[0]).toBe(404);
  expect(getById).not.toHaveBeenCalled();
});

test('suggestions use only in-meeting presence that overlaps the presentation', () => {
  const row = (name, status, join, leave) => ({
    name, status, join_time: `2027-03-01T18:${join}:00Z`, leave_time: `2027-03-01T18:${leave}:00Z`,
  });
  const report = { status: 'complete', participants: [
    row('Avery Morgan', 'in_meeting', '01', '21'),
    row('Avery Morgan', 'in_meeting', '22', '30'),
    row('Waiting only', 'in_waiting_room', '01', '29'),
    row('Debrief only', 'in_meeting', '25', '55'),
  ] };
  const zoom = {start: Date.parse('2027-03-01T18:00:00Z'), end: Date.parse('2027-03-01T18:25:00Z')};
  expect(presentationAttendeeNames(report, zoom)).toEqual(['Avery Morgan']);
  expect(presentationAttendeeNames({ ...report, status: 'partial' }, zoom)).toBeNull();
});

test('sandbox refuses the roster before its schema is enabled', async () => {
  delete process.env.MEETING_ROSTER_SCHEMA_READY;
  expect((await call('GET'))[0]).toBe(404);
  expect(getById).not.toHaveBeenCalled();
});

test('loads Zoom only on demand, using verified occurrence provenance and the confirmed boundary', async () => {
  isMeetingTranscriptBundleSchemaReady.mockReturnValue(true);
  bindPresentationTranscript.mockReturnValue({
    transcript: { wmkf_transcriptbundlejson: '{}' }, boundary: { presentationEnd: { endMs: 20 * 60 * 1000 } },
  });
  validateMeetingTranscriptManifest.mockReturnValue({ sourceProvenance: {} });
  resolveSourceProvenance.mockReturnValue({ status: 'verified_zoom', provenance: {
    audioDurationMs: 30 * 60 * 1000,
    zoom: { meetingUuid: 'verified-occurrence', audioOnlyFileCount: 1, audioFile: {
      recordingStart: '2027-03-01T18:00:00Z', recordingEnd: '2027-03-01T18:30:00Z',
    } },
  } });
  getMeetingAttendance.mockResolvedValue({ status: 'complete', participants: [{
    name: 'Avery Morgan', status: 'in_meeting',
    join_time: '2027-03-01T18:01:00Z', leave_time: '2027-03-01T18:22:00Z',
  }] });
  const [, initial] = await call('GET');
  expect(getMeetingAttendance).not.toHaveBeenCalled();
  const [, withSuggestions] = await call('GET', null, { suggest: 'yes' });
  expect(withSuggestions).toMatchObject({ suggestions: ['Avery Morgan'], presentation: initial.presentation });
  expect(validateMeetingTranscriptManifest).toHaveBeenCalledWith({}, { requestId, siteVisitActivityId: visitId });
  expect(getMeetingAttendance).toHaveBeenCalledWith('verified-occurrence', { timeoutMs: 5000 });
  getMeetingAttendance.mockRejectedValue(new Error('Zoom unavailable'));
  expect((await call('GET', null, { suggest: 'yes' }))[1]).toMatchObject({ suggestions: null, presentation: initial.presentation });
});

test('does not guess which presentation to use when multiple occurrences are eligible', async () => {
  findSummariesByRequests.mockResolvedValue({ records: [
    visit, { ...visit, activityid: actor, statecode: 3, statuscode: 4 },
  ] });
  expect((await call('GET'))[0]).toBe(409);
  expect(updateById).not.toHaveBeenCalled();
});

// The step belongs to every cycle from J27 on, not to the cycle named J27.
test.each([['D27', 200], ['D26', 404]])('cycle %s reads with status %s', async (cycleCode, expected) => {
  getById.mockResolvedValue({ akoya_requestid: requestId, cycleCode, _etag: visit._etag });
  const [status] = await call('GET');
  expect(status).toBe(expected);
});

describe('stageFacts for the request page stage', () => {
  test('no accepted presentation: presentation is null and the keys say absent', async () => {
    // Setup has no records at all, so no presentation exists under either rule.
    findSummariesByRequests.mockResolvedValue({ records: [] });
    const [status, body] = await call('GET');
    expect(status).toBe(200);
    expect(body.presentation).toBeNull();
    expect(body.stageFacts.presentation.exists).toBe(false);
    expect(body.stageFacts.roster).toEqual({ status: 'absent' });
  });

  test('a saved matching roster is present and fresh, and stale once the presentation is rescheduled', async () => {
    const body = await saveBody();
    await call('POST', body);
    const [, patch] = updateById.mock.calls[0];
    getById.mockResolvedValue({ akoya_requestid: requestId, cycleCode: 'J27', _etag: visit._etag, ...patch });
    const [, fresh] = await call('GET');
    expect(fresh.stageFacts.roster).toEqual({ status: 'present', stale: false });
    expect(fresh.stageFacts.presentation).toMatchObject({ status: 'present', exists: true, id: visitId });
    // Different scheduledend than the saved binding.
    findSummariesByRequests.mockResolvedValue({ records: [{ ...visit, scheduledend: '2027-03-01T19:30:00Z' }] });
    const [, moved] = await call('GET');
    expect(moved.stageFacts.roster).toEqual({ status: 'present', stale: true });
  });
});

describe('in Production (phase admission and manual attendance)', () => {
  const production = (rollout) => {
    process.env = { ...env, VERCEL_ENV: 'production', DYNAMICS_URL: 'https://wmkf.crm.dynamics.com',
      WORKBENCH_PRODUCTION_SCHEMA_READY: 'on', WORKBENCH_PHASE_RELEASE: 'on', DYNAMICS_IMPERSONATION_ENABLED: 'true' };
    getSettingStrict.mockResolvedValue({ found: true, value: JSON.stringify(rollout), revision: 'W/"1"' });
  };
  const zoomReady = () => {
    isMeetingTranscriptBundleSchemaReady.mockReturnValue(true);
    bindPresentationTranscript.mockReturnValue({
      transcript: { wmkf_transcriptbundlejson: '{}' }, boundary: { presentationEnd: { endMs: 20 * 60 * 1000 } },
    });
    validateMeetingTranscriptManifest.mockReturnValue({ sourceProvenance: {} });
    resolveSourceProvenance.mockReturnValue({ status: 'verified_zoom', provenance: {
      audioDurationMs: 30 * 60 * 1000,
      zoom: { meetingUuid: 'verified-occurrence', audioOnlyFileCount: 1, audioFile: {
        recordingStart: '2027-03-01T18:00:00Z', recordingEnd: '2027-03-01T18:30:00Z',
      } },
    } });
    getMeetingAttendance.mockResolvedValue({ status: 'complete', participants: [{ name: 'Avery Morgan', status: 'in_meeting',
      join_time: '2027-03-01T18:01:00Z', leave_time: '2027-03-01T18:22:00Z' }] });
  };

  test('a direct suggest=yes makes no Zoom request, and the panel offers no Zoom action', async () => {
    production({ mode: 'on' });
    zoomReady();
    const [status, body] = await call('GET', null, { suggest: 'yes' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ suggestions: null, canSuggest: false });
    expect(getMeetingAttendance).not.toHaveBeenCalled();
    expect(validateMeetingTranscriptManifest).not.toHaveBeenCalled();
  });

  test('manual confirmation still saves', async () => {
    production({ mode: 'on' });
    const body = await saveBody();
    expect((await call('POST', body))[0]).toBe(200);
    expect(updateById).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['off', { mode: 'off' }],
    ['a pilot without this request', { mode: 'pilot', requestIds: [visitId] }],
  ])('setting %s: GET and POST are refused before the request is read', async (_label, rollout) => {
    production(rollout);
    expect((await call('GET'))[0]).toBe(404);
    expect((await call('POST', { requestId, visitId, version: 'W/"123"', binding: 'a'.repeat(64), wmkf: [], consultants: [] }))[0]).toBe(404);
    expect(getById).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  test('a pilot naming this request is admitted', async () => {
    production({ mode: 'pilot', requestIds: [requestId] });
    expect((await call('GET'))[0]).toBe(200);
  });

  test('switched off between the page load and the save: nothing is written', async () => {
    production({ mode: 'on' });
    const body = await saveBody();
    // Route entry still sees on; the re-check just before the write sees off.
    getSettingStrict
      .mockResolvedValueOnce({ found: true, value: '{"mode":"on"}' })
      .mockResolvedValueOnce({ found: true, value: '{"mode":"off"}' });
    expect((await call('POST', body))[0]).toBe(404);
    expect(updateById).not.toHaveBeenCalled();
  });

  test('without the cycle page release the roster is refused even with the setting on', async () => {
    production({ mode: 'on' });
    delete process.env.WORKBENCH_PHASE_RELEASE;
    expect((await call('GET'))[0]).toBe(404);
    expect(getById).not.toHaveBeenCalled();
  });
});
