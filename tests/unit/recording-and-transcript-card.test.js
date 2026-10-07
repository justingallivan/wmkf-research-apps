/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { put } from '@vercel/blob/client';
import RecordingAndTranscriptCard from '../../shared/components/meeting-tracker/RecordingAndTranscriptCard';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../shared/config/requestDocument';

jest.mock('@vercel/blob/client', () => ({ put: jest.fn() }));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_REQUEST_ID = '66666666-6666-4666-8666-666666666666';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const ARTIFACT_ID = '33333333-3333-4333-8333-333333333333';
const VISIT_ID = '55555555-5555-4555-8555-555555555555';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function job(overrides = {}) {
  return {
    id: JOB_ID, status: 'ready', version: 1,
    created_at: '2026-10-04T20:00:00.000Z', ready_at: '2026-10-04T20:20:00.000Z',
    original_filename: 'Oregon State recording.m4a', label: 'Ready', needsAttention: false,
    contentAccessAllowed: true, speaker_names: {}, ...overrides,
  };
}

const content = {
  text: 'Hello from the site visit.\nWe have a question.',
  utterances: [
    { speaker: 'A', start: 62000, end: 62900, text: 'Hello from the site visit.' },
    { speaker: 'B', start: 125000, end: 127300, text: 'We have a question.' },
  ],
};

function collection(overrides = {}) {
  return {
    featureState: 'enabled', siteVisitActivityId: VISIT_ID, candidateSources: {}, candidates: [],
    jobs: [job()], currentArtifact: null, publications: [], correctionDrafts: [], ...overrides,
  };
}

function transcriptRow(overrides = {}) {
  return {
    artifactId: ARTIFACT_ID, artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, artifactTypeLabel: 'Transcript',
    backing: 'file', filename: 'transcript.txt', createdAt: '2026-10-04T22:24:00.000Z', slotVersion: 3,
    webUrl: 'https://example.sharepoint.com/transcript.txt', ...overrides,
  };
}

// Routes the card's two data sets. `state` is mutable so a test can change what the next refresh returns.
function route(state, handlers = {}) {
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    const method = options.method || 'GET';
    for (const [match, handler] of Object.entries(handlers)) {
      if (path.includes(match) && (!handler.method || handler.method === method)) return handler.respond(path, options);
    }
    if (path.endsWith('/presentation-link')) return response({ link: null });
    if (path.endsWith('/presentation-materials')) return response({ materials: state.materials || [], uploads: [] });
    if (path.endsWith('/transcriptions')) return response(state.collection);
    if (path.endsWith(`/transcriptions/${JOB_ID}`)) return response(state.detail());
    return response({});
  });
}

test('the visit fragment scrolls to the card once after it mounts', async () => {
  const scrollIntoView = jest.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  window.history.replaceState({}, '', '/visit#recording-and-transcript-card');
  route({ materials: [], collection: collection({ jobs: [], currentArtifact: null }), detail: detailFor({}) });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  await screen.findByTestId('recording-and-transcript-card');
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Upload a transcript' }));
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
});

test('the card does not scroll for a different or absent fragment', async () => {
  const scrollIntoView = jest.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  window.history.replaceState({}, '', '/visit#other-section');
  route({ materials: [], collection: collection({ jobs: [], currentArtifact: null }), detail: detailFor({}) });
  const view = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  await screen.findByTestId('recording-and-transcript-card');
  expect(scrollIntoView).not.toHaveBeenCalled();
  window.history.replaceState({}, '', '/visit');
  view.rerender(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  expect(scrollIntoView).not.toHaveBeenCalled();
});

const CONFIRMED_AT = '2026-10-04T23:30:00.000Z';
function boundaryArtifact(overrides = {}) {
  return {
    id: ARTIFACT_ID, fingerprint: 'e'.repeat(64), bundleEditable: true,
    presentationEnd: { endMs: 62900, confirmedBy: 42, confirmedAt: CONFIRMED_AT },
    presentationTranscript: { state: 'bound', artifactId: ARTIFACT_ID },
    staffDiscussionTranscript: { state: 'bound', artifactId: ARTIFACT_ID },
    ...overrides,
  };
}
const CORRECTION_ID = '88888888-8888-4888-8888-888888888888';
function draftCorrection(overrides = {}) {
  return { operationId: CORRECTION_ID, state: 'draft', version: 1, speakerNames: {}, presentationEndMs: null, expectedCurrentArtifactId: ARTIFACT_ID, expectedCurrentFingerprint: 'e'.repeat(64), ...overrides };
}
function correctionDetail(artifact, overrides = {}) {
  return {
    correction: draftCorrection(), content, currentArtifact: artifact, candidates: [],
    presentationEnd: { current: null, draft: null, proposed: { endMs: 62900, speakerId: 'A', utteranceIndex: 0 } }, ...overrides,
  };
}

const shortDate = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const detailFor = (jobOverrides) => () => ({ job: job(jobOverrides), content, candidates: [] });

let originalScrollIntoViewDescriptor;
beforeEach(() => { originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView'); });
afterEach(() => {
  jest.restoreAllMocks();
  put.mockReset();
  window.history.replaceState({}, '', '/');
  if (originalScrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoViewDescriptor);
  else delete HTMLElement.prototype.scrollIntoView;
});

test('an existing Board page can be opened and its included and excluded material scope is clear', async () => {
  route({ materials: [], collection: collection({ jobs: [], currentArtifact: null }), detail: detailFor({}) }, {
    '/presentation-link': { respond: () => response({ link: { url: 'https://example.test/external/presentation/token', expiresAt: '2026-11-01T00:00:00.000Z' } }) },
  });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  expect(await screen.findByRole('link', { name: 'Open Board page' })).toHaveAttribute('href', 'https://example.test/external/presentation/token');
  expect(screen.getByText(/can include applicant materials and current presentation transcript and summary/)).toBeInTheDocument();
  expect(screen.getByText(/excludes the full recording and staff discussion/)).toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

test('seeds names from the job on load, then adopts names that arrive when matching finishes', async () => {
  let current = { speaker_names: { A: 'Alex Lee' } };
  const state = { collection: collection({ jobs: [job(current)] }), detail: () => detailFor(current)() };
  route(state);
  const { unmount } = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  expect(await screen.findByLabelText('Name for Speaker A')).toHaveValue('Alex Lee');
  expect(screen.getByText('Names saved')).toBeInTheDocument();
  expect(screen.queryByText('Unsaved name changes')).not.toBeInTheDocument();
  unmount();

  current = { speaker_alignment: { status: 'running', speakers: {}, suggestions: {} }, speaker_names: {} };
  state.collection = collection({ jobs: [job(current)] });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  expect(await screen.findByText('Matching names from Zoom captions…')).toBeInTheDocument();
  expect(screen.getByLabelText('Name for Speaker A')).toBeDisabled();
  current = {
    speaker_alignment: { status: 'partial', speakers: { A: { name: 'Alex Lee', confidence: 0.97 }, B: { name: 'Jordan Rivera', confidence: 0.9 } }, suggestions: {} },
    speaker_names: { A: 'Alex Lee', B: 'Jordan Rivera' }, version: 2,
  };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.getByLabelText('Name for Speaker A')).toHaveValue('Alex Lee'));
  expect(screen.getByLabelText('Name for Speaker B')).toHaveValue('Jordan Rivera');
  expect(screen.getByText('Names saved')).toBeInTheDocument();
  expect(screen.queryByText('Unsaved name changes')).not.toBeInTheDocument();
});

test('a 409 on save keeps local names, shows the conflict notice, and Refresh reloads without clearing them', async () => {
  let version = 1;
  const state = { collection: collection({ jobs: [job({ speaker_names: { A: 'Alex Lee' } })] }), detail: () => detailFor({ speaker_names: { A: 'Alex Lee' }, version })() };
  route(state, { '/speakers': { method: 'PATCH', respond: () => response({ code: 'version_conflict', message: 'stale' }, 409) } });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const field = await screen.findByLabelText('Name for Speaker B');
  fireEvent.change(field, { target: { value: 'My edit' } });
  expect(screen.getByText('Unsaved name changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
  expect(await screen.findByText(/This draft changed elsewhere/)).toBeInTheDocument();
  expect(screen.getByLabelText('Name for Speaker B')).toHaveValue('My edit');
  version = 2;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.queryByText(/This draft changed elsewhere/)).not.toBeInTheDocument());
  expect(screen.getByLabelText('Name for Speaker B')).toHaveValue('My edit');
  expect(screen.getByLabelText('Name for Speaker A')).toHaveValue('Alex Lee');
});

test('the current line uses the material row date and version and joins the source through the publication', async () => {
  const state = {
    materials: [transcriptRow()],
    collection: collection({
      currentArtifact: { id: ARTIFACT_ID, fingerprint: 'a'.repeat(64), bundleEditable: true },
      publications: [
        { operationId: 'op-1', state: 'published', version: 99, createdAt: '2026-01-02T03:04:00.000Z', inputJobId: JOB_ID, resultingDocumentId: ARTIFACT_ID },
      ],
    }),
    detail: detailFor({}),
  };
  route(state);
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const line = await screen.findByTestId('current-transcript-line');
  await waitFor(() => expect(line.textContent).toContain('from Oregon State recording'));
  expect(line.textContent).toBe(`Published ${shortDate('2026-10-04T22:24:00.000Z')} · from Oregon State recording · version 3`);
  expect(line.textContent).not.toContain('99');
  expect(line.textContent).not.toContain('Jan');
  expect(screen.getByRole('button', { name: 'Edit speaker names' })).toBeInTheDocument();
});

test('draft publication rows render nothing; an unfinished publish shows plain copy with Check now', async () => {
  const state = {
    collection: collection({
      publications: [
        { operationId: 'op-draft', state: 'draft', version: 1, createdAt: '2026-10-01T00:00:00.000Z', sourceArtifactId: ARTIFACT_ID },
        { operationId: 'op-stuck', state: 'published_reconcile', version: 4, createdAt: '2026-10-04T00:00:00.000Z', inputJobId: 'other-job', resultingDocumentId: ARTIFACT_ID },
      ],
    }),
    detail: detailFor({}),
  };
  route(state);
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const block = await screen.findByTestId('needs-attention');
  expect(block).toHaveAttribute('open');
  expect(within(block).getAllByRole('listitem')).toHaveLength(1);
  expect(within(block).getByText('Publishing did not finish. Check now.')).toBeInTheDocument();
  expect(within(block).getByRole('button', { name: 'Check now' })).toBeInTheDocument();
  expect(screen.queryByText('Publication status')).not.toBeInTheDocument();
});

test('an uploaded transcript with no source bundle shows no editor and says names cannot be edited', async () => {
  const state = {
    materials: [transcriptRow({ filename: 'Transcript.vtt' })],
    collection: collection({ jobs: [], currentArtifact: { id: ARTIFACT_ID, fingerprint: 'b'.repeat(64), bundleEditable: false } }),
    detail: detailFor({}),
  };
  route(state);
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const line = await screen.findByTestId('current-transcript-line');
  expect(line.textContent).toBe(`Uploaded ${shortDate('2026-10-04T22:24:00.000Z')} · VTT file`);
  expect(screen.getByText(/speaker names cannot be edited here/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit speaker names' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Name for Speaker/)).not.toBeInTheDocument();
});

test('when transcription is not enabled, Generate is disabled with the reason and uploading a transcript still works', async () => {
  const state = { collection: collection({ featureState: 'disabled', jobs: [], currentArtifact: null }), detail: detailFor({}) };
  const uploaded = transcriptRow({ filename: 'zoom.vtt' });
  route(state, {
    '/presentation-uploads/staging-1/finalize': { respond: () => response({ materials: [uploaded], requestDocumentId: ARTIFACT_ID }) },
    '/presentation-uploads': { method: 'POST', respond: () => response({ upload: { stagingId: 'staging-1', pathname: 'private/x', clientToken: 'tok', contentType: 'text/vtt', access: 'private' } }) },
  });
  put.mockResolvedValue({});
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const generate = await screen.findByRole('button', { name: 'Generate from audio' });
  await waitFor(() => expect(generate).toBeDisabled());
  expect(screen.getByText('Not enabled for this request')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Upload a transcript' }));
  const file = new File(['WEBVTT\n\n'], 'zoom.vtt', { type: 'text/vtt' });
  fireEvent.change(screen.getByLabelText(/Transcript file/), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload transcript' }));
  expect(await screen.findByText(/Transcript saved/)).toBeInTheDocument();
  expect(put).toHaveBeenCalled();
});

test('an unnamed speaker suggestion renders in that speaker row and fills the field', async () => {
  const overrides = {
    speaker_alignment: { status: 'partial', speakers: { A: { name: 'Alex Lee', confidence: 0.97 } }, suggestions: { B: ['Jean Smith'] } },
    speaker_names: { A: 'Alex Lee' },
  };
  route({ collection: collection({ jobs: [job(overrides)] }), detail: detailFor(overrides) });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const rowB = await screen.findByTestId('speaker-row-B');
  expect(within(rowB).getByText('Unnamed')).toBeInTheDocument();
  expect(within(screen.getByTestId('speaker-row-A')).getByText(/Matched from Zoom captions · 97%/)).toBeInTheDocument();
  expect(within(screen.getByTestId('speaker-row-A')).queryByText('Use Jean Smith')).not.toBeInTheDocument();
  fireEvent.click(within(rowB).getByRole('button', { name: 'Use Jean Smith' }));
  expect(screen.getByLabelText('Name for Speaker B')).toHaveValue('Jean Smith');
  expect(screen.getByText('Unsaved name changes')).toBeInTheDocument();
});

test('an active run shows only the progress line, and the card never shows ids or banned words', async () => {
  const running = job({ status: 'processing', created_at: '2026-10-04T20:09:00.000Z' });
  route({ collection: collection({ jobs: [running] }), detail: detailFor({}) });
  const { container } = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const progress = await screen.findByTestId('transcript-progress');
  expect(progress.textContent).toContain('Transcribing Oregon State recording');
  expect(screen.queryByTestId('transcript-review')).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/AssemblyAI|provider region|reconcil|quarantine|bundle|[0-9a-f]{8}-[0-9a-f]{4}-/i);
});

test('a confirmed boundary with a stale presentation transcript shows no ids or banned words', async () => {
  const state = { materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: boundaryArtifact({ presentationTranscript: { state: 'stale', artifactId: null } }) }), detail: detailFor({}) };
  route(state);
  const { container } = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  expect(await screen.findByText(/Presentation ends at 01:02/)).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/AssemblyAI|provider region|reconcil|quarantine|bundle|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  expect(container.textContent).not.toContain('42');
});

test('changing the request resets both data sets', async () => {
  route({ materials: [transcriptRow()], collection: collection({ jobs: [] }), detail: detailFor({}) });
  const { rerender } = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  expect(await screen.findByTestId('current-transcript-line')).toHaveTextContent(/^Saved/);
  route({ materials: [], collection: collection({ jobs: [] }), detail: detailFor({}) });
  rerender(<RecordingAndTranscriptCard requestId={OTHER_REQUEST_ID} />);
  await waitFor(() => expect(screen.getByTestId('current-transcript-line')).toHaveTextContent('No transcript yet.'));
  expect(global.fetch.mock.calls.some(([url]) => String(url).includes(`/visits/${OTHER_REQUEST_ID}/transcriptions`))).toBe(true);
});

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-/;
const JOB_Y = '77777777-7777-4777-8777-777777777777';
const OP_ID = '88888888-8888-4888-8888-888888888888';

test('stored GUID filenames are never rendered for uploaded transcripts or recordings', async () => {
  const guidName = '1003222-Transcript-4e7be123-7264-4fc0-bf07-66888f80bae6.txt';
  const state = {
    materials: [
      transcriptRow({ filename: guidName }),
      { artifactId: 'rec-1', artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, backing: 'file', filename: '1003222-Recording-4e7be123-7264-4fc0-bf07-66888f80bae6.mp4', createdAt: '2026-10-04T21:00:00.000Z', webUrl: 'https://example.sharepoint.com/r.mp4' },
    ],
    collection: collection({ jobs: [], currentArtifact: { id: ARTIFACT_ID, fingerprint: 'c'.repeat(64), bundleEditable: false } }),
    detail: detailFor({}),
  };
  route(state);
  const { container } = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const line = await screen.findByTestId('current-transcript-line');
  expect(line.textContent).toBe(`Uploaded ${shortDate('2026-10-04T22:24:00.000Z')} · TXT file`);
  expect(screen.getByTestId('current-recording-line').textContent).toBe(`MP4 recording · added ${shortDate('2026-10-04T21:00:00.000Z')}`);
  expect(container.textContent).not.toMatch(GUID_RE);
});

test('a generated transcript with no collection is not labelled uploaded', async () => {
  route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: null }), detail: detailFor({}) });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const line = await screen.findByTestId('current-transcript-line');
  expect(line.textContent).toBe(`Saved ${shortDate('2026-10-04T22:24:00.000Z')}`);
  expect(screen.queryByText(/cannot be edited here/)).not.toBeInTheDocument();
});

test('the summary section remains visible with no transcript and explains the first prerequisite', async () => {
  route({ materials: [], collection: collection({ jobs: [], currentArtifact: null }), detail: detailFor({}) });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  expect(await screen.findByTestId('presentation-summary-block')).toBeInTheDocument();
  expect(screen.getByText('Add a transcript first. Upload a transcript file or generate one from audio.')).toBeInTheDocument();
});

test('a manual transcript keeps the summary task visible but explains that timed generated turns are required', async () => {
  route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: { id: ARTIFACT_ID, bundleEditable: false } }), detail: detailFor({}) });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  expect(await screen.findByTestId('presentation-summary-block')).toBeInTheDocument();
  expect(screen.getByText(/A generated transcript with timed speaker turns is required/)).toBeInTheDocument();
  expect(screen.getByText(/Uploaded transcript files cannot be split/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Summarize presentation' })).not.toBeInTheDocument();
});

test('finalize 422 transcript_text_invalid shows the server message and no Retry button', async () => {
  const message = "This file is not a readable text transcript. Zoom's chat.txt and renamed media files are not transcripts.";
  route({ collection: collection({ jobs: [], featureState: 'disabled' }), detail: detailFor({}) }, {
    '/presentation-uploads/staging-1/finalize': { respond: () => response({ code: 'transcript_text_invalid', message }, 422) },
    '/presentation-uploads': { method: 'POST', respond: () => response({ upload: { stagingId: 'staging-1', pathname: 'private/x', clientToken: 'tok', contentType: 'text/plain', access: 'private' } }) },
  });
  put.mockResolvedValue({});
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Upload a transcript' }));
  fireEvent.change(screen.getByLabelText(/Transcript file/), { target: { files: [new File(['x'], 'chat.txt', { type: 'text/plain' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload transcript' }));
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /retry|finish transcript/i })).not.toBeInTheDocument();
});

test('a refresh that returns a newer run does not replace the editor or discard unsaved names', async () => {
  const JOB_NEW = '99999999-9999-4999-8999-999999999999';
  const state = {
    collection: collection({ publications: [{ operationId: OP_ID, state: 'unknown', version: 1, createdAt: '2026-10-04T20:30:00.000Z', inputJobId: 'older-job', resultingDocumentId: 'doc-x' }] }),
    detail: detailFor({}),
  };
  route(state, { [`/publications/${OP_ID}/reconcile`]: { respond: () => { state.collection = collection({ jobs: [job({ id: JOB_NEW, created_at: '2026-10-04T23:00:00.000Z', original_filename: 'Newer run.m4a' }), job()], publications: [] }); return response({ publication: { state: 'published' } }); } } });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const field = await screen.findByLabelText('Name for Speaker A');
  fireEvent.change(field, { target: { value: 'Edited name' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
  await waitFor(() => expect(screen.getByTestId('earlier-runs')).toHaveTextContent('Newer run'));
  expect(screen.getByLabelText('Name for Speaker A')).toHaveValue('Edited name');
  expect(screen.getByTestId('transcript-review')).toHaveTextContent('Oregon State recording');
});

test('a save that resolves after switching runs does not write into the other run', async () => {
  let resolveSave;
  let patchDone = false;
  const saved = new Promise((resolve) => { resolveSave = resolve; });
  const jobY = job({ id: JOB_Y, created_at: '2026-10-04T19:00:00.000Z', original_filename: 'Earlier run.m4a', speaker_names: { A: 'Yara' } });
  const state = { collection: collection({ jobs: [job(), jobY] }), detail: detailFor({}) };
  route(state, {
    [`/transcriptions/${JOB_Y}`]: { method: 'GET', respond: () => response({ job: jobY, content, candidates: [] }) },
    [`/transcriptions/${JOB_ID}/speakers`]: { method: 'PATCH', respond: async () => { await saved; patchDone = true; return response({ job: job({ version: 2, speaker_names: { B: 'Late X name' } }) }); } },
  });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.change(await screen.findByLabelText('Name for Speaker B'), { target: { value: 'Late X name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
  fireEvent.click(within(screen.getByTestId('earlier-runs')).getByRole('button', { name: 'Review' }));
  await waitFor(() => expect(screen.getByLabelText('Name for Speaker A')).toHaveValue('Yara'));
  resolveSave();
  await waitFor(() => expect(patchDone).toBe(true));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(screen.getByLabelText('Name for Speaker A')).toHaveValue('Yara');
  expect(screen.getByLabelText('Name for Speaker B')).toHaveValue('');
});

test('publishing an edited-names draft closes the editor for any result and lists the unresolved row', async () => {
  const published = { operationId: 'op-orig', state: 'published', version: 1, createdAt: '2026-10-04T21:00:00.000Z', inputJobId: JOB_ID, resultingDocumentId: ARTIFACT_ID };
  const artifact = { id: ARTIFACT_ID, fingerprint: 'd'.repeat(64), bundleEditable: true };
  const state = { materials: [transcriptRow()], collection: collection({ currentArtifact: artifact, publications: [published] }), detail: detailFor({}) };
  const correction = { operationId: OP_ID, state: 'draft', version: 1, speakerNames: {}, expectedCurrentArtifactId: ARTIFACT_ID, expectedCurrentFingerprint: artifact.fingerprint };
  route(state, {
    '/corrections': { method: 'POST', respond: (path) => (path.endsWith('/publish')
      ? (() => { state.collection = collection({ currentArtifact: artifact, publications: [published, { operationId: 'op-edit', state: 'published_reconcile', version: 2, createdAt: '2026-10-04T23:00:00.000Z', sourceArtifactId: ARTIFACT_ID, resultingDocumentId: 'doc-2' }] }); return response({ publication: { state: 'published_reconcile' }, currentArtifact: artifact }); })()
      : response({ correction, content, currentArtifact: artifact, candidates: [] })) },
  });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit speaker names' }));
  const publish = await screen.findByRole('button', { name: 'Publish transcript' });
  await waitFor(() => expect(publish).toBeEnabled());
  fireEvent.click(publish);
  expect(await screen.findByTestId('needs-attention')).toBeInTheDocument();
  expect(screen.queryByTestId('transcript-review')).not.toBeInTheDocument();
});

test('a 409 closing an attempt keeps the Refresh affordance after the reload', async () => {
  const state = { collection: collection({ jobs: [], publications: [{ operationId: OP_ID, state: 'unknown', version: 1, createdAt: '2020-01-01T00:00:00.000Z', quarantineUntil: '2020-01-02T00:00:00.000Z', inputJobId: 'x', resultingDocumentId: 'y' }] }), detail: detailFor({}) };
  route(state, { [`/publications/${OP_ID}/close`]: { respond: () => response({ code: 'conflict', message: 'stale' }, 409) } });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Close this attempt' }));
  expect(await screen.findByText(/Another session changed this/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
});

test('the review block offers a transcript preview that shows live speaker names', async () => {
  route({ collection: collection(), detail: detailFor({}) });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.change(await screen.findByLabelText('Name for Speaker A'), { target: { value: 'Alex Lee' } });
  const preview = screen.getByTestId('transcript-preview');
  expect(preview).not.toHaveAttribute('open');
  expect(within(preview).getByText('Read the transcript')).toBeInTheDocument();
  expect(within(preview).getByText('Hello from the site visit.')).toBeInTheDocument();
  expect(within(preview).getByText(/Alex Lee:/)).toBeInTheDocument();
});

test('a saved names draft is resumed with a GET instead of creating a second draft', async () => {
  const artifact = { id: ARTIFACT_ID, fingerprint: 'd'.repeat(64), bundleEditable: true };
  const draft = { operationId: OP_ID, state: 'draft', sourceArtifactId: ARTIFACT_ID, speakerNames: { A: 'Yara' }, createdAt: '2026-10-04T21:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' };
  const state = { materials: [transcriptRow()], collection: collection({ currentArtifact: artifact, correctionDrafts: [draft] }), detail: detailFor({}) };
  const correction = { operationId: OP_ID, state: 'draft', version: 1, speakerNames: { A: 'Yara' }, expectedCurrentArtifactId: ARTIFACT_ID, expectedCurrentFingerprint: artifact.fingerprint };
  route(state, { [`/corrections/${OP_ID}`]: { method: 'GET', respond: () => response({ correction, content, currentArtifact: artifact, candidates: [] }) } });
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const button = await screen.findByRole('button', { name: 'Continue editing names' });
  expect(screen.getByTestId('current-transcript-line').parentElement).toHaveTextContent('Unpublished name edits saved');
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByLabelText('Name for Speaker A')).toHaveValue('Yara'));
  const calls = global.fetch.mock.calls.map(([url, options]) => `${(options && options.method) || 'GET'} ${url}`);
  expect(calls.some((call) => call.startsWith('GET') && call.endsWith(`/corrections/${OP_ID}`))).toBe(true);
  expect(calls.some((call) => call.startsWith('POST') && call.includes('/corrections'))).toBe(false);
});

test('an older active run still shows progress with Refresh while the newest run is ready', async () => {
  const older = job({ id: '99999999-9999-4999-8999-999999999999', status: 'processing', created_at: '2026-10-04T19:00:00.000Z' });
  const state = { collection: collection({ jobs: [job(), older] }), detail: detailFor({}) };
  route(state);
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  const progress = await screen.findByTestId('transcript-progress');
  expect(progress.textContent).toContain('Transcribing');
  const refresh = within(progress).getByRole('button', { name: 'Refresh' });
  await waitFor(() => expect(refresh).toBeEnabled());
  const before = global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/transcriptions')).length;
  fireEvent.click(refresh);
  await waitFor(() => expect(global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/transcriptions')).length).toBe(before + 1));
});

describe('presentation end', () => {
  test('an unconfirmed boundary says so and Set presentation end opens the editor', async () => {
    const artifact = boundaryArtifact({ presentationEnd: null, presentationTranscript: { state: 'not_confirmed', artifactId: null } });
    const state = { materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: artifact }), detail: detailFor({}) };
    route(state, { '/corrections': { method: 'POST', respond: () => response(correctionDetail(artifact)) } });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText(/Presentation end not confirmed\. The Board link shows no transcript until a program coordinator confirms/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set presentation end' }));
    expect(await screen.findByRole('heading', { name: 'Edit speaker names and presentation end' })).toBeInTheDocument();
    expect(screen.getByLabelText('Presentation ends after')).toHaveValue('');
  });

  test('a saved draft keeps one opener, Continue editing names', async () => {
    const artifact = boundaryArtifact({ presentationEnd: null, presentationTranscript: { state: 'not_confirmed', artifactId: null } });
    const draft = { operationId: CORRECTION_ID, state: 'draft', sourceArtifactId: ARTIFACT_ID, speakerNames: {}, createdAt: '2026-10-04T21:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' };
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: artifact, correctionDrafts: [draft] }), detail: detailFor({}) });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByRole('button', { name: 'Continue editing names' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set presentation end' })).not.toBeInTheDocument();
  });

  test('Use proposed then Save sends the three-key PATCH with the proposed time', async () => {
    const artifact = boundaryArtifact({ presentationEnd: null, presentationTranscript: { state: 'not_confirmed', artifactId: null } });
    let patchBody = null;
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: artifact }), detail: detailFor({}) }, {
      '/corrections': { method: 'POST', respond: () => response(correctionDetail(artifact)) },
      [`/corrections/${CORRECTION_ID}`]: { method: 'PATCH', respond: (path, options) => { patchBody = JSON.parse(options.body); return response({ correction: draftCorrection({ version: 2, presentationEndMs: 62900 }) }); } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set presentation end' }));
    expect(await screen.findByText(/Proposed: 01:02 — last turn by Speaker A/)).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use proposed' }));
    expect(screen.getByLabelText('Presentation ends after')).toHaveValue('62900');
    expect(screen.getByText('Presentation ends after:')).toBeInTheDocument();
    expect(screen.getByText('Staff discussion begins:')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('Save changes first')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(patchBody).toEqual({ expectedVersion: 1, speakerNames: {}, presentationEndMs: 62900 });
    expect(screen.queryByRole('button', { name: 'Use proposed' })).not.toBeInTheDocument();
  });

  test('a skipped short line is shown with its speaker, time, and text, and Use this line instead selects it', async () => {
    const artifact = boundaryArtifact({ presentationEnd: null, presentationTranscript: { state: 'not_confirmed', artifactId: null } });
    const skipped = [{ endMs: 127300, startMs: 125000, speakerId: 'B', utteranceIndex: 1, text: 'We have a question.', gapMs: 62100 * 10 }];
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: artifact }), detail: detailFor({}) }, {
      '/corrections': { method: 'POST', respond: () => response(correctionDetail(artifact, {
        correction: draftCorrection({ speakerNames: { B: 'Sujoy Mukhopadhyay' } }),
        presentationEnd: { current: null, draft: null, proposed: { endMs: 62900, speakerId: 'A', utteranceIndex: 0, skipped } } })) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set presentation end' }));
    const notice = await screen.findByTestId('presentation-end-skipped');
    expect(notice).toHaveTextContent('Skipped a short line attributed to Sujoy Mukhopadhyay at 02:05: “We have a question.” It came 10 minutes after the last longer applicant line, so it may belong to someone else.');
    fireEvent.click(screen.getByRole('button', { name: 'Use this line instead' }));
    expect(screen.getByLabelText('Presentation ends after')).toHaveValue('127300');
    expect(screen.queryByRole('button', { name: 'Use this line instead' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use proposed' })).toBeInTheDocument();
  });

  test('choosing Not confirmed sends a null boundary', async () => {
    const artifact = boundaryArtifact();
    let patchBody = null;
    const confirmed = { endMs: 62900, confirmedBy: 42, confirmedAt: CONFIRMED_AT };
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: artifact }), detail: detailFor({}) }, {
      '/corrections': { method: 'POST', respond: () => response(correctionDetail(artifact, { correction: draftCorrection({ presentationEndMs: 62900 }), presentationEnd: { current: confirmed, draft: { endMs: 62900 }, proposed: null } })) },
      [`/corrections/${CORRECTION_ID}`]: { method: 'PATCH', respond: (path, options) => { patchBody = JSON.parse(options.body); return response({ correction: draftCorrection({ version: 2, presentationEndMs: null }) }); } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit speaker names' }));
    const select = await screen.findByLabelText('Presentation ends after');
    expect(select).toHaveValue('62900');
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patchBody).toEqual({ expectedVersion: 1, speakerNames: {}, presentationEndMs: null }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  test('confirmed and stale shows the warning, and Generate posts the two expectations then reloads', async () => {
    const artifact = boundaryArtifact({ presentationTranscript: { state: 'stale', artifactId: null } });
    const state = { materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: artifact }), detail: detailFor({}) };
    let postBody = null;
    route(state, { '/presentation-transcript': { method: 'POST', respond: (path, options) => {
      postBody = JSON.parse(options.body);
      state.collection = collection({ jobs: [], currentArtifact: boundaryArtifact() });
      return response({ presentationTranscript: { artifactId: ARTIFACT_ID, state: 'bound' }, currentArtifact: boundaryArtifact() });
    } } });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText(`Presentation ends at 01:02 · confirmed ${shortDate(CONFIRMED_AT)}`)).toBeInTheDocument();
    expect(screen.getByText('The Board link shows no transcript until the presentation transcript is generated.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate presentation and discussion transcripts' }));
    await waitFor(() => expect(screen.getByText('Presentation transcript ready for the Board link.')).toBeInTheDocument());
    expect(postBody).toEqual({ expectedCurrentArtifactId: ARTIFACT_ID, expectedCurrentFingerprint: 'e'.repeat(64) });
    expect(screen.queryByRole('button', { name: 'Generate presentation and discussion transcripts' })).not.toBeInTheDocument();
  });

  test('confirmed and bound shows the ready line and no Generate button', async () => {
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: boundaryArtifact() }), detail: detailFor({}) });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText('Presentation transcript ready for the Board link.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate presentation and discussion transcripts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set presentation end' })).not.toBeInTheDocument();
  });

  test('the explicit Edit presentation end action opens the existing correction draft', async () => {
    const artifact = boundaryArtifact();
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: artifact }), detail: detailFor({}) }, {
      '/corrections': { method: 'POST', respond: () => response(correctionDetail(artifact, { correction: draftCorrection({ presentationEndMs: 62900 }) })) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit presentation end' }));
    expect(await screen.findByRole('heading', { name: 'Edit speaker names and presentation end' })).toBeInTheDocument();
    expect(screen.getByLabelText('Presentation ends after')).toHaveValue('62900');
  });

  test('a names-only correction warns before publish and explains the manual regeneration steps after success', async () => {
    const artifact = boundaryArtifact();
    const summaryArtifactId = '99999999-9999-4999-8999-999999999999';
    const staleArtifact = boundaryArtifact({
      presentationTranscript: { state: 'stale', artifactId: null },
      staffDiscussionTranscript: { state: 'stale', artifactId: null },
      transcriptSummary: { state: 'stale', artifactId: summaryArtifactId, publishedAt: CONFIRMED_AT },
    });
    const state = { materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: artifact }), detail: detailFor({}) };
    route(state, {
      [`/corrections/${CORRECTION_ID}/publish`]: { method: 'POST', respond: () => {
        state.collection = collection({ jobs: [], currentArtifact: staleArtifact });
        return response({ publication: { state: 'published' }, currentArtifact: staleArtifact });
      } },
      '/corrections': { method: 'POST', respond: () => response(correctionDetail(artifact, { correction: draftCorrection({ speakerNames: { A: '' } }) })) },
      [`/corrections/${CORRECTION_ID}`]: { method: 'PATCH', respond: (path, options) => response({ correction: draftCorrection({ version: 2, speakerNames: JSON.parse(options.body).speakerNames }) }) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit speaker names' }));
    expect(await screen.findByText(/including a names-only change, withholds the Board presentation transcript and summary/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name for Speaker A'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved');
    expect(screen.getByText(/including a names-only change/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish transcript' }));
    expect(await screen.findByText(/Generate the presentation and staff discussion transcripts, then summarize again/)).toBeInTheDocument();
  });

  test('both halves bound shows both ready lines; a missing discussion alone shows an info notice and Generate', async () => {
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: boundaryArtifact() }), detail: detailFor({}) });
    const view = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText('Staff discussion transcript saved for staff.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate presentation and discussion transcripts' })).not.toBeInTheDocument();
    view.unmount();
    route({ materials: [transcriptRow()], collection: collection({ jobs: [],
      currentArtifact: boundaryArtifact({ staffDiscussionTranscript: { state: 'missing', artifactId: null } }) }), detail: detailFor({}) });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText('The staff discussion transcript for this presentation end has not been generated.')).toBeInTheDocument();
    expect(screen.getByText('Presentation transcript ready for the Board link.')).toBeInTheDocument();
    expect(screen.queryByText('The Board link shows no transcript until the presentation transcript is generated.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate presentation and discussion transcripts' })).toBeInTheDocument();
  });

  test('a 409 on Generate shows the conflict notice and reloads', async () => {
    const artifact = boundaryArtifact({ presentationTranscript: { state: 'missing', artifactId: null } });
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: artifact }), detail: detailFor({}) }, {
      '/presentation-transcript': { method: 'POST', respond: () => response({ code: 'meeting_transcript_current_changed', message: 'The current transcript changed.' }, 409) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate presentation and discussion transcripts' }));
    expect(await screen.findByText(/Another session changed this/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  test('a 409 on Generate for an unconfirmed boundary shows the specific reason, not the draft-conflict copy', async () => {
    const artifact = boundaryArtifact({ presentationTranscript: { state: 'missing', artifactId: null } });
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: artifact }), detail: detailFor({}) }, {
      '/presentation-transcript': { method: 'POST', respond: () => response({ code: 'presentation_end_not_confirmed', message: 'server words' }, 409) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate presentation and discussion transcripts' }));
    expect(await screen.findByText(/Confirm where the presentation ends before generating/)).toBeInTheDocument();
    expect(screen.queryByText(/Another session changed this/)).not.toBeInTheDocument();
  });

  test('job review mode shows nothing about the boundary', async () => {
    route({ collection: collection(), detail: detailFor({}) });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    await screen.findByLabelText('Name for Speaker A');
    expect(screen.queryByTestId('presentation-end-editor')).not.toBeInTheDocument();
    expect(screen.queryByText(/Presentation end/)).not.toBeInTheDocument();
  });
});

describe('presentation summary', () => {
  const DRAFT_ID = '99999999-9999-4999-8999-999999999999';
  const ACK = 'presentation-summary-2026-10-05';
  const readyDraft = (overrides = {}) => ({ id: DRAFT_ID, state: 'ready', version: 2, text: 'What was presented\nQuantum dots.',
    edited: false, presentationEndMs: 62900, createdAt: CONFIRMED_AT, updatedAt: CONFIRMED_AT, expiresAt: '2026-10-19T23:30:00.000Z', ...overrides });
  const summaryState = (overrides = {}) => ({ draft: null, draftMatchesTranscript: false, lastFailure: null,
    transcriptSummary: { state: 'missing', artifactId: null, publishedAt: null }, ...overrides });
  const withSummary = (artifactOverrides = {}) => collection({ jobs: [], currentArtifact: boundaryArtifact({
    transcriptSummary: { state: 'missing', artifactId: null, publishedAt: null }, ...artifactOverrides }) });

  test('compact correction-publish state stays unknown when collection refresh fails', async () => {
    const summaryId = '99999999-9999-4999-8999-999999999999';
    const compactArtifact = { id: ARTIFACT_ID, fingerprint: 'e'.repeat(64), bundleEditable: true };
    const state = { materials: [transcriptRow(), transcriptRow({ artifactId: summaryId,
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, artifactTypeLabel: 'Presentation summary', filename: 'summary.md' })],
      collection: collection({ jobs: [], currentArtifact: compactArtifact }), detail: detailFor({}) };
    let collectionReads = 0;
    route(state, {
      '/transcriptions/materials': { method: 'GET', respond: () => response({ materials: state.materials, uploads: [] }) },
      '/transcriptions': { method: 'GET', respond: () => {
        collectionReads += 1;
        if (collectionReads === 1) return response(state.collection);
        return response({ error: 'temporarily unavailable' }, 503);
      } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    const summaryBlock = await screen.findByTestId('presentation-summary-block');
    await waitFor(() => expect(collectionReads).toBe(1));
    await screen.findByRole('button', { name: 'Refresh transcription status' });
    expect(summaryBlock.textContent).toContain('Summary status unavailable.');
    expect(screen.queryByText('No summary published yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh transcription status' }));
    await waitFor(() => expect(collectionReads).toBe(2));
    expect(summaryBlock.textContent).toContain('Summary status unavailable.');
    expect(screen.queryByText('No summary published yet.')).toBeNull();
  });

  test('Summarize stays disabled until the acknowledgment is ticked, then posts the version and both expectations', async () => {
    let postBody = null;
    route({ materials: [transcriptRow()], collection: withSummary(), detail: detailFor({}) }, {
      '/summary-draft': { method: 'GET', respond: () => response(summaryState()) },
    });
    global.fetch.mockImplementation(((original) => async (url, options = {}) => {
      if (String(url).endsWith('/summary-draft') && options.method === 'POST') {
        postBody = JSON.parse(options.body);
        return response({ draft: readyDraft(), slidesIncluded: false, transcriptSummary: { state: 'missing', artifactId: null, publishedAt: null } });
      }
      return original(url, options);
    })(global.fetch.getMockImplementation()));
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    const button = await screen.findByRole('button', { name: 'Summarize presentation' });
    expect(button).toBeDisabled();
    expect(screen.getByText('No summary published yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/may be sent to Anthropic/));
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(await screen.findByLabelText(/^Draft/)).toHaveValue('What was presented\nQuantum dots.');
    expect(postBody).toEqual({ acknowledgmentVersion: ACK, expectedCurrentArtifactId: ARTIFACT_ID, expectedCurrentFingerprint: 'e'.repeat(64) });
    expect(screen.getByText(/Slide text was not included/)).toBeInTheDocument();
    // The acknowledgment is per request: it is cleared after a run.
    expect(screen.getByLabelText(/may be sent to Anthropic/)).not.toBeChecked();
  });

  test('a published summary made from replaced slides says so; the same summary without the flag does not (staff replacement plan §3.5)', async () => {
    const published = { state: 'bound', artifactId: DRAFT_ID, publishedAt: CONFIRMED_AT };
    route({ materials: [transcriptRow()], collection: withSummary({ transcriptSummary: published }), detail: detailFor({}) }, {
      '/summary-draft': { method: 'GET', respond: () => response(summaryState({ transcriptSummary: published, slidesChangedSinceSummary: true })) },
    });
    const view = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByTestId('summary-slides-changed')).toHaveTextContent('The applicant slides were updated after this summary was made.');
    view.unmount();
    route({ materials: [transcriptRow()], collection: withSummary({ transcriptSummary: published }), detail: detailFor({}) }, {
      '/summary-draft': { method: 'GET', respond: () => response(summaryState({ transcriptSummary: published, slidesChangedSinceSummary: null })) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText(/Available to staff and eligible for the Board link/)).toBeInTheDocument();
    expect(screen.queryByTestId('summary-slides-changed')).toBeNull();
  });

  test('a published summary opens from its existing material descriptor', async () => {
    const published = { state: 'bound', artifactId: DRAFT_ID, publishedAt: CONFIRMED_AT };
    const summaryMaterial = { artifactId: DRAFT_ID, artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY,
      webUrl: 'https://example.sharepoint.com/published-summary.docx', filename: 'summary.docx' };
    route({ materials: [transcriptRow(), summaryMaterial], collection: withSummary({ transcriptSummary: published }), detail: detailFor({}) }, {
      '/summary-draft': { method: 'GET', respond: () => response(summaryState({ transcriptSummary: published })) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByRole('link', { name: 'Open published summary' })).toHaveAttribute('href', summaryMaterial.webUrl);
    expect(screen.getByText(/Available to staff and eligible for the Board link/)).toBeInTheDocument();
  });

  test('a draft from an earlier transcript version cannot be published', async () => {
    route({ materials: [transcriptRow()], collection: withSummary(), detail: detailFor({}) }, {
      '/summary-draft': { method: 'GET', respond: () => response(summaryState({ draft: readyDraft(), draftMatchesTranscript: false })) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText(/This draft was made from an earlier transcript version/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish summary' })).toBeDisabled();
  });

  test('a refresh invalidates a same-version draft when its presentation transcript became stale', async () => {
    const state = { materials: [transcriptRow()], collection: collection({
      jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }),
    }), detail: detailFor({}) };
    let summaryReads = 0;
    route(state, {
      '/summary-draft': { method: 'GET', respond: () => {
        summaryReads += 1;
        return response(summaryState({ draft: readyDraft(), draftMatchesTranscript: summaryReads === 1,
          transcriptSummary: { state: summaryReads === 1 ? 'bound' : 'stale', artifactId: DRAFT_ID } }));
      } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    const editor = await screen.findByLabelText(/^Draft/);
    fireEvent.change(editor, { target: { value: 'Unsaved edit' } });
    state.collection = collection({ jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'stale', artifactId: DRAFT_ID } }) });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/This draft was made from an earlier transcript version/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Draft/)).toHaveValue('Unsaved edit');
    expect(screen.getByRole('button', { name: 'Publish summary' })).toBeDisabled();
  });

  test('successive same-version refreshes retain unsaved text after adopting publishing state', async () => {
    const state = { materials: [transcriptRow()], collection: collection({
      jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }),
    }), detail: detailFor({}) };
    let summaryReads = 0;
    route(state, {
      '/summary-draft': { method: 'GET', respond: () => {
        summaryReads += 1;
        return response(summaryState({ draft: readyDraft({ state: summaryReads === 1 ? 'ready' : 'publishing' }),
          draftMatchesTranscript: true, transcriptSummary: { state: 'bound', artifactId: DRAFT_ID },
          slidesChangedSinceSummary: summaryReads === 3 }));
      } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    const editor = await screen.findByLabelText(/^Draft/);
    fireEvent.change(editor, { target: { value: 'Unsaved edit' } });
    state.collection = collection({ jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'stale', artifactId: DRAFT_ID } }) });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/Publishing this draft did not finish/)).toBeInTheDocument();
    expect(screen.getByText(/The text shown includes unsaved edits, but this draft is already publishing/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Draft/)).toHaveValue('Unsaved edit');
    expect(screen.getByLabelText(/^Draft/)).toBeDisabled();

    state.collection = collection({ jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ fingerprint: 'f'.repeat(64), transcriptSummary: { state: 'stale', artifactId: DRAFT_ID } }) });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(summaryReads).toBe(3));
    expect(await screen.findByTestId('summary-slides-changed')).toBeInTheDocument();
    expect(screen.getByText(/The text shown includes unsaved edits, but this draft is already publishing/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Draft/)).toHaveValue('Unsaved edit');
  });

  test.each(['ready', 'publishing'])('a server-removed %s draft becomes a recoverable conflict, not a live draft', async (initialState) => {
    const state = { materials: [transcriptRow()], collection: collection({
      jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }),
    }), detail: detailFor({}) };
    let summaryReads = 0;
    route(state, {
      '/summary-draft': { method: 'GET', respond: () => {
        summaryReads += 1;
        if (summaryReads === 1) return response(summaryState({ draft: readyDraft(), draftMatchesTranscript: true,
          transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }));
        if (initialState === 'publishing' && summaryReads === 2) return response(summaryState({ draft: readyDraft({ state: 'publishing' }),
          draftMatchesTranscript: true, transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }));
        return response(summaryState({ draft: null, draftMatchesTranscript: false,
          transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }));
      } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    const editor = await screen.findByLabelText(/^Draft/);
    fireEvent.change(editor, { target: { value: `Unsaved ${initialState} edits` } });
    state.collection = collection({ jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'stale', artifactId: DRAFT_ID } }) });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    if (initialState === 'publishing') {
      expect(await screen.findByText(/Publishing this draft did not finish/)).toBeInTheDocument();
      state.collection = collection({ jobs: [job({ status: 'queued', contentAccessAllowed: false })],
        currentArtifact: boundaryArtifact({ fingerprint: 'f'.repeat(64), transcriptSummary: { state: 'stale', artifactId: DRAFT_ID } }) });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    }
    await waitFor(() => expect(summaryReads).toBe(initialState === 'ready' ? 2 : 3));
    expect(await screen.findByTestId('summary-draft-conflict')).toHaveTextContent('This draft is no longer current.');
    expect(screen.getByLabelText('Preserved unsaved edits')).toHaveValue(`Unsaved ${initialState} edits`);
    expect(screen.queryByText(/Publishing this draft did not finish/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish summary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull();
  });

  test('a failed summary read offers Check again and clears the old error on success', async () => {
    let reads = 0;
    route({ materials: [transcriptRow()], collection: withSummary(), detail: detailFor({}) }, {
      '/summary-draft': { method: 'GET', respond: () => {
        reads += 1;
        return reads === 1 ? response({ error: 'temporarily unavailable' }, 500)
          : response(summaryState({ draft: readyDraft(), draftMatchesTranscript: true }));
      } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByLabelText(/^Draft/)).toHaveValue(readyDraft().text);
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(screen.queryByText(/temporarily unavailable/)).toBeNull();
  });

  test('collection-known missing summary is reported without a summary GET', async () => {
    const notPublished = { state: 'missing', artifactId: null, publishedAt: null };
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: boundaryArtifact({
      presentationTranscript: { state: 'missing', artifactId: null }, transcriptSummary: notPublished,
    }) }), detail: detailFor({}) });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText('No summary published yet.')).toBeInTheDocument();
    expect(global.fetch.mock.calls.some(([url]) => String(url).endsWith('/summary-draft'))).toBe(false);
  });

  test('a summary read dropped after losing its artifact does not leave Checking status', async () => {
    const state = { materials: [transcriptRow()], collection: collection({
      jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }),
    }), detail: detailFor({}) };
    let resolveSummaryRead;
    route(state, {
      '/summary-draft': { method: 'GET', respond: () => new Promise((resolve) => { resolveSummaryRead = resolve; }) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    await waitFor(() => expect(typeof resolveSummaryRead).toBe('function'));
    state.collection = collection({ jobs: [job({ status: 'queued', contentAccessAllowed: false })], currentArtifact: null });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Summary status cannot be checked until transcript status is available.')).toBeInTheDocument();
    await act(async () => {
      resolveSummaryRead(response(summaryState({ draft: readyDraft(), draftMatchesTranscript: true })));
      await Promise.resolve();
    });
    expect(screen.getByText('Summary status cannot be checked until transcript status is available.')).toBeInTheDocument();
    expect(screen.queryByText(/Checking summary status/)).toBeNull();
  });

  test('losing the confirmed boundary preserves dirty text in recovery when no summary read is needed', async () => {
    const state = { materials: [transcriptRow()], collection: collection({
      jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }),
    }), detail: detailFor({}) };
    let summaryReads = 0;
    route(state, {
      '/summary-draft': { method: 'GET', respond: () => {
        summaryReads += 1;
        return response(summaryState({ draft: readyDraft(), draftMatchesTranscript: true,
          transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }));
      } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    const editor = await screen.findByLabelText(/^Draft/);
    fireEvent.change(editor, { target: { value: 'Recover this edit' } });
    state.collection = collection({ jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ presentationEnd: null,
        presentationTranscript: { state: 'not_confirmed', artifactId: null },
        transcriptSummary: { state: 'not_confirmed', artifactId: null } }) });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByTestId('summary-draft-conflict')).toHaveTextContent('This draft is no longer current.');
    expect(screen.getByLabelText('Preserved unsaved edits')).toHaveValue('Recover this edit');
    expect(screen.queryByLabelText(/^Draft/)).toBeNull();
    expect(screen.getByText('No summary published yet.')).toBeInTheDocument();
    expect(summaryReads).toBe(1);
  });

  test('transient collection failure gives truthful transcript status and a working retry', async () => {
    let collectionReads = 0;
    route({ materials: [transcriptRow()], collection: collection({ jobs: [], currentArtifact: null }), detail: detailFor({}) }, {
      '/transcriptions': { method: 'GET', respond: () => {
        collectionReads += 1;
        return collectionReads === 1 ? response({ error: 'temporarily unavailable' }, 503)
          : response(collection({ jobs: [], currentArtifact: null }));
      } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText('Transcript status is unavailable. Refresh transcription status to check whether this transcript can be summarized.')).toBeInTheDocument();
    expect(screen.getByText('Summary status unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/Uploaded transcript files cannot be split/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh transcription status' }));
    expect(await screen.findByText('Summary status cannot be checked until transcript status is available.')).toBeInTheDocument();
    expect(collectionReads).toBe(2);
  });

  test('discard success removes the draft immediately even if the follow-up read is unavailable', async () => {
    let summaryReads = 0;
    route({ materials: [transcriptRow()], collection: withSummary(), detail: detailFor({}) }, {
      '/summary-draft': { respond: (_path, options) => {
        if (options.method === 'DELETE') return response({});
        summaryReads += 1;
        return summaryReads === 1
          ? response(summaryState({ draft: readyDraft(), draftMatchesTranscript: true }))
          : response({ error: 'unavailable' }, 503);
      } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    await screen.findByLabelText(/^Draft/);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(await screen.findByText('Draft discarded.')).toBeInTheDocument();
    await screen.findByText(/Summary status unavailable/);
    expect(screen.queryByLabelText(/^Draft/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull();
  });

  test('an unconfirmed summary artifact stays visible when the boundary is cleared', async () => {
    const summaryMaterial = { artifactId: DRAFT_ID, artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY,
      webUrl: 'https://example.sharepoint.com/published-summary.docx', filename: 'summary.docx' };
    const notConfirmed = { state: 'not_confirmed', artifactId: DRAFT_ID, publishedAt: CONFIRMED_AT };
    route({ materials: [summaryMaterial], collection: withSummary({ presentationEnd: null,
      presentationTranscript: { state: 'not_confirmed', artifactId: null }, transcriptSummary: notConfirmed }), detail: detailFor({}) }, {
      '/summary-draft': { method: 'GET', respond: () => response(summaryState({ transcriptSummary: notConfirmed })) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText(/A summary artifact exists. Its eligibility for the Board link is not confirmed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open published summary' })).toHaveAttribute('href', summaryMaterial.webUrl);
    expect(screen.queryByText('No summary published yet.')).toBeNull();
  });

  test('an older background summary GET cannot restore a stale draft version after saving local edits', async () => {
    const state = { materials: [transcriptRow()], collection: collection({
      jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }),
    }) };
    let summaryReads = 0;
    let resolveBackgroundRead;
    let resolveBackgroundReadConsumed;
    const backgroundReadConsumed = new Promise((resolve) => { resolveBackgroundReadConsumed = resolve; });
    const publishBodies = [];
    route(state, {
      '/summary-draft': { method: 'GET', respond: () => {
        summaryReads += 1;
        if (summaryReads === 1) return response(summaryState({ draft: readyDraft(), draftMatchesTranscript: true, transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }));
        if (summaryReads === 2) return new Promise((resolve) => { resolveBackgroundRead = resolve; });
        return response(summaryState({ draft: readyDraft({ version: 3, text: 'Local edit', edited: true }), draftMatchesTranscript: true, transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }));
      } },
    });
    const original = global.fetch.getMockImplementation();
    global.fetch.mockImplementation(async (url, options = {}) => {
      const path = String(url);
      if (path.endsWith('/summary-draft') && options.method === 'PATCH') return response({ draft: readyDraft({ version: 3, text: 'Local edit', edited: true }) });
      if (path.endsWith('/summary-draft/publish')) { publishBodies.push(JSON.parse(options.body)); return response({}); }
      return original(url, options);
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    const editor = await screen.findByLabelText(/^Draft/);
    fireEvent.change(editor, { target: { value: 'Local edit' } });

    state.collection = collection({
      jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'stale', artifactId: DRAFT_ID } }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(summaryReads).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft saved.');
    await act(async () => {
      resolveBackgroundRead({ ok: true, status: 200, json: async () => {
        resolveBackgroundReadConsumed();
        return summaryState({ draft: readyDraft({ version: 8, text: 'Older GET text' }), draftMatchesTranscript: true,
          transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } });
      } });
      await backgroundReadConsumed;
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByLabelText(/^Draft/)).toHaveValue('Local edit'));

    fireEvent.click(screen.getByRole('button', { name: 'Publish summary' }));
    await waitFor(() => expect(publishBodies).toHaveLength(1));
    expect(publishBodies[0]).toEqual({ draftId: DRAFT_ID, expectedVersion: 3 });
  });

  test('a background GET for a replacement draft keeps an unsaved local text paired with its original version', async () => {
    const state = { materials: [transcriptRow()], collection: collection({
      jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }),
    }) };
    let summaryReads = 0;
    let resolveBackgroundRead;
    route(state, {
      '/summary-draft': { method: 'GET', respond: () => {
        summaryReads += 1;
        if (summaryReads === 1) return response(summaryState({ draft: readyDraft(), draftMatchesTranscript: true, transcriptSummary: { state: 'bound', artifactId: DRAFT_ID } }));
        if (summaryReads === 2) return new Promise((resolve) => { resolveBackgroundRead = resolve; });
        if (summaryReads === 3) return response({ error: 'unavailable' }, 503);
        return response(summaryState({ draft: readyDraft({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 9, text: 'Replacement server draft' }), draftMatchesTranscript: true }));
      } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    const editor = await screen.findByLabelText(/^Draft/);
    fireEvent.change(editor, { target: { value: 'Unsaved local text' } });
    state.collection = collection({
      jobs: [job({ status: 'queued', contentAccessAllowed: false })],
      currentArtifact: boundaryArtifact({ transcriptSummary: { state: 'stale', artifactId: DRAFT_ID } }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(summaryReads).toBe(2));
    resolveBackgroundRead(response(summaryState({
      draft: readyDraft({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 9, text: 'Replacement server draft' }),
      draftMatchesTranscript: true, transcriptSummary: { state: 'stale', artifactId: DRAFT_ID },
    })));
    expect(await screen.findByTestId('summary-draft-conflict')).toHaveTextContent('This draft is no longer current.');
    expect(screen.getByLabelText('Preserved unsaved edits')).toHaveValue('Unsaved local text');
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish summary' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Load latest' }));
    await screen.findByRole('button', { name: 'Check again' });
    expect(screen.getByLabelText('Preserved unsaved edits')).toHaveValue('Unsaved local text');
    fireEvent.click(screen.getByRole('button', { name: 'Load latest' }));
    expect(await screen.findByLabelText(/^Draft/)).toHaveValue('Replacement server draft');
    expect(screen.queryByTestId('summary-draft-conflict')).toBeNull();
  });

  test('publishing an edited draft saves it first, then publishes the saved version and reloads', async () => {
    const calls = [];
    route({ materials: [transcriptRow()], collection: withSummary(), detail: detailFor({}) });
    const base = global.fetch.getMockImplementation();
    let summaryReads = 0;
    global.fetch.mockImplementation(async (url, options = {}) => {
      const path = String(url); const method = options.method || 'GET';
      if (path.endsWith('/summary-draft/publish')) { calls.push(['publish', JSON.parse(options.body)]); return response({ transcriptSummary: { state: 'bound' }, draft: null }); }
      if (path.endsWith('/summary-draft') && method === 'PATCH') { calls.push(['save', JSON.parse(options.body)]); return response({ draft: readyDraft({ version: 3, text: 'Edited', edited: true }) }); }
      if (path.endsWith('/summary-draft') && method === 'GET') {
        summaryReads += 1;
        return response(summaryState({ draft: summaryReads === 1 ? readyDraft() : readyDraft({ version: 3, text: 'Edited', edited: true }), draftMatchesTranscript: true }));
      }
      return base(url, options);
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    const editor = await screen.findByLabelText(/^Draft/);
    fireEvent.change(editor, { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish summary' }));
    await waitFor(() => expect(calls.map(([kind]) => kind)).toEqual(['save', 'publish']));
    expect(calls[0][1]).toEqual({ draftId: DRAFT_ID, expectedVersion: 2, text: 'Edited' });
    expect(calls[1][1]).toEqual({ draftId: DRAFT_ID, expectedVersion: 3 });
    expect(await screen.findByText(/Summary published/)).toBeInTheDocument();
  });

  test('an ambiguous summary publish refreshes collection, summary, and material projections', async () => {
    const stale = { state: 'stale', artifactId: DRAFT_ID, publishedAt: CONFIRMED_AT };
    const bound = { state: 'bound', artifactId: DRAFT_ID, publishedAt: CONFIRMED_AT };
    const summaryMaterial = { artifactId: DRAFT_ID, artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY,
      webUrl: 'https://example.sharepoint.com/published-after-response-loss.docx', filename: 'summary.docx' };
    const state = { materials: [transcriptRow()], collection: withSummary({ transcriptSummary: stale }) };
    let summaryReads = 0;
    route(state, {
      '/summary-draft/publish': { method: 'POST', respond: () => {
        state.materials = [transcriptRow(), summaryMaterial];
        return response({ error: 'Response was lost after publish.' }, 500);
      } },
      '/summary-draft': { method: 'GET', respond: () => {
        summaryReads += 1;
        return summaryReads === 1
          ? response(summaryState({ draft: readyDraft(), draftMatchesTranscript: true, transcriptSummary: stale }))
          : response(summaryState({ draft: null, transcriptSummary: bound }));
      } },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish summary' }));
    expect(await screen.findByText(/Available to staff and eligible for the Board link/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Open published summary' })).toHaveAttribute('href', summaryMaterial.webUrl);
    expect(screen.getByTestId('presentation-summary-block')).not.toHaveTextContent('The published summary is from an earlier transcript version');
    expect(screen.getAllByRole('alert').some((node) => node.textContent.includes('Response was lost after publish.'))).toBe(true);
    expect(global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/transcriptions'))).toHaveLength(2);
    expect(global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/presentation-materials'))).toHaveLength(2);
  });

  test('an unfinished publish is read-only and offers Publish again or a fresh summary', async () => {
    route({ materials: [transcriptRow()], collection: withSummary(), detail: detailFor({}) }, {
      '/summary-draft': { method: 'GET', respond: () => response(summaryState({ draft: readyDraft({ state: 'publishing' }), draftMatchesTranscript: true })) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText(/Publishing this draft did not finish/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Draft/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publish summary' })).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace draft with a new summary' })).toBeDisabled();
  });

  test('an unfinished publish from an earlier transcript version can still be replaced by a new summary', async () => {
    route({ materials: [transcriptRow()], collection: withSummary(), detail: detailFor({}) }, {
      '/summary-draft': { method: 'GET', respond: () => response(summaryState({ draft: readyDraft({ state: 'publishing' }), draftMatchesTranscript: false })) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByRole('button', { name: 'Publish summary' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/may be sent to Anthropic/));
    expect(screen.getByRole('button', { name: 'Replace draft with a new summary' })).not.toBeDisabled();
  });

  test('a stale published summary remains available to staff and is withheld from the Board link', async () => {
    route({ materials: [transcriptRow()], collection: withSummary({ transcriptSummary: { state: 'stale', artifactId: DRAFT_ID, publishedAt: CONFIRMED_AT } }), detail: detailFor({}) }, {
      '/summary-draft': { method: 'GET', respond: () => response(summaryState({ transcriptSummary: { state: 'stale', artifactId: DRAFT_ID, publishedAt: CONFIRMED_AT } })) },
    });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    expect(await screen.findByText(/remains available to staff; it is withheld from the Board link/)).toBeInTheDocument();
    expect(screen.getByTestId('presentation-summary-block').textContent).not.toContain(DRAFT_ID);
  });
});
