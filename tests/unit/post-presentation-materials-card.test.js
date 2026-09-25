/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostPresentationMaterialsCard from '../../shared/components/meeting-tracker/PostPresentationMaterialsCard';
import {
  fingerprintGraphBrowserUploadFile,
  uploadBrowserDirectGraphFile,
  withGraphBrowserUploadLock,
} from '../../shared/utils/graph-browser-upload';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  Button: ({ children, loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/utils/graph-browser-upload', () => ({
  GRAPH_UPLOAD_DEFAULT_CHUNK_BYTES: 10 * 1024 * 1024,
  fingerprintGraphBrowserUploadFile: jest.fn(async () => 'a'.repeat(64)),
  nextExpectedStart: jest.fn(() => 0),
  uploadBrowserDirectGraphFile: jest.fn(),
  withGraphBrowserUploadLock: jest.fn(async (_key, task) => task()),
}));

const REQUEST_A = '11111111-1111-4111-8111-111111111111';
const REQUEST_B = '22222222-2222-4222-8222-222222222222';
const UPLOAD_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_UPLOAD_ID = '44444444-4444-4444-8444-444444444444';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function uploadContract() {
  return {
    uploadId: UPLOAD_ID,
    lockKey: UPLOAD_ID,
    uploadUrl: 'https://upload.example/session',
    nextExpectedRanges: ['0-'],
    chunkBytes: 10 * 1024 * 1024,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: jest.fn(() => UPLOAD_ID),
  });
});

test('new MP4 uses the shared transport and renders only Graph-confirmed bytes as durable progress', async () => {
  let finishTransport;
  uploadBrowserDirectGraphFile.mockImplementation(async ({ onState }) => {
    onState({
      phase: 'reconnecting', confirmedBytes: 10, inFlightBytes: 12, totalBytes: 20,
      percent: 50, mbps: null, etaSeconds: null,
    });
    return new Promise((resolve) => { finishTransport = resolve; });
  });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) {
      return response({ success: true, upload: uploadContract() });
    }
    return response({ success: true, status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  const file = new File(['01234567890123456789'], 'recording.mp4', { type: 'video/mp4' });
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));

  expect(await screen.findByText(/Graph-confirmed: 10 bytes of 20 bytes/)).toBeInTheDocument();
  expect(screen.getByText(/In flight, not yet confirmed: 2 bytes/)).toBeInTheDocument();
  expect(screen.getByText('Throughput: Measuring…')).toBeInTheDocument();
  expect(screen.getByText('ETA: Unknown while waiting')).toBeInTheDocument();
  expect(fingerprintGraphBrowserUploadFile).toHaveBeenCalledWith(file);
  expect(withGraphBrowserUploadLock).toHaveBeenCalledWith(UPLOAD_ID, expect.any(Function));
  expect(uploadBrowserDirectGraphFile).toHaveBeenCalledWith(expect.objectContaining({
    file,
    uploadUrl: 'https://upload.example/session',
    chunkBytes: 10 * 1024 * 1024,
    authorizeStatus: expect.any(Function),
  }));

  finishTransport({ complete: false, paused: true, reason: 'retry_exhausted', nextStart: 10 });
  expect(await screen.findByText(/Microsoft-confirmed progress is retained/)).toBeInTheDocument();
});

test('pause control truthfully becomes Pausing while the current fragment finishes', async () => {
  let finishTransport;
  uploadBrowserDirectGraphFile.mockImplementation(async ({ onState, shouldPause }) => {
    onState({ phase: 'uploading', confirmedBytes: 0, inFlightBytes: 5, totalBytes: 10, percent: 0, mbps: null, etaSeconds: null });
    return new Promise((resolve) => { finishTransport = () => resolve({ complete: false, paused: true, reason: shouldPause() ? 'requested' : 'other' }); });
  });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pause after fragment' }));
  expect(screen.getByText('Pausing after the current fragment…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause after fragment' })).toBeDisabled();
  finishTransport();
  expect(await screen.findByText(/progress is retained/)).toBeInTheDocument();
});

test('automatic retry exhaustion is not labelled as a user pause', async () => {
  uploadBrowserDirectGraphFile.mockImplementation(async ({ onState }) => {
    onState({
      phase: 'paused', reason: 'retry_exhausted', confirmedBytes: 10,
      inFlightBytes: 10, totalBytes: 20, percent: 50, mbps: null, etaSeconds: null,
    });
    return { complete: false, paused: true, reason: 'retry_exhausted', nextStart: 10 };
  });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  expect(await screen.findByText('Automatic retry stopped without losing Microsoft-confirmed progress.')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Automatic retry stopped');
  expect(screen.getByRole('status')).not.toHaveTextContent('Upload paused');
});

test('a failed status check refreshes unfinished uploads and gives status-specific guidance', async () => {
  uploadBrowserDirectGraphFile.mockImplementation(async ({ authorizeStatus, onState }) => {
    onState({
      phase: 'reconnecting', confirmedBytes: 5, inFlightBytes: 5,
      totalBytes: 10, percent: 50, mbps: null, etaSeconds: null,
    });
    return authorizeStatus();
  });
  let listLoads = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
    if (url.endsWith(`/${UPLOAD_ID}/resume`)) {
      return response({ error: 'expired', code: 'post_presentation_upload_session_expired' }, 410);
    }
    listLoads += 1;
    return response({
      status: 'ready', materials: [], uploads: listLoads > 1 ? [{
        uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 10,
        state: 'expired', canResume: false, canFinalize: false,
      }] : [],
    });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Microsoft confirmed that this upload session expired');
  expect(screen.getByText('recording.mp4')).toBeInTheDocument();
  expect(screen.queryByLabelText('Graph-confirmed upload progress')).not.toBeInTheDocument();
  expect(listLoads).toBeGreaterThan(1);
});

test('an upload lock error keeps its specific message', async () => {
  uploadBrowserDirectGraphFile.mockRejectedValue(Object.assign(
    new Error('This upload is already active in another tab.'),
    { code: 'graph_upload_locked' },
  ));
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already active in another tab');
});

test.each([
  ['post_presentation_upload_session_closed', 'Microsoft closed this upload session'],
  ['post_presentation_site_visit_changed', 'The active Site Visit changed'],
  ['post_presentation_resume_fingerprint_mismatch', 'does not match this unfinished upload'],
  ['post_presentation_finalize_in_progress', 'already being saved'],
  ['post_presentation_upload_changed', 'unfinished upload changed'],
  ['unexpected_conflict', 'Conflict supplied by the server'],
])('409 status code %s gives the correct guidance', async (code, expected) => {
  uploadBrowserDirectGraphFile.mockImplementation(async ({ authorizeStatus }) => authorizeStatus());
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
    if (url.endsWith(`/${UPLOAD_ID}/resume`)) {
      return response({ error: 'Conflict supplied by the server', code }, 409);
    }
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(expected);
});

test('an unreachable status route gives connection guidance instead of a raw browser error', async () => {
  uploadBrowserDirectGraphFile.mockImplementation(async ({ authorizeStatus }) => authorizeStatus());
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
    if (url.endsWith(`/${UPLOAD_ID}/resume`)) throw new TypeError('Failed to fetch');
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('upload connection failed');
  expect(alert).not.toHaveTextContent('Failed to fetch');
});

test.each([
  [Object.assign(new Error('Graph transfer failed'), { code: 'graph_upload_network_error' }), 'upload connection failed', 'Graph transfer failed'],
  [Object.assign(new Error('Microsoft rejected this fragment.'), { status: 410 }), 'Microsoft rejected this fragment.', 'Microsoft confirmed that this upload session expired'],
])('Graph transport errors remain distinct from app-route errors', async (transportError, expected, excluded) => {
  uploadBrowserDirectGraphFile.mockRejectedValue(transportError);
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(expected);
  expect(alert).not.toHaveTextContent(excluded);
});

test.each([
  ['missing fields', {}],
  ['a mismatched upload identity', { ...uploadContract(), uploadId: OTHER_UPLOAD_ID }],
  ['a missing upload URL', { ...uploadContract(), uploadUrl: undefined }],
  ['empty expected ranges', { ...uploadContract(), nextExpectedRanges: [] }],
  ['the wrong chunk size', { ...uploadContract(), chunkBytes: 5 * 1024 * 1024 }],
])('a successful status response with %s is rejected as an invalid contract', async (_label, invalidUpload) => {
  uploadBrowserDirectGraphFile.mockImplementation(async ({ authorizeStatus }) => authorizeStatus());
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
    if (url.endsWith(`/${UPLOAD_ID}/resume`)) return response({ upload: invalidUpload });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('invalid transfer contract');
  expect(alert).not.toHaveTextContent('connection failed');
});

test.each([
  ['missing fields', {}],
  ['a server upload identity that differs from the operation identity', {
    ...uploadContract(), uploadId: OTHER_UPLOAD_ID,
  }],
  ['a completed state that cannot be returned by create', { ...uploadContract(), complete: true }],
  ['a missing upload URL', { ...uploadContract(), uploadUrl: undefined }],
  ['empty expected ranges', { ...uploadContract(), nextExpectedRanges: [] }],
  ['the wrong chunk size', { ...uploadContract(), chunkBytes: 5 * 1024 * 1024 }],
])('a create response with %s is rejected before browser transport starts', async (_label, invalidUpload) => {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) {
      return response({ upload: invalidUpload });
    }
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid transfer contract');
  expect(uploadBrowserDirectGraphFile).not.toHaveBeenCalled();
});

test.each([
  ['missing fields', {}],
  ['a mismatched upload identity', { ...uploadContract(), uploadId: OTHER_UPLOAD_ID }],
  ['a missing upload URL', { ...uploadContract(), uploadUrl: undefined }],
  ['empty expected ranges', { ...uploadContract(), nextExpectedRanges: [] }],
  ['the wrong chunk size', { ...uploadContract(), chunkBytes: 5 * 1024 * 1024 }],
])('manual Resume rejects %s before browser transport starts', async (_label, invalidUpload) => {
  const intent = {
    uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4,
    state: 'initiated', canResume: true, canFinalize: false,
  };
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith(`/${UPLOAD_ID}/resume`)) return response({ upload: invalidUpload });
    return response({ status: 'ready', materials: [], uploads: [intent] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['same'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid transfer contract');
  expect(uploadBrowserDirectGraphFile).not.toHaveBeenCalled();
});

test('automatic status reconciliation uses the bounded timeout', async () => {
  let statusStarted = false;
  uploadBrowserDirectGraphFile.mockImplementation(async ({ authorizeStatus }) => authorizeStatus());
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
    if (url.endsWith(`/${UPLOAD_ID}/resume`)) {
      statusStarted = true;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      });
    }
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  jest.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
    await act(async () => {
      for (let step = 0; step < 5; step += 1) await Promise.resolve();
    });
    expect(statusStarted).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(75_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('status check timed out');
  } finally {
    jest.useRealTimers();
  }
});

test('a request switch aborts an in-flight status check without showing an error', async () => {
  let statusStarted = false;
  let statusAborted = false;
  uploadBrowserDirectGraphFile.mockImplementation(async ({ authorizeStatus }) => authorizeStatus());
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
    if (url.endsWith(`/${UPLOAD_ID}/resume`)) {
      statusStarted = true;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          statusAborted = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    }
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  const view = render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  await waitFor(() => expect(statusStarted).toBe(true));
  view.rerender(<PostPresentationMaterialsCard requestId={REQUEST_B} />);
  await waitFor(() => expect(statusAborted).toBe(true));
  expect(await screen.findByLabelText('Zoom MP4')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('manual Resume applies the bounded status timeout and clears stale transfer state', async () => {
  const intent = {
    uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4,
    state: 'initiated', canResume: true, canFinalize: false,
  };
  let uploadCreated = false;
  let statusStarted = false;
  uploadBrowserDirectGraphFile.mockImplementation(async ({ onState }) => {
    onState({
      phase: 'paused', reason: 'requested', confirmedBytes: 2,
      inFlightBytes: 2, totalBytes: 4, percent: 50, mbps: null, etaSeconds: null,
    });
    return { complete: false, paused: true, reason: 'requested', nextStart: 2 };
  });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) {
      uploadCreated = true;
      return response({ upload: uploadContract() });
    }
    if (url.endsWith(`/${UPLOAD_ID}/resume`)) {
      statusStarted = true;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      });
    }
    return response({ status: 'ready', materials: [], uploads: uploadCreated ? [intent] : [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['same'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  expect(await screen.findByLabelText('Graph-confirmed upload progress')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
  jest.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await act(async () => {
      for (let step = 0; step < 5; step += 1) await Promise.resolve();
    });
    expect(statusStarted).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(74_999);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Graph-confirmed upload progress')).toBeInTheDocument();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('status check timed out');
    expect(screen.queryByLabelText('Graph-confirmed upload progress')).not.toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

test('unfinished intent resume requires the same local file and Finish saving requires no file', async () => {
  const intents = [
    { uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4, state: 'initiated', canResume: true, canFinalize: false },
    { uploadId: '44444444-4444-4444-8444-444444444444', filename: 'done.mp4', size: 5, state: 'uploaded', canResume: false, canFinalize: true },
  ];
  uploadBrowserDirectGraphFile.mockResolvedValue({ complete: false, paused: true, reason: 'requested' });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.endsWith(`/${UPLOAD_ID}/resume`)) return response({ upload: uploadContract() });
    if (url.includes('/finalize')) return response({ success: true, status: 'ready', materials: [], uploads: [] });
    return response({ success: true, status: 'ready', materials: [], uploads: intents });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Reselect recording.mp4');

  fireEvent.change(screen.getByLabelText('Zoom MP4'), {
    target: { files: [new File(['same'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  await waitFor(() => expect(uploadBrowserDirectGraphFile).toHaveBeenCalled());

  fireEvent.click(screen.getByRole('button', { name: 'Finish saving' }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url.includes('/finalize'))).toBe(true));
  expect(await screen.findByText('Recording saved.')).toBeInTheDocument();
});

test.each(['new upload', 'manual resume'])(
  '%s finalize failures use save guidance rather than status guidance',
  async (entryPoint) => {
    const intent = {
      uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4,
      state: 'initiated', canResume: true, canFinalize: false,
    };
    uploadBrowserDirectGraphFile.mockResolvedValue({ complete: true, nextStart: 4 });
    global.fetch = jest.fn(async (url, options = {}) => {
      if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: uploadContract() });
      if (url.endsWith(`/${UPLOAD_ID}/resume`)) {
        return response({ upload: { ...uploadContract(), complete: true } });
      }
      if (url.includes('/finalize')) return response({ error: 'save unavailable' }, 503);
      return response({
        status: 'ready', materials: [], uploads: entryPoint === 'manual resume' ? [intent] : [],
      });
    });
    render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
    fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
      target: { files: [new File(['same'], 'recording.mp4', { type: 'video/mp4' })] },
    });
    fireEvent.click(screen.getByRole('button', {
      name: entryPoint === 'manual resume' ? 'Resume' : 'Upload recording',
    }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('recording save service is temporarily unavailable');
    expect(alert).not.toHaveTextContent('upload status service');
  },
);

test('Finish saving normalizes a network failure without losing the confirmed file', async () => {
  const intent = {
    uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4,
    state: 'uploaded', canResume: false, canFinalize: true,
  };
  global.fetch = jest.fn(async (url) => {
    if (url.includes('/finalize')) throw new TypeError('Failed to fetch');
    return response({ status: 'ready', materials: [], uploads: [intent] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Finish saving' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('could not be saved because the connection failed');
  expect(alert).toHaveTextContent('Microsoft-confirmed file is retained');
  expect(alert).not.toHaveTextContent('Failed to fetch');
});

test.each([
  [409, 'post_presentation_finalize_in_progress', 'already being saved'],
  [410, 'post_presentation_upload_expired', 'can no longer be saved'],
])('Finish saving preserves governed %s finalize guidance', async (status, code, expected) => {
  const intent = {
    uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4,
    state: 'uploaded', canResume: false, canFinalize: true,
  };
  global.fetch = jest.fn(async (url) => {
    if (url.includes('/finalize')) return response({ error: 'raw server detail', code }, status);
    return response({ status: 'ready', materials: [], uploads: [intent] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Finish saving' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(expected);
  expect(alert).not.toHaveTextContent('raw server detail');
});

test('Finish saving bounds slot-busy retries and preserves the confirmed file', async () => {
  const intent = {
    uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4,
    state: 'uploaded', canResume: false, canFinalize: true,
  };
  let finalizeCalls = 0;
  global.fetch = jest.fn(async (url) => {
    if (url.includes('/finalize')) {
      finalizeCalls += 1;
      return response({ error: 'raw server detail', code: 'post_presentation_slot_busy' }, 409);
    }
    return response({ status: 'ready', materials: [], uploads: [intent] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  const finishButton = await screen.findByRole('button', { name: 'Finish saving' });
  jest.useFakeTimers();
  try {
    fireEvent.click(finishButton);
    await act(async () => {
      await Promise.resolve();
    });
    expect(finalizeCalls).toBe(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(749);
    });
    expect(finalizeCalls).toBe(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(finalizeCalls).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_999);
    });
    expect(finalizeCalls).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    const alert = screen.getByRole('alert');
    expect(finalizeCalls).toBe(3);
    expect(alert).toHaveTextContent('save slot remained busy after bounded retries');
    expect(alert).toHaveTextContent('Microsoft-confirmed file is retained');
    expect(alert).not.toHaveTextContent('raw server detail');
  } finally {
    jest.useRealTimers();
  }
});

test('late request A load cannot overwrite request B state', async () => {
  let resolveA;
  global.fetch = jest.fn((url) => {
    if (url.includes(REQUEST_A)) return new Promise((resolve) => { resolveA = resolve; });
    return Promise.resolve(response({
      status: 'ready', materials: [], uploads: [{
        uploadId: UPLOAD_ID, filename: 'request-b.mp4', size: 4,
        state: 'uploaded', canResume: false, canFinalize: true,
      }],
    }));
  });
  const view = render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  await waitFor(() => expect(typeof resolveA).toBe('function'));
  view.rerender(<PostPresentationMaterialsCard requestId={REQUEST_B} />);
  expect(await screen.findByText('request-b.mp4')).toBeInTheDocument();
  resolveA(response({ status: 'ready', materials: [], uploads: [{
    uploadId: 'old', filename: 'request-a.mp4', size: 4, state: 'uploaded', canFinalize: true,
  }] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText('request-a.mp4')).not.toBeInTheDocument();
  expect(screen.getByText('request-b.mp4')).toBeInTheDocument();
});
