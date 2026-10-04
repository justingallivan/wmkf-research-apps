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

test('refresh removes selected content when the draft disappears from the authorized list', async () => {
  let listed = true;
  global.fetch = jest.fn(async (url) => String(url).endsWith('/transcriptions')
    ? response(collection({ jobs: listed ? [job()] : [] }))
    : response({ job: job(), content, candidates: [] }));
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  await screen.findByRole('link', { name: 'Download draft TXT' });
  listed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Download draft TXT' })).not.toBeInTheDocument());
  expect(screen.queryByText('Hello from the site visit.')).not.toBeInTheDocument();
});

test('an older collection refresh does not replace a newer detail version before saving names', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).endsWith('/transcriptions')) return response(collection());
    if (options.method === 'PATCH') {
      expect(JSON.parse(options.body).expectedVersion).toBe(5);
      return response({ job: job({ version: 6, speaker_names: { A: 'Named speaker' } }) });
    }
    return response({ job: job({ version: 5 }), content, candidates: [] });
  });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  await screen.findByLabelText('Manual display name for Speaker A');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh status' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Manual display name for Speaker A'), { target: { value: 'Named speaker' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
  await screen.findByText('Speaker names saved.');
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
      return response({ job: uploadedJob, upload: { pathname: 'private/path', token: 'scoped-token', contentType: 'audio/mpeg', maximumSizeInBytes: 209715200, access: 'private' } });
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
  fireEvent.click(await screen.findByRole('button', { name: 'Continue without it' }));

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
  // Formatter v3 (2026-10-04): one paragraph per speaker turn labelled with its start time, no minute headings.
  expect(screen.getByText('01:02')).toBeInTheDocument();
  expect(screen.getByText('02:05')).toBeInTheDocument();
  expect(screen.queryByText('1:00')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Transcript by speaker turn')).toBeInTheDocument();

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

test('distinguishes observed content deletion from a retained late-upload safety watch', async () => {
  const cleanedDraft = job({
    original_filename: 'deleted-draft.m4a', status: 'expired', label: 'Expired',
    contentAccessAllowed: false, cleanup_requested_at: '2026-10-01T18:00:00.000Z',
    contentDeletionObserved: true, lateUploadWatchPending: true, cleanupPending: true,
  });
  global.fetch = jest.fn(async (url) => {
    if (String(url).endsWith('/transcriptions')) return response(collection({ jobs: [cleanedDraft] }));
    if (String(url).endsWith(`/${JOB_ID}`)) return response({ job: cleanedDraft, content: null, candidates: [] });
    return response({});
  });

  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /deleted-draft\.m4a/ }));

  expect(await screen.findByText('Deletion of this draft’s readable content was observed.')).toBeInTheDocument();
  expect(screen.getByText(/temporary upload path remains under a late-upload safety watch/)).toBeInTheDocument();
  expect(screen.getByText(/does not confirm that an automatic cleanup worker is running/)).toBeInTheDocument();
});

test('refreshing the selected job immediately revokes stale transcript detail and unsafe name drafts', async () => {
  let collectionLoads = 0;
  const cleanupJob = job({
    original_filename: 'site-visit.m4a', status: 'expired', label: 'Expired',
    contentAccessAllowed: false, cleanup_requested_at: '2026-10-01T18:00:00.000Z',
    contentDeletionObserved: true, lateUploadWatchPending: true, cleanupPending: true,
  });
  global.fetch = jest.fn(async (url) => {
    if (String(url).endsWith('/transcriptions')) {
      collectionLoads += 1;
      return response(collection({ jobs: [collectionLoads === 1 ? job() : cleanupJob] }));
    }
    if (String(url).endsWith(`/${JOB_ID}`)) return response({ job: job(), content, candidates: collection().candidates });
    return response({});
  });

  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  fireEvent.change(await screen.findByLabelText('Manual display name for Speaker A'), { target: { value: 'Unsaved test label' } });
  expect(screen.getByText('Unsaved speaker-name changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));

  expect(await screen.findByText('Deletion of this draft’s readable content was observed.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Hello from the site visit.')).not.toBeInTheDocument());
  expect(screen.queryByRole('link', { name: 'Download draft TXT' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Manual display name for Speaker A')).not.toBeInTheDocument();
  expect(screen.queryByText('Unsaved speaker-name changes')).not.toBeInTheDocument();
  expect(screen.getByText(/temporary upload path remains under a late-upload safety watch/)).toBeInTheDocument();
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
  const correctionContent = { text: '', utterances: [{ speaker: 'A', start: 59000, end: 62000, text: 'Opening remarks.',
    words: [{ start: 59000, end: 59500, text: 'Opening' }, { start: 61000, end: 62000, text: 'remarks.' }] }] };
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
  // A word-timed utterance is no longer split at the minute boundary: one turn, one paragraph.
  expect(screen.getByText('00:59')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '1:00' })).not.toBeInTheDocument();
  expect(screen.getAllByText('Opening remarks.').length).toBeGreaterThan(0); // transcript turn + editor excerpt
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
  const correctionContent = { text: 'Opening remarks.', utterances: [{ speaker: 'A', start: 1000, end: 2300, text: 'Opening remarks.' }] };
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

test('review-only rehearsal supports speaker labels while hiding other job and publication actions', async () => {
  const rehearsalBase = '/api/meeting-transcription-rehearsal';
  put.mockClear();
  const savedJob = job({ original_filename: 'synthetic-rehearsal.json' });
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (path === rehearsalBase) return response(collection({
      jobs: [savedJob],
      currentArtifact,
      publications: [{ operationId: OPERATION_ID, state: 'unknown', inputJobId: JOB_ID }],
      correctionDrafts: [{ operationId: OPERATION_ID, state: 'draft', sourceRevisionId: 'synthetic-revision' }],
    }));
    if (path === `${rehearsalBase}/${JOB_ID}/speakers`) {
      expect(options.method).toBe('PATCH');
      return response({ job: job({ speaker_names: { A: 'Synthetic PI' } }) });
    }
    if (path === `${rehearsalBase}/${JOB_ID}`) return response({ job: savedJob, content, candidates: collection().candidates });
    return response({});
  });

  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} apiBasePath={rehearsalBase} reviewOnly />);
  fireEvent.click(await screen.findByRole('button', { name: /synthetic-rehearsal\.json/ }));
  expect(await screen.findByRole('heading', { name: 'Detected speakers (2)' })).toBeInTheDocument();
  expect(screen.getByText('Review the synthetic transcript and save speaker display names.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Audio file')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Upload and start transcription' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Publish transcript' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete temporary draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Publication status' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Correction drafts' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Current published transcript' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download draft TXT' })).toHaveAttribute('href', `${rehearsalBase}/${JOB_ID}/download?format=txt`);

  fireEvent.change(screen.getByLabelText('Manual display name for Speaker A'), { target: { value: 'Synthetic PI' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save names' }));
  await screen.findByText('Speaker names saved.');
  const writes = global.fetch.mock.calls.filter(([, options]) => ['POST', 'PATCH', 'DELETE'].includes(options?.method));
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe(`${rehearsalBase}/${JOB_ID}/speakers`);
  expect(JSON.parse(writes[0][1].body)).toEqual({ expectedVersion: 1, speakerNames: { A: 'Synthetic PI' } });
  expect(put).not.toHaveBeenCalled();
});

// --- Zoom transcript (VTT) upload and speaker alignment ---
const isStart = ([url, options]) => String(url).endsWith(`/${JOB_ID}/start`) && options?.method === 'POST';
const isCreate = ([url, options]) => String(url).endsWith('/transcriptions') && options?.method === 'POST';
const zoomUpload = { pathname: 'zoom/path', token: 'zoom-token', contentType: 'text/vtt', maximumSizeInBytes: 4000000 };

function mockUploadFetch({ zoom = zoomUpload, onCreate } = {}) {
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => '99999999-9999-4999-8999-999999999999') });
  const uploadedJob = job({ status: 'uploading', version: 1 });
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    if (isCreate([url, options])) {
      const pending = onCreate ? onCreate() : null;
      if (pending) await pending;
      return response({ job: uploadedJob, upload: { pathname: 'private/path', token: 'scoped-token', contentType: 'audio/mpeg', maximumSizeInBytes: 209715200, access: 'private', zoomTranscript: zoom } });
    }
    if (path.endsWith(`/${JOB_ID}/start`)) return response({ job: job({ status: 'queued', version: 2 }) });
    if (path.endsWith('/transcriptions')) return response(collection({ jobs: [uploadedJob] }));
    if (path.endsWith(`/${JOB_ID}`)) return response({ job: job({ status: 'queued', version: 2 }), content: null, candidates: [] });
    return response({});
  });
  put.mockReset();
  put.mockResolvedValue({ url: 'https://blob.example/x' });
}

async function pickFiles({ audio, vtt, ack = true } = {}) {
  if (audio) fireEvent.change(await screen.findByLabelText('Audio file'), { target: { files: [audio] } });
  if (vtt) fireEvent.change(screen.getByLabelText('Zoom transcript (.vtt, optional)'), { target: { files: [vtt] } });
  if (ack) fireEvent.click(screen.getByLabelText(/I confirm the recording is non-sensitive/));
}

const audioFile = () => new File(['audio'], 'recording.mp3', { type: 'audio/mpeg' });
const vttFileOf = (type = 'text/vtt', size = 'WEBVTT\n') => new File([size], 'zoom.vtt', { type });

test('audio only asks for confirmation instead of submitting, and continuing omits zoomTranscript', async () => {
  mockUploadFetch({ zoom: null });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  await pickFiles({ audio: audioFile() });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));
  expect(await screen.findByText('No Zoom transcript selected. Speakers will need to be named by hand after transcription.')).toBeInTheDocument();
  expect(global.fetch.mock.calls.some(isCreate)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Continue without it' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(isStart)).toBe(true));
  const createCall = global.fetch.mock.calls.find(isCreate);
  expect(JSON.parse(createCall[1].body)).not.toHaveProperty('zoomTranscript');
  expect(put).toHaveBeenCalledTimes(1);
});

test('"Add Zoom transcript" focuses the VTT input without submitting', async () => {
  mockUploadFetch({ zoom: null });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  await pickFiles({ audio: audioFile() });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add Zoom transcript' }));
  expect(screen.getByLabelText('Zoom transcript (.vtt, optional)')).toHaveFocus();
  expect(screen.queryByText(/No Zoom transcript selected/)).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.some(isCreate)).toBe(false);
});

test('audio plus VTT submits directly, uploads both blobs, then starts', async () => {
  mockUploadFetch();
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  const audio = audioFile();
  const vtt = vttFileOf('', 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nA: hi\n');
  Object.defineProperty(vtt, 'type', { value: '' });
  expect(vtt.type).toBe('');
  await pickFiles({ audio, vtt });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(isStart)).toBe(true));
  expect(screen.queryByText(/No Zoom transcript selected/)).not.toBeInTheDocument();
  const body = JSON.parse(global.fetch.mock.calls.find(isCreate)[1].body);
  expect(body.zoomTranscript).toEqual({ contentType: 'text/vtt', bytes: vtt.size });
  expect(body.zoomTranscript).not.toHaveProperty('filename');
  expect(put).toHaveBeenCalledTimes(2);
  expect(put.mock.calls[0][0]).toBe('private/path');
  expect(put.mock.calls[1][0]).toBe('zoom/path');
  expect(put.mock.calls[1][1]).toBe(vtt);
  expect(put.mock.calls[1][2]).toEqual(expect.objectContaining({ access: 'private', token: 'zoom-token', contentType: 'text/vtt' }));
  expect(put.mock.invocationCallOrder[1]).toBeLessThan(global.fetch.mock.invocationCallOrder[global.fetch.mock.calls.findIndex(isStart)]);
});

test('a VTT larger than the server limit errors before any blob upload', async () => {
  mockUploadFetch({ zoom: { ...zoomUpload, maximumSizeInBytes: 3 } });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  await pickFiles({ audio: audioFile(), vtt: vttFileOf('text/vtt', 'WEBVTT and more') });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));
  expect(await screen.findByText(/Zoom transcript exceeds the private upload limit/)).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
  expect(global.fetch.mock.calls.some(isStart)).toBe(false);
});

test('rejects a non-.vtt transcript file client-side', async () => {
  mockUploadFetch();
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  await pickFiles({ audio: audioFile() });
  fireEvent.change(screen.getByLabelText('Zoom transcript (.vtt, optional)'), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
  expect(screen.getByText('Choose a Zoom transcript saved as a .vtt file.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload and start transcription' })).toBeDisabled();
});

test('selecting two files in one input sorts them into the audio and VTT slots', async () => {
  mockUploadFetch();
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  const audio = audioFile();
  const vtt = vttFileOf();
  fireEvent.change(await screen.findByLabelText('Audio file'), { target: { files: [vtt, audio] } });
  expect(screen.getByText(/recording\.mp3/)).toBeInTheDocument();
  expect(screen.getByText(/zoom\.vtt/)).toBeInTheDocument();
});

test('the no-transcript confirmation resets when the audio file changes', async () => {
  mockUploadFetch({ zoom: null });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  await pickFiles({ audio: audioFile() });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));
  await screen.findByText(/No Zoom transcript selected/);
  fireEvent.change(screen.getByLabelText('Audio file'), { target: { files: [new File(['other'], 'other.mp3', { type: 'audio/mpeg' })] } });
  expect(screen.queryByText(/No Zoom transcript selected/)).not.toBeInTheDocument();
});

test('acknowledgement mentions Anthropic only when a Zoom transcript is selected', async () => {
  mockUploadFetch();
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  await pickFiles({ audio: audioFile(), ack: false });
  expect(screen.getByLabelText(/I confirm the recording is non-sensitive/).closest('label')).toHaveTextContent('AssemblyAI');
  expect(screen.getByLabelText(/I confirm the recording is non-sensitive/).closest('label')).not.toHaveTextContent('Anthropic');
  await pickFiles({ vtt: vttFileOf(), ack: false });
  expect(screen.getByLabelText(/I confirm the recording is non-sensitive/).closest('label')).toHaveTextContent('excerpts of both transcripts are sent to Anthropic');
});

test('a request change while the upload is being prepared uploads and starts nothing', async () => {
  let release;
  mockUploadFetch({ onCreate: () => new Promise((resolve) => { release = resolve; }) });
  const view = render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  await pickFiles({ audio: audioFile(), vtt: vttFileOf() });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(isCreate)).toBe(true));
  view.rerender(<MeetingTranscriptionPanel requestId="88888888-8888-4888-8888-888888888888" />);
  await act(async () => { release(); });
  await act(async () => { await Promise.resolve(); });
  expect(put).not.toHaveBeenCalled();
  expect(global.fetch.mock.calls.some(isStart)).toBe(false);
});

async function openReadyJob(alignment, extra = {}) {
  global.fetch = jest.fn(async (url) => {
    const jobBody = job({ speaker_alignment: alignment, zoomTranscriptAttached: alignment !== undefined, ...extra });
    if (String(url).endsWith('/transcriptions')) return response(collection({ jobs: [jobBody] }));
    return response({ job: jobBody, content, candidates: [] });
  });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  await screen.findByLabelText('Manual display name for Speaker A');
}
const editorDetails = () => screen.getByText('Adjust names manually').closest('details');

test('pending alignment shows the matching notice, collapses the editor and blocks save and publish', async () => {
  await openReadyJob({ status: 'pending' });
  expect(screen.getByText('Matching speaker names from the Zoom transcript…')).toBeInTheDocument();
  expect(editorDetails().open).toBe(false);
  fireEvent.change(screen.getByLabelText('Manual display name for Speaker A'), { target: { value: 'Typed' } });
  expect(screen.getByRole('button', { name: 'Save names' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Publish transcript' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Check matching status' })).toBeEnabled();
});

test('applied alignment lists names with confidence and collapses the editor', async () => {
  await openReadyJob({ status: 'applied', speakers: { A: { name: 'Dana Ortiz', confidence: 0.92, basis: 'model' }, B: { name: 'Sam Lee', confidence: 0.8, basis: 'support' } } }, { speaker_names: { A: 'Dana Ortiz', B: 'Sam Lee' } });
  expect(screen.getByText('Speaker names from Zoom transcript')).toBeInTheDocument();
  expect(screen.getByText(/Speaker A: Dana Ortiz \(92% confidence\)/)).toBeInTheDocument();
  expect(screen.getByText(/Speaker B: Sam Lee \(80% confidence, matched captions\)/)).toBeInTheDocument();
  expect(editorDetails().open).toBe(false);
  expect(screen.getByLabelText('Manual display name for Speaker A')).toHaveValue('Dana Ortiz');
  expect(screen.getByRole('button', { name: 'Save names' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Publish transcript' })).toBeEnabled();
});

test('partial alignment opens the editor and a suggestion button fills the draft', async () => {
  await openReadyJob({ status: 'partial', speakers: { A: { name: 'Dana Ortiz', confidence: 0.9 } }, suggestions: { B: ['Sam Lee', 'Samuel Lee'] }, code: 'secret_internal_code' }, { speaker_names: { A: 'Dana Ortiz' } });
  expect(editorDetails().open).toBe(true);
  expect(screen.queryByText(/secret_internal_code/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Suggestions for Speaker B'), { target: { value: 'candidate-three' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use Sam Lee for Speaker B' }));
  expect(screen.getByLabelText('Manual display name for Speaker B')).toHaveValue('Sam Lee');
  expect(screen.getByLabelText('Suggestions for Speaker B')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Save names' })).toBeEnabled();
});

test.each([
  ['abstained', 'The Zoom transcript did not match the speakers confidently; name them manually.'],
  ['no_speakers', 'The Zoom transcript has no speaker labels.'],
  ['failed', 'Automatic speaker matching did not complete; name speakers manually.'],
  ['superseded', 'Names were edited before matching finished.'],
])('%s alignment keeps the editor primary with a one-line reason', async (status, reason) => {
  await openReadyJob({ status, code: 'internal_code_x' });
  expect(screen.getByText(reason)).toBeInTheDocument();
  expect(screen.queryByText('Adjust names manually')).not.toBeInTheDocument();
  expect(screen.queryByText(/internal_code_x/)).not.toBeInTheDocument();
});

test('a job with no alignment renders the legacy editor without alignment notices', async () => {
  await openReadyJob(undefined);
  expect(screen.queryByText('Adjust names manually')).not.toBeInTheDocument();
  expect(screen.queryByText(/Speaker names from Zoom transcript|Matching speaker names|did not match|no speaker labels/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Publish transcript' })).toBeEnabled();
});

test('a create response without a Zoom transcript upload errors before any put or start and re-enables the button', async () => {
  mockUploadFetch({ zoom: null });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  await pickFiles({ audio: audioFile(), vtt: vttFileOf() });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));
  expect(await screen.findByText(/did not return a Zoom transcript upload/)).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
  expect(global.fetch.mock.calls.some(isStart)).toBe(false);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Upload and start transcription' })).toBeEnabled());
});

test('a Zoom transcript upload contract without an integer size limit errors before any put', async () => {
  mockUploadFetch({ zoom: { ...zoomUpload, maximumSizeInBytes: undefined } });
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  await pickFiles({ audio: audioFile(), vtt: vttFileOf() });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and start transcription' }));
  expect(await screen.findByText(/incomplete Zoom transcript contract/)).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
});

test('multi-file selection never clears the other slot', async () => {
  mockUploadFetch();
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  await pickFiles({ audio: audioFile(), vtt: vttFileOf(), ack: false });
  const second = new File(['v'], 'second.vtt', { type: 'text/vtt' });
  fireEvent.change(screen.getByLabelText('Zoom transcript (.vtt, optional)'), { target: { files: [vttFileOf(), second] } });
  expect(screen.getByText(/recording\.mp3/)).toBeInTheDocument();
  const otherAudio = new File(['a'], 'other.mp3', { type: 'audio/mpeg' });
  fireEvent.change(screen.getByLabelText('Audio file'), { target: { files: [audioFile(), otherAudio] } });
  expect(screen.getByText(/zoom\.vtt/)).toBeInTheDocument();
});

async function openPendingThenApply({ typeFirst }) {
  let applied = false;
  const jobBody = () => (applied
    ? job({ version: 2, speaker_alignment: { status: 'applied', speakers: { A: { name: 'Dana Ortiz', confidence: 0.9 }, B: { name: 'Sam Lee', confidence: 0.9 } } }, zoomTranscriptAttached: true, speaker_names: { A: 'Dana Ortiz', B: 'Sam Lee' } })
    : job({ speaker_alignment: { status: 'pending' }, zoomTranscriptAttached: true }));
  global.fetch = jest.fn(async (url) => (String(url).endsWith('/transcriptions')
    ? response(collection({ jobs: [jobBody()] }))
    : response({ job: jobBody(), content, candidates: [] })));
  render(<MeetingTranscriptionPanel requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: /site-visit\.m4a/ }));
  await screen.findByLabelText('Manual display name for Speaker A');
  if (typeFirst) fireEvent.change(screen.getByLabelText('Manual display name for Speaker A'), { target: { value: 'Typed A' } });
  applied = true;
  fireEvent.click(screen.getByRole('button', { name: 'Check matching status' }));
  await screen.findByText('Speaker names from Zoom transcript');
}

test('an untouched draft shows the applied names once matching finishes', async () => {
  await openPendingThenApply({ typeFirst: false });
  expect(screen.getByLabelText('Manual display name for Speaker A')).toHaveValue('Dana Ortiz');
  expect(screen.getByLabelText('Manual display name for Speaker B')).toHaveValue('Sam Lee');
  expect(screen.getByText('Speaker names saved')).toBeInTheDocument();
});

test('a name typed during matching survives completion', async () => {
  await openPendingThenApply({ typeFirst: true });
  expect(screen.getByLabelText('Manual display name for Speaker A')).toHaveValue('Typed A');
  expect(screen.getByLabelText('Manual display name for Speaker B')).toHaveValue('');
  expect(screen.getByText('Unsaved speaker-name changes')).toBeInTheDocument();
});

test('applied alignment reports how many short utterances were reattributed from the Zoom captions', async () => {
  await openReadyJob({ status: 'applied', speakers: { A: { name: 'Dana Ortiz', confidence: 0.92, basis: 'model' } }, reassignedCount: 2 }, { speaker_names: { A: 'Dana Ortiz' } });
  expect(screen.getByText(/2 short utterances were reattributed to the speaker the Zoom captions show at that moment\./)).toBeInTheDocument();
});
