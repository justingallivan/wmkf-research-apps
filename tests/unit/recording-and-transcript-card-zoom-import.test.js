/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RecordingAndTranscriptCard from '../../shared/components/meeting-tracker/RecordingAndTranscriptCard';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../shared/config/requestDocument';

jest.mock('@vercel/blob/client', () => ({ put: jest.fn() }));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_REQUEST_ID = '66666666-6666-4666-8666-666666666666';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const VISIT_ID = '55555555-5555-4555-8555-555555555555';
const UUID_A = 'meeting-a==';
const UUID_B = 'meeting-b==';
const UUID_C = 'meeting-c==';

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const collection = (overrides = {}) => ({ featureState: 'enabled', siteVisitActivityId: VISIT_ID, candidateSources: {}, candidates: [],
  jobs: [], currentArtifact: null, publications: [], correctionDrafts: [], ...overrides });
const zoomList = (overrides = {}) => ({ available: true, windowDays: 30, meetings: [
  { meetingUuid: UUID_A, startTime: '2026-10-05T17:00:00Z', durationMinutes: 62, hostEmail: 'h@x.org', audio: { bytes: 5 }, transcript: { bytes: 3 }, import: null },
  { meetingUuid: UUID_B, startTime: '2026-10-04T20:30:00Z', durationMinutes: 45, hostEmail: 'h@x.org', audio: { bytes: 5 }, transcript: null, import: null },
  { meetingUuid: UUID_C, startTime: '2026-10-03T20:30:00Z', durationMinutes: 10, hostEmail: 'h@x.org', audio: null, transcript: null, import: null },
], ...overrides });

function route(state = {}, handlers = {}) {
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    const method = options.method || 'GET';
    for (const [match, handler] of Object.entries(handlers)) {
      if (path.includes(match) && (!handler.method || handler.method === method)) return handler.respond(path, options);
    }
    if (path.endsWith('/presentation-link')) return response({ link: null });
    if (path.endsWith('/presentation-materials')) return response({ materials: state.materials || [], uploads: [] });
    if (path.endsWith('/transcriptions')) return response(state.collection || collection());
    return response({});
  });
}
const zoomCalls = () => global.fetch.mock.calls.filter(([url]) => String(url).includes('/zoom-'));
const importButton = () => screen.getByRole('button', { name: 'Import from Zoom' });
async function openPanel() {
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Import from Zoom' }));
  return screen.findByTestId('zoom-import');
}
const pacific = '10:00 AM PT';

afterEach(() => { jest.restoreAllMocks(); });

test('mounting the card makes no Zoom call; Stage 1 step 1 is unchanged and the import entry is offered', async () => {
  route();
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  expect(await screen.findByTestId('generate-form')).toBeInTheDocument();
  expect(importButton()).toBeInTheDocument();
  expect(zoomCalls()).toEqual([]);
});

test.each([
  ['{available:false}', () => response({ available: false })],
  ['an unknown-route {} response', () => response({})],
  ['available:"true" (not the boolean)', () => response({ available: 'true', meetings: [] })],
  ['available:true without a meetings array', () => response({ available: true })],
])('%s leaves step 1 as it was and removes the entry', async (_label, respond) => {
  route({}, { '/zoom-recordings': { respond } });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Import from Zoom' }));
  expect(await screen.findByText('Loading Zoom recordings…')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Loading Zoom recordings…')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Import from Zoom' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('zoom-import')).not.toBeInTheDocument();
  expect(screen.getByTestId('generate-form')).toBeInTheDocument();
  expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
});

test('a failed list shows one quiet line, keeps the manual inputs and can be retried', async () => {
  let attempts = 0;
  route({}, { '/zoom-recordings': { respond: () => (++attempts === 1 ? response({ error: 'x' }, 500) : response(zoomList())) } });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Import from Zoom' }));
  expect(await screen.findByText('Zoom recordings could not be loaded.')).toBeInTheDocument();
  expect(screen.getByTestId('generate-form')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByTestId('zoom-import')).toBeInTheDocument();
});

test('available: meetings list by Pacific date and time, the manual inputs collapse and "Other ways" reveals them', async () => {
  route({}, { '/zoom-recordings': { respond: () => response(zoomList()) } });
  const panel = await openPanel();
  expect(within(panel).getByText(new RegExp(`Oct 5.*${pacific}`))).toBeInTheDocument();
  expect(within(panel).getByText('62 min · Audio + Zoom transcript')).toBeInTheDocument();
  expect(within(panel).getByText('45 min · Audio only')).toBeInTheDocument();
  expect(within(panel).getByText('10 min · No audio yet')).toBeInTheDocument();
  expect(within(panel).getByRole('radio', { name: /Oct 3/ })).toBeDisabled();
  expect(screen.queryByTestId('generate-form')).not.toBeInTheDocument();
  expect(screen.queryByText('Video recording')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Other ways to add a recording' }));
  expect(screen.getByTestId('generate-form')).toBeInTheDocument();
  expect(screen.getByText('Video recording')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload a finished transcript instead' })).toBeInTheDocument();
  expect(zoomCalls().every(([url]) => String(url).endsWith('/zoom-recordings'))).toBe(true);
});

test('choosing a meeting shows the consent text and gates Import and transcribe on it', async () => {
  route({}, { '/zoom-recordings': { respond: () => response(zoomList()) } });
  const panel = await openPanel();
  expect(within(panel).queryByRole('button', { name: 'Import and transcribe' })).not.toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('radio', { name: /Oct 5/ }));
  expect(within(panel).getByText(/Excerpts of both transcripts are also sent to Anthropic/)).toBeInTheDocument();
  expect(within(panel).getByText(/Transcription uses paid credits/)).toBeInTheDocument();
  const submit = within(panel).getByRole('button', { name: 'Import and transcribe' });
  expect(submit).toBeDisabled();
  fireEvent.click(within(panel).getByRole('radio', { name: /Oct 4/ }));
  expect(within(panel).queryByText(/sent to Anthropic/)).not.toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('checkbox'));
  expect(within(panel).getByRole('button', { name: 'Import and transcribe' })).toBeEnabled();
  expect(zoomCalls().some(([, options]) => options?.method === 'POST')).toBe(false);
});

test('importing posts only the meeting and the acknowledgement, reloads the collection, and shows the meeting as imported', async () => {
  const post = jest.fn(() => response({ import: { id: 'i1', state: 'started', failureCode: null }, job: { id: JOB_ID } }));
  route({}, {
    '/zoom-recordings': { respond: () => response(zoomList()) },
    '/zoom-imports': { method: 'POST', respond: (_p, options) => post(JSON.parse(options.body)) },
  });
  const panel = await openPanel();
  const before = global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/transcriptions')).length;
  fireEvent.click(within(panel).getByRole('radio', { name: /Oct 5/ }));
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.click(within(panel).getByRole('button', { name: 'Import and transcribe' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith({ meetingUuid: UUID_A, nonSensitiveAcknowledged: true }));
  const call = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/zoom-imports'));
  expect(call[0]).toBe(`/api/meeting-tracker/visits/${REQUEST_ID}/zoom-imports`);
  expect(Object.keys(JSON.parse(call[1].body)).sort()).toEqual(['meetingUuid', 'nonSensitiveAcknowledged']);
  await waitFor(() => expect(global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/transcriptions')).length).toBeGreaterThan(before));
  expect(await within(panel).findByText('62 min · Audio + Zoom transcript · Imported, transcription started')).toBeInTheDocument();
  expect(within(panel).getByRole('radio', { name: /Oct 5/ })).toBeDisabled();
  expect(within(panel).queryByRole('button', { name: 'Import and transcribe' })).not.toBeInTheDocument();
});

test('a busy import keeps step 1 open even when a finished transcript would have collapsed it', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const materials = [{ artifactId: '33333333-3333-4333-8333-333333333333', artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, artifactTypeLabel: 'Transcript',
    backing: 'file', filename: 'transcript.txt', createdAt: '2026-10-04T22:24:00.000Z', slotVersion: 3, webUrl: 'https://example.sharepoint.com/t.txt' }];
  route({ materials, collection: collection({ jobs: [] }) }, {
    '/zoom-recordings': { respond: () => response(zoomList()) },
    '/zoom-imports': { method: 'POST', respond: async () => { await gate; return response({ import: { id: 'i1', state: 'started', failureCode: null }, job: { id: JOB_ID } }); } },
  });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Replace audio or transcript' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import from Zoom' }));
  const panel = await screen.findByTestId('zoom-import');
  fireEvent.click(within(panel).getByRole('radio', { name: /Oct 4/ }));
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.click(within(panel).getByRole('button', { name: 'Import and transcribe' }));
  expect(await within(panel).findByRole('button', { name: 'Importing from Zoom…' })).toBeDisabled();
  expect(within(panel).getByText(/Keep this page open/)).toBeInTheDocument();
  expect(screen.getByTestId('step-recording')).toHaveAttribute('data-step-state', 'current');
  expect(within(panel).getByRole('radio', { name: /Oct 5/ }).closest('fieldset')).toBeDisabled();
  await act(async () => { release(); await gate; });
  await waitFor(() => expect(within(panel).queryByRole('button', { name: 'Importing from Zoom…' })).not.toBeInTheDocument());
});

test('a failed import shows the server message and refreshes the list quietly', async () => {
  let lists = 0;
  route({}, {
    '/zoom-recordings': { respond: () => response(++lists === 1 ? zoomList() : zoomList({ meetings: [{ ...zoomList().meetings[0], import: { state: 'importing', jobId: null, failureCode: null } }] })) },
    '/zoom-imports': { method: 'POST', respond: () => response({ error: 'This recording is already being imported.', code: 'zoom_import_in_progress' }, 409) },
  });
  const panel = await openPanel();
  fireEvent.click(within(panel).getByRole('radio', { name: /Oct 5/ }));
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.click(within(panel).getByRole('button', { name: 'Import and transcribe' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent('This recording is already being imported.');
  expect(await within(panel).findByText('62 min · Audio + Zoom transcript · Importing…')).toBeInTheDocument();
  expect(screen.getByTestId('zoom-import')).toBeInTheDocument();
});

test('an active transcription blocks starting another import', async () => {
  route({ collection: collection({ jobs: [{ id: JOB_ID, status: 'processing', version: 1, created_at: '2026-10-04T20:00:00.000Z', original_filename: 'x.m4a', label: 'Transcribing', needsAttention: false, contentAccessAllowed: false, speaker_names: {} }] }) },
    { '/zoom-recordings': { respond: () => response(zoomList()) } });
  const panel = await openPanel();
  fireEvent.click(within(panel).getByRole('radio', { name: /Oct 5/ }));
  fireEvent.click(within(panel).getByRole('checkbox'));
  expect(within(panel).getByRole('button', { name: 'Import and transcribe' })).toBeDisabled();
  expect(within(panel).getByText(/Another transcription is already running/)).toBeInTheDocument();
});

test('a list response for an earlier request is ignored after the card moves to another request', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  route({}, { [`${REQUEST_ID}/zoom-recordings`]: { respond: async () => { await gate; return response(zoomList()); } } });
  const view = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Import from Zoom' }));
  expect(await screen.findByText('Loading Zoom recordings…')).toBeInTheDocument();
  view.rerender(<RecordingAndTranscriptCard requestId={OTHER_REQUEST_ID} />);
  await screen.findByRole('button', { name: 'Import from Zoom' });
  await act(async () => { release(); await gate; });
  expect(screen.queryByTestId('zoom-import')).not.toBeInTheDocument();
  expect(importButton()).toBeInTheDocument();
});

test('an import response for an earlier request never reloads or marks the current card', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  route({}, {
    '/zoom-recordings': { respond: () => response(zoomList()) },
    [`${REQUEST_ID}/zoom-imports`]: { method: 'POST', respond: async () => { await gate; return response({ import: { id: 'i1', state: 'started', failureCode: null }, job: { id: JOB_ID } }); } },
  });
  const view = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Import from Zoom' }));
  const panel = await screen.findByTestId('zoom-import');
  fireEvent.click(within(panel).getByRole('radio', { name: /Oct 5/ }));
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.click(within(panel).getByRole('button', { name: 'Import and transcribe' }));
  await screen.findByRole('button', { name: 'Importing from Zoom…' });
  view.rerender(<RecordingAndTranscriptCard requestId={OTHER_REQUEST_ID} />);
  await screen.findByRole('button', { name: 'Import from Zoom' });
  const oldCollectionReads = () => global.fetch.mock.calls.filter(([url]) => String(url).endsWith(`${REQUEST_ID}/transcriptions`)).length;
  const before = oldCollectionReads();
  await act(async () => { release(); await gate; });
  expect(oldCollectionReads()).toBe(before);
  expect(screen.queryByTestId('zoom-import')).not.toBeInTheDocument();
  expect(screen.queryByText(/Imported, transcription started/)).not.toBeInTheDocument();
});

test('an import response after the card unmounts writes nothing and reloads nothing', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  route({}, {
    '/zoom-recordings': { respond: () => response(zoomList()) },
    '/zoom-imports': { method: 'POST', respond: async () => { await gate; return response({ import: { id: 'i1', state: 'started', failureCode: null }, job: { id: JOB_ID } }); } },
  });
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const view = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Import from Zoom' }));
  const panel = await screen.findByTestId('zoom-import');
  fireEvent.click(within(panel).getByRole('radio', { name: /Oct 5/ }));
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.click(within(panel).getByRole('button', { name: 'Import and transcribe' }));
  await screen.findByRole('button', { name: 'Importing from Zoom…' });
  view.unmount();
  const reads = () => global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/transcriptions')).length;
  const before = reads();
  await act(async () => { release(); await gate; });
  expect(reads()).toBe(before);
  expect(consoleError).not.toHaveBeenCalled();
});

test('a meeting whose transcription did not finish shows plain copy and can be chosen again', async () => {
  const meetings = zoomList().meetings.map((m, i) => (i === 0 ? { ...m, import: { state: 'failed', jobId: JOB_ID, failureCode: 'zoom_import_job_ended' } } : m));
  route({}, { '/zoom-recordings': { respond: () => response(zoomList({ meetings })) } });
  const panel = await openPanel();
  expect(within(panel).getByText('62 min · Audio + Zoom transcript · Last transcription did not finish')).toBeInTheDocument();
  expect(within(panel).getByRole('radio', { name: /Oct 5/ })).toBeEnabled();
});
