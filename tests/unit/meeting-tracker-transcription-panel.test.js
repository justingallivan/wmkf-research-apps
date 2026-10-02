/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { put } from '@vercel/blob/client';
import MeetingTranscriptionPanel from '../../shared/components/meeting-tracker/MeetingTranscriptionPanel';

jest.mock('@vercel/blob/client', () => ({ put: jest.fn() }));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const ARTIFACT_ID = '33333333-3333-4333-8333-333333333333';
const OPERATION_ID = '44444444-4444-4444-8444-444444444444';
const VISIT_ID = '55555555-5555-4555-8555-555555555555';
const currentArtifact = { id: ARTIFACT_ID, fingerprint: 'a'.repeat(64), bundleEditable: true };

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function job(overrides = {}) {
  return {
    id: JOB_ID,
    status: 'ready',
    version: 1,
    created_at: '2026-10-01T17:00:00.000Z',
    updated_at: '2026-10-01T17:01:00.000Z',
    original_filename: 'site-visit.m4a',
    label: 'Ready',
    needsAttention: false,
    contentAccessAllowed: true,
    speaker_names: {},
    ...overrides,
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
    featureState: 'enabled',
    siteVisitActivityId: VISIT_ID,
    candidateSources: {
      pi: { status: 'ready' },
      coPIs: { status: 'unavailable', reason: 'The co-investigator directory could not be reached.' },
      savedAttendees: { status: 'ready' },
    },
    candidates: [
      { id: 'candidate-one', source: 'pi', displayName: 'Alex Lee' },
      { id: 'candidate-two', source: 'pi', displayName: 'Alex Lee' },
      { id: 'candidate-three', source: 'saved_attendee', displayName: 'Jordan Rivera' },
    ],
    jobs: [job()],
    currentArtifact,
    publications: [],
    correctionDrafts: [],
    ...overrides,
  };
}

function expectOnlyMeetingRequestPath() {
  for (const [url, options] of global.fetch.mock.calls) {
    if (String(url).includes('/transcriptions')) {
      expect(url).toContain(`/api/meeting-tracker/visits/${REQUEST_ID}/transcriptions`);
      if (options?.body) {
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
        expect(body).not.toHaveProperty('requestId');
        expect(body).not.toHaveProperty('siteVisitActivityId');
      }
    }
  }
}

beforeEach(() => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).endsWith('/transcriptions')) return response(collection());
    if (String(url).endsWith(`/${JOB_ID}`)) return response({ job: job(), content, candidates: collection().candidates });
    return response({});
  });
});

afterEach(() => {
  delete global.crypto.randomUUID;
  jest.restoreAllMocks();
});

test('uploads audio directly to private Blob storage before starting provider work', async () => {
  const randomUUID = jest.fn(() => '99999999-9999-4999-8999-999999999999');
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: randomUUID });
  const uploadedJob = job({ status: 'uploading', version: 1 });
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/transcriptions') && options.method === 'POST') {
      expect(JSON.parse(options.body)).toEqual({
        filename: 'recording.mp3', contentType: 'audio/mpeg', bytes: 5,
        idempotencyKey: '99999999-9999-4999-8999-999999999999', providerRegion: 'us',
      });
      return response({ job: uploadedJob, upload: { pathname: 'private/path', token: 'scoped-token', contentType: 'audio/mpeg', maximumSizeInBytes: 52428800, access: 'private' } });
    }
    if (path.endsWith(`/${JOB_ID}/start`)) {
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ expectedVersion: 1, nonSensitiveAcknowledged: true });
      return response({ job: job({ status: 'queued', version: 2 }) });
    }
    if (path.endsWith('/transcriptions')) return response(collection({ jobs: [uploadedJob] }));
    if (path.endsWith(`/${JOB_ID}`)) return response({ job: job({ status: 'queued', version: 2 }), content: null, candidates: [] });
    return response({});
  });
  put.mockResolvedValue({ url: 'https://blob.example/private/path' });

  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  const file = new File(['audio'], 'recording.mp3', { type: 'audio/mpeg' });
  fireEvent.change(await screen.findByLabelText('Audio file'), { target: { files: [file] } });
  fireEvent.click(screen.getByLabelText(/I confirm the recording is non-sensitive/));
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));

  await waitFor(() => expect(global.fetch.mock.calls.some(([url, options]) => String(url).endsWith(`/${JOB_ID}/start`) && options?.method === 'POST')).toBe(true));
  expect(put).toHaveBeenCalledWith('private/path', file, expect.objectContaining({ access: 'private', token: 'scoped-token', contentType: 'audio/mpeg' }));
  const startIndex = global.fetch.mock.calls.findIndex(([url, options]) => String(url).endsWith(`/${JOB_ID}/start`) && options?.method === 'POST');
  expect(startIndex).toBeGreaterThan(0);
  expect(randomUUID).toHaveBeenCalledTimes(1);
});

test('reviews a draft, saves names without candidate IDs, and publishes against the current artifact', async () => {
  let savedJob = job();
  let collectionLoads = 0;
  let publishedArtifact = currentArtifact;
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/transcriptions')) {
      collectionLoads += 1;
      return response(collection({ jobs: [savedJob], currentArtifact: publishedArtifact }));
    }
    if (path.endsWith(`/${JOB_ID}`) && options.method === 'GET') return response({ job: savedJob, content, candidates: collection().candidates });
    if (path.endsWith(`/${JOB_ID}/speakers`) && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      expect(body).toEqual({ expectedVersion: 1, speakerNames: { A: 'Alex Lee' } });
      expect(body.speakerNames).not.toHaveProperty('candidate-one');
      savedJob = job({ version: 2, speaker_names: body.speakerNames });
      return response({ job: savedJob });
    }
    if (path.endsWith(`/${JOB_ID}/publish`) && options.method === 'POST') {
      expect(JSON.parse(options.body)).toEqual({
        expectedVersion: 2,
        expectedCurrentArtifactId: ARTIFACT_ID,
        expectedCurrentFingerprint: currentArtifact.fingerprint,
      });
      publishedArtifact = { ...currentArtifact, id: OPERATION_ID };
      return response({ publication: { operationId: OPERATION_ID, state: 'published' }, currentArtifact: publishedArtifact });
    }
    return response({});
  });

  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  expect((await screen.findAllByText('Hello from the site visit.')).length).toBeGreaterThan(0);
  expect(screen.getByRole('heading', { name: 'Detected speakers (2)' })).toBeInTheDocument();
  expect(screen.getByText('Some name suggestions are unavailable.')).toBeInTheDocument();
  expect(screen.getByText('1:00')).toBeInTheDocument();
  expect(screen.getByText('2:00')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Suggestions for Speaker A'), { target: { value: 'candidate-one' } });
  expect(screen.getByLabelText('Manual display name for Speaker A')).toHaveValue('Alex Lee');
  expect(screen.getByRole('button', { name: 'Publish transcript' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true));
  expect(await screen.findByText('Speaker names saved.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Publish transcript' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Publish transcript' }));
  expect(await screen.findByText('Transcript published. The finalized downloads are now available below.')).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'Download TXT' })).toHaveAttribute('href', expect.stringContaining(`/materials/${OPERATION_ID}/download?format=txt`));
  expect(collectionLoads).toBeGreaterThanOrEqual(2);
  expectOnlyMeetingRequestPath();
});

test('reconciles crashed publishing receipts and requires acknowledgement before close-with-files-retained', async () => {
  const publication = { operationId: OPERATION_ID, state: 'publishing', version: 3,
    quarantineUntil: new Date(Date.now() - 1000).toISOString(), leaseExpiresAt: new Date(Date.now() - 1000).toISOString() };
  let closeCalls = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/transcriptions')) return response(collection({ publications: [
      { ...publication, state: closeCalls ? 'closed' : 'unknown' },
    ] }));
    if (path.endsWith(`/publications/${OPERATION_ID}/reconcile`)) return response({
      publication: { operationId: OPERATION_ID, state: 'unknown' }, requiresAttention: true,
    });
    if (path.endsWith(`/publications/${OPERATION_ID}/close`)) {
      closeCalls += 1;
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ acknowledgeRetainedFiles: true });
      return response({ closed: true, retainedFiles: true, publication: { operationId: OPERATION_ID, state: 'closed' } });
    }
    return response({});
  });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  expect(await screen.findByRole('button', { name: 'Reconcile publication' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile publication' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => String(url).endsWith(`/publications/${OPERATION_ID}/reconcile`))).toBe(true));
  expect(screen.getByLabelText(/Closing ends retries for this receipt/)).not.toBeChecked();
  const close = screen.getByRole('button', { name: 'Close attempt — keep files' });
  expect(close).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Closing ends retries for this receipt/));
  fireEvent.click(close);
  expect(await screen.findByText('The attempt is closed. Candidate files, if any, remain in SharePoint and were not deleted.')).toBeInTheDocument();
  expect(closeCalls).toBe(1);
});

test('a failed job publish refreshes the selected version and the next attempt succeeds without navigation', async () => {
  let collectionLoads = 0;
  let version = 1;
  const attemptedVersions = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/transcriptions')) {
      collectionLoads += 1;
      return response(collection({ jobs: [job({ version })] }));
    }
    if (path.endsWith(`/${JOB_ID}`) && options.method === 'GET') return response({ job: job({ version }), content, candidates: [] });
    if (path.endsWith(`/${JOB_ID}/publish`)) {
      attemptedVersions.push(JSON.parse(options.body).expectedVersion);
      if (attemptedVersions.length === 1) {
        version = 3;
        return response({ error: 'temporary write failure', code: 'synthetic_failure' }, 503);
      }
      return response({ publication: { operationId: OPERATION_ID, state: 'published' }, currentArtifact });
    }
    return response({});
  });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  const publishButton = await screen.findByRole('button', { name: 'Publish transcript' });
  expect(publishButton).toBeEnabled();
  fireEvent.click(publishButton);
  await waitFor(() => expect(collectionLoads).toBeGreaterThanOrEqual(2));
  expect(await screen.findByText('temporary write failure')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Publish transcript' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Publish transcript' }));
  expect(await screen.findByText('Transcript published. The finalized downloads are now available below.')).toBeInTheDocument();
  expect(attemptedVersions).toEqual([1, 3]);
});

test('keeps text-only transcripts readable and disables bundle publication without timed utterances', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (String(url).endsWith('/transcriptions')) return response(collection());
    if (String(url).endsWith(`/${JOB_ID}`)) return response({ job: job(), content: { text: 'A plain text result.', utterances: [] }, candidates: [] });
    return response({});
  });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  expect(await screen.findByText('A plain text result.')).toBeInTheDocument();
  expect(screen.getByText(/cannot be published as a timed TXT\/VTT bundle/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Publish transcript' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Download draft TXT' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download draft VTT' })).not.toBeInTheDocument();
});

test('blocks a new publication while any shared transcript receipt is unresolved', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (String(url).endsWith('/transcriptions')) return response(collection({
      publications: [{ operationId: OPERATION_ID, state: 'unknown', inputJobId: 'unrelated-job' }],
    }));
    if (String(url).endsWith(`/${JOB_ID}`)) return response({ job: job(), content, candidates: [] });
    return response({});
  });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  expect(await screen.findByRole('heading', { name: 'Detected speakers (2)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Publish transcript' })).toBeDisabled();
  expect(screen.getByText('Resolve the existing transcript publication before starting another publication.')).toBeInTheDocument();
});

test('creates, reviews, saves and publishes a label-only correction against the original artifact version', async () => {
  let correction = {
    operationId: OPERATION_ID, state: 'draft', version: 1, sourceArtifactId: ARTIFACT_ID,
    sourceRevisionId: '66666666-6666-4666-8666-666666666666',
    expectedCurrentArtifactId: ARTIFACT_ID, expectedCurrentFingerprint: currentArtifact.fingerprint,
    speakerNames: {}, createdAt: '2026-10-01T17:00:00.000Z', expiresAt: '2026-10-08T17:00:00.000Z', errorCode: null,
  };
  const correctionContent = { text: 'Opening remarks.', utterances: [{ speakerId: 'A', startMs: 1000, endMs: 2300, text: 'Opening remarks.' }] };
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/transcriptions')) return response(collection({ jobs: [], correctionDrafts: [correction] }));
    if (path.endsWith(`/materials/${ARTIFACT_ID}/corrections`) && options.method === 'POST') {
      expect(options.body).toBe('{}');
      return response({ correction, content: correctionContent, candidates: collection().candidates, currentArtifact });
    }
    if (path.endsWith(`/corrections/${OPERATION_ID}`) && options.method === 'GET') return response({ correction, content: correctionContent, candidates: collection().candidates, currentArtifact });
    if (path.endsWith(`/corrections/${OPERATION_ID}`) && options.method === 'PATCH') {
      expect(JSON.parse(options.body)).toEqual({ expectedVersion: 1, speakerNames: { A: 'Jordan Rivera' } });
      correction = { ...correction, version: 2, speakerNames: { A: 'Jordan Rivera' } };
      return response({ correction });
    }
    if (path.endsWith(`/corrections/${OPERATION_ID}/publish`) && options.method === 'POST') {
      expect(JSON.parse(options.body)).toEqual({ expectedVersion: 2 });
      correction = { ...correction, state: 'published' };
      return response({ publication: { operationId: OPERATION_ID, state: 'published' }, currentArtifact: { ...currentArtifact, id: OPERATION_ID } });
    }
    return response({});
  });

  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Correct transcript' }));
  expect(await screen.findByRole('heading', { name: 'Correct published transcript' })).toBeInTheDocument();
  expect(screen.getAllByText('Opening remarks.').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Suggestions for Speaker A'), { target: { value: 'candidate-three' } });
  expect(screen.getByLabelText('Manual display name for Speaker A')).toHaveValue('Jordan Rivera');
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Publish correction' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Publish correction' }));
  expect(await screen.findByText('Correction published. The finalized downloads now include the saved labels.')).toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/jobs/'))).toBe(false);
});

test('reload after a 409 refreshes the selected job version and preserves the typed speaker name', async () => {
  let detailVersion = 0;
  let patchVersion = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/transcriptions')) return response(collection());
    if (path.endsWith(`/${JOB_ID}`) && options.method === 'GET') {
      detailVersion += 1;
      return response({ job: job({ version: detailVersion === 1 ? 1 : 2, speaker_names: detailVersion === 1 ? {} : { A: 'Updated elsewhere' } }), content, candidates: collection().candidates });
    }
    if (path.endsWith(`/${JOB_ID}/speakers`) && options.method === 'PATCH') {
      patchVersion += 1;
      const body = JSON.parse(options.body);
      if (patchVersion === 1) return response({ error: 'Speaker labels changed elsewhere.', code: 'transcription_version_conflict' }, 409);
      expect(body).toEqual({ expectedVersion: 2, speakerNames: { A: 'Alex Lee' } });
      return response({ job: job({ version: 3, speaker_names: body.speakerNames }) });
    }
    return response({});
  });

  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  fireEvent.change(await screen.findByLabelText('Manual display name for Speaker A'), { target: { value: 'Alex Lee' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
  expect(await screen.findByRole('button', { name: 'Reload latest job' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest job' }));
  await waitFor(() => expect(detailVersion).toBe(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save names' })).toBeEnabled());
  expect(screen.getByLabelText('Manual display name for Speaker A')).toHaveValue('Alex Lee');
  expect(screen.getByText('Unsaved speaker-name changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
  await waitFor(() => expect(patchVersion).toBe(2));
  expect(await screen.findByText('Speaker names saved.')).toBeInTheDocument();
});

test('a delayed job-save success cannot replace another job selected while it is pending', async () => {
  const secondJobId = '77777777-7777-4777-8777-777777777777';
  let resolveSave;
  const secondContent = { text: 'Second speaker turn.', utterances: [{ speaker: 'B', start: 3000, end: 4000, text: 'Second speaker turn.' }] };
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/transcriptions')) return response(collection({ jobs: [job(), job({ id: secondJobId, original_filename: 'second.m4a' })] }));
    if (path.endsWith(`/${JOB_ID}`) && options.method === 'GET') return response({ job: job(), content, candidates: [] });
    if (path.endsWith(`/${JOB_ID}/speakers`) && options.method === 'PATCH') return new Promise((resolve) => { resolveSave = resolve; });
    if (path.endsWith(`/${secondJobId}`) && options.method === 'GET') return response({ job: job({ id: secondJobId, original_filename: 'second.m4a' }), content: secondContent, candidates: [] });
    return response({});
  });

  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  fireEvent.change(await screen.findByLabelText('Manual display name for Speaker A'), { target: { value: 'First name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
  fireEvent.click(screen.getByRole('button', { name: /second\.m4a/ }));
  expect(await screen.findByLabelText('Manual display name for Speaker B')).toHaveValue('');
  await act(async () => { resolveSave(response({ job: job({ version: 2, speaker_names: { A: 'First name' } }) })); });
  expect(screen.getByRole('heading', { name: 'second.m4a' })).toBeInTheDocument();
  expect(screen.getByLabelText('Manual display name for Speaker B')).toHaveValue('');
  expect(screen.queryByText('Speaker names saved.')).not.toBeInTheDocument();
});

test('a delayed correction-save conflict cannot overwrite another job selected while it is pending', async () => {
  const secondJobId = '77777777-7777-4777-8777-777777777777';
  let resolveSave;
  const correction = {
    operationId: OPERATION_ID, state: 'draft', version: 1, sourceArtifactId: ARTIFACT_ID,
    expectedCurrentArtifactId: ARTIFACT_ID, expectedCurrentFingerprint: currentArtifact.fingerprint, speakerNames: {},
  };
  const correctionContent = { text: 'Opening remarks.', utterances: [{ speakerId: 'A', startMs: 1000, endMs: 2300, text: 'Opening remarks.' }] };
  const secondContent = { text: 'Second speaker turn.', utterances: [{ speaker: 'B', start: 3000, end: 4000, text: 'Second speaker turn.' }] };
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/transcriptions')) return response(collection({ jobs: [job({ id: secondJobId, original_filename: 'second.m4a' })], correctionDrafts: [correction] }));
    if (path.endsWith(`/corrections/${OPERATION_ID}`) && options.method === 'GET') return response({ correction, content: correctionContent, candidates: [], currentArtifact });
    if (path.endsWith(`/corrections/${OPERATION_ID}`) && options.method === 'PATCH') return new Promise((resolve) => { resolveSave = resolve; });
    if (path.endsWith(`/${secondJobId}`) && options.method === 'GET') return response({ job: job({ id: secondJobId, original_filename: 'second.m4a' }), content: secondContent, candidates: [] });
    return response({});
  });

  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /Correction ·/ }));
  await screen.findByRole('heading', { name: 'Correct published transcript' });
  fireEvent.change(screen.getByLabelText('Manual display name for Speaker A'), { target: { value: 'Correction name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
  fireEvent.click(screen.getByRole('button', { name: /second\.m4a/ }));
  expect(await screen.findByLabelText('Manual display name for Speaker B')).toHaveValue('');
  await act(async () => { resolveSave(response({ error: 'Correction changed elsewhere.' }, 409)); });
  expect(screen.getByRole('heading', { name: 'second.m4a' })).toBeInTheDocument();
  expect(screen.getByLabelText('Manual display name for Speaker B')).toHaveValue('');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('does not let a stale request load replace the newly selected request', async () => {
  let resolveOld;
  global.fetch = jest.fn((url) => {
    if (String(url).includes(REQUEST_ID)) return new Promise((resolve) => { resolveOld = resolve; });
    return Promise.resolve(response(collection({ siteVisitActivityId: '77777777-7777-4777-8777-777777777777', jobs: [] })));
  });
  const view = render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  view.rerender(<MeetingTranscriptionPanel requestId="88888888-8888-4888-8888-888888888888" />);
  await screen.findByText('No temporary drafts yet. Uploaded recordings appear here while processing and review.');
  resolveOld?.(response(collection({ jobs: [job({ original_filename: 'stale.m4a' })] })));
  await waitFor(() => expect(screen.queryByText('stale.m4a')).not.toBeInTheDocument());
  expect(global.fetch.mock.calls.map(([url]) => String(url)).some((url) => url.includes(VISIT_ID))).toBe(false);
});
