/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const shortDate = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const detailFor = (jobOverrides) => () => ({ job: job(jobOverrides), content, candidates: [] });

afterEach(() => { jest.restoreAllMocks(); put.mockReset(); });

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
  expect(line.textContent).toBe(`Uploaded ${shortDate('2026-10-04T22:24:00.000Z')} · Transcript.vtt`);
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
  expect(container.textContent).not.toMatch(/AssemblyAI|provider region|reconcile|quarantine|bundle|[0-9a-f]{8}-[0-9a-f]{4}-/i);
});

test('changing the request resets both data sets', async () => {
  route({ materials: [transcriptRow()], collection: collection({ jobs: [] }), detail: detailFor({}) });
  const { rerender } = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  expect(await screen.findByTestId('current-transcript-line')).toHaveTextContent(/^Uploaded/);
  route({ materials: [], collection: collection({ jobs: [] }), detail: detailFor({}) });
  rerender(<RecordingAndTranscriptCard requestId={OTHER_REQUEST_ID} />);
  await waitFor(() => expect(screen.getByTestId('current-transcript-line')).toHaveTextContent('No transcript yet.'));
  expect(global.fetch.mock.calls.some(([url]) => String(url).includes(`/visits/${OTHER_REQUEST_ID}/transcriptions`))).toBe(true);
});
