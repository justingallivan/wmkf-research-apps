/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostPresentationMaterialsCard from '../../shared/components/meeting-tracker/PostPresentationMaterialsCard';
import { put } from '@vercel/blob/client';
import {
  fingerprintGraphBrowserUploadFile,
  uploadBrowserDirectGraphFile,
  withGraphBrowserUploadLock,
} from '../../shared/utils/graph-browser-upload';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  Button: ({ children, loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('@vercel/blob/client', () => ({ put: jest.fn() }));
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

test('presentation link supports generate, manual-copy fallback, confirmed reissue, and resets copy state', async () => {
  const oldLink = {
    id: '55555555-5555-4555-8555-555555555555',
    url: 'https://materials.test/external/presentation/old',
    expiresAt: '2026-11-24T12:00:00.000Z',
  };
  const newLink = {
    id: '66666666-6666-4666-8666-666666666666',
    url: 'https://materials.test/external/presentation/new',
    expiresAt: '2026-11-24T12:05:00.000Z',
  };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn(async () => { throw new Error('blocked'); }) },
  });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).endsWith('/presentation-link') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.action === 'ensure') return response({ success: true, link: oldLink });
      expect(body).toEqual({ action: 'reissue', expectedLinkId: oldLink.id });
      return response({ success: true, link: newLink });
    }
    if (String(url).endsWith('/presentation-link')) return response({ success: true, link: null });
    return response({ success: true, status: 'ready', materials: [], uploads: [] });
  });

  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate link' }));
  expect(await screen.findByText(oldLink.url)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(await screen.findByLabelText('Presentation link for manual copy')).toHaveValue(oldLink.url);
  fireEvent.click(screen.getByRole('button', { name: 'Issue new link' }));
  const confirm = screen.getAllByRole('button', { name: 'Issue new link' }).at(-1);
  fireEvent.click(confirm);
  expect(await screen.findByText(newLink.url)).toBeInTheDocument();
  expect(screen.queryByLabelText('Presentation link for manual copy')).not.toBeInTheDocument();
});

test('a background reload that discovers a different link clears stale copy and confirmation UI', async () => {
  const oldLink = {
    id: '55555555-5555-4555-8555-555555555555',
    url: 'https://materials.test/external/presentation/old',
    expiresAt: '2026-11-24T12:00:00.000Z',
  };
  const newLink = {
    id: '66666666-6666-4666-8666-666666666666',
    url: 'https://materials.test/external/presentation/new',
    expiresAt: '2026-11-24T12:05:00.000Z',
  };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn(async () => { throw new Error('blocked'); }) },
  });
  uploadBrowserDirectGraphFile.mockResolvedValue({
    complete: false, paused: true, reason: 'retry_exhausted', nextStart: 0,
  });
  let linkReads = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).endsWith('/presentation-link')) {
      linkReads += 1;
      return response({ success: true, link: linkReads === 1 ? oldLink : newLink });
    }
    if (options.method === 'POST' && String(url).endsWith('/presentation-uploads')) {
      return response({ success: true, upload: uploadContract() });
    }
    return response({ success: true, status: 'ready', materials: [], uploads: [] });
  });

  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  expect(await screen.findByText(oldLink.url)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(await screen.findByLabelText('Presentation link for manual copy')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Issue new link' }));
  expect(screen.getByText('The current presentation link will stop working immediately.')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  expect(await screen.findByText(newLink.url)).toBeInTheDocument();
  expect(screen.queryByLabelText('Presentation link for manual copy')).not.toBeInTheDocument();
  expect(screen.queryByText('The current presentation link will stop working immediately.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy link' })).toHaveTextContent('Copy link');
});

test('a lost reissue race refreshes the winner and removes the revoked link from copy controls', async () => {
  const oldLink = {
    id: '55555555-5555-4555-8555-555555555555',
    url: 'https://materials.test/external/presentation/old',
    expiresAt: '2026-11-24T12:00:00.000Z',
  };
  const winner = {
    id: '66666666-6666-4666-8666-666666666666',
    url: 'https://materials.test/external/presentation/winner',
    expiresAt: '2026-11-24T12:05:00.000Z',
  };
  let linkReads = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).endsWith('/presentation-link') && options.method === 'POST') {
      return response({
        error: 'The presentation link was replaced by another action.',
        code: 'presentation_link_superseded',
      }, 409);
    }
    if (String(url).endsWith('/presentation-link')) {
      linkReads += 1;
      return response({ success: true, link: linkReads === 1 ? oldLink : winner });
    }
    return response({ success: true, status: 'ready', materials: [], uploads: [] });
  });

  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  expect(await screen.findByText(oldLink.url)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Issue new link' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Issue new link' }).at(-1));
  expect(await screen.findByText(winner.url)).toBeInTheDocument();
  expect(screen.queryByText(oldLink.url)).not.toBeInTheDocument();
  expect(screen.queryByText('The current presentation link will stop working immediately.')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('current link has been refreshed');
});

test('a lost reissue race clears the revoked link when the winner refresh fails', async () => {
  const oldLink = {
    id: '55555555-5555-4555-8555-555555555555',
    url: 'https://materials.test/external/presentation/old',
    expiresAt: '2026-11-24T12:00:00.000Z',
  };
  let linkReads = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).endsWith('/presentation-link') && options.method === 'POST') {
      return response({
        error: 'The presentation link was replaced by another action.',
        code: 'presentation_link_superseded',
      }, 409);
    }
    if (String(url).endsWith('/presentation-link')) {
      linkReads += 1;
      return linkReads === 1
        ? response({ success: true, link: oldLink })
        : response({ error: 'The current link could not be loaded.' }, 503);
    }
    return response({ success: true, status: 'ready', materials: [], uploads: [] });
  });

  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  expect(await screen.findByText(oldLink.url)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Issue new link' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Issue new link' }).at(-1));
  expect(await screen.findByRole('alert')).toHaveTextContent('current link could not be loaded');
  expect(screen.queryByText(oldLink.url)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  expect(screen.queryByText(/current link has been refreshed/i)).not.toBeInTheDocument();
});

test('a background link read started before reissue cannot restore the revoked URL', async () => {
  const oldLink = {
    id: '55555555-5555-4555-8555-555555555555',
    url: 'https://materials.test/external/presentation/old',
    expiresAt: '2026-11-24T12:00:00.000Z',
  };
  const winner = {
    id: '66666666-6666-4666-8666-666666666666',
    url: 'https://materials.test/external/presentation/winner',
    expiresAt: '2026-11-24T12:05:00.000Z',
  };
  uploadBrowserDirectGraphFile.mockResolvedValue({
    complete: false, paused: true, reason: 'retry_exhausted', nextStart: 0,
  });
  let linkReads = 0;
  let resolveStaleRead;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).endsWith('/presentation-link') && options.method === 'POST') {
      return response({ success: true, link: winner });
    }
    if (String(url).endsWith('/presentation-link')) {
      linkReads += 1;
      if (linkReads === 1) return response({ success: true, link: oldLink });
      return new Promise((resolve) => {
        resolveStaleRead = () => resolve(response({ success: true, link: oldLink }));
      });
    }
    if (options.method === 'POST' && String(url).endsWith('/presentation-uploads')) {
      return response({ success: true, upload: uploadContract() });
    }
    return response({ success: true, status: 'ready', materials: [], uploads: [] });
  });

  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  expect(await screen.findByText(oldLink.url)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  await waitFor(() => expect(resolveStaleRead).toEqual(expect.any(Function)));

  fireEvent.click(screen.getByRole('button', { name: 'Issue new link' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Issue new link' }).at(-1));
  expect(await screen.findByText(winner.url)).toBeInTheDocument();
  await act(async () => resolveStaleRead());
  expect(screen.getByText(winner.url)).toBeInTheDocument();
  expect(screen.queryByText(oldLink.url)).not.toBeInTheDocument();
});

test('a background link read started during a successful reissue cannot restore the revoked URL', async () => {
  const oldLink = {
    id: '55555555-5555-4555-8555-555555555555',
    url: 'https://materials.test/external/presentation/old',
    expiresAt: '2026-11-24T12:00:00.000Z',
  };
  const winner = {
    id: '66666666-6666-4666-8666-666666666666',
    url: 'https://materials.test/external/presentation/winner',
    expiresAt: '2026-11-24T12:05:00.000Z',
  };
  uploadBrowserDirectGraphFile.mockResolvedValue({
    complete: false, paused: true, reason: 'retry_exhausted', nextStart: 0,
  });
  let linkReads = 0;
  let resolveMutation;
  let resolveStaleRead;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).endsWith('/presentation-link') && options.method === 'POST') {
      return new Promise((resolve) => {
        resolveMutation = () => resolve(response({ success: true, link: winner }));
      });
    }
    if (String(url).endsWith('/presentation-link')) {
      linkReads += 1;
      if (linkReads === 1) return response({ success: true, link: oldLink });
      return new Promise((resolve) => {
        resolveStaleRead = () => resolve(response({ success: true, link: oldLink }));
      });
    }
    if (options.method === 'POST' && String(url).endsWith('/presentation-uploads')) {
      return response({ success: true, upload: uploadContract() });
    }
    return response({ success: true, status: 'ready', materials: [], uploads: [] });
  });

  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  expect(await screen.findByText(oldLink.url)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Issue new link' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Issue new link' }).at(-1));
  await waitFor(() => expect(resolveMutation).toEqual(expect.any(Function)));
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  await waitFor(() => expect(resolveStaleRead).toEqual(expect.any(Function)));

  await act(async () => resolveMutation());
  expect(await screen.findByText(winner.url)).toBeInTheDocument();
  await act(async () => resolveStaleRead());
  expect(screen.getByText(winner.url)).toBeInTheDocument();
  expect(screen.queryByText(oldLink.url)).not.toBeInTheDocument();
});

test('a background link read started during a failed mutation cannot erase the mutation error', async () => {
  const oldLink = {
    id: '55555555-5555-4555-8555-555555555555',
    url: 'https://materials.test/external/presentation/old',
    expiresAt: '2026-11-24T12:00:00.000Z',
  };
  const unrelatedWinner = {
    id: '66666666-6666-4666-8666-666666666666',
    url: 'https://materials.test/external/presentation/unrelated',
    expiresAt: '2026-11-24T12:05:00.000Z',
  };
  uploadBrowserDirectGraphFile.mockResolvedValue({
    complete: false, paused: true, reason: 'retry_exhausted', nextStart: 0,
  });
  let linkReads = 0;
  let rejectMutation;
  let resolveOverlappingRead;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).endsWith('/presentation-link') && options.method === 'POST') {
      return new Promise((resolve) => {
        rejectMutation = () => resolve(response({ error: 'Reissue failed.' }, 500));
      });
    }
    if (String(url).endsWith('/presentation-link')) {
      linkReads += 1;
      if (linkReads === 1) return response({ success: true, link: oldLink });
      return new Promise((resolve) => {
        resolveOverlappingRead = () => resolve(response({ success: true, link: unrelatedWinner }));
      });
    }
    if (options.method === 'POST' && String(url).endsWith('/presentation-uploads')) {
      return response({ success: true, upload: uploadContract() });
    }
    return response({ success: true, status: 'ready', materials: [], uploads: [] });
  });

  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  expect(await screen.findByText(oldLink.url)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Zoom MP4'), {
    target: { files: [new File(['0123456789'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Issue new link' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Issue new link' }).at(-1));
  await waitFor(() => expect(rejectMutation).toEqual(expect.any(Function)));
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  await waitFor(() => expect(resolveOverlappingRead).toEqual(expect.any(Function)));

  await act(async () => rejectMutation());
  expect(await screen.findByRole('alert')).toHaveTextContent('Reissue failed.');
  await act(async () => resolveOverlappingRead());
  expect(screen.getByText(oldLink.url)).toBeInTheDocument();
  expect(screen.queryByText(unrelatedWinner.url)).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Reissue failed.');
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

test('Cancel requires confirmation and removes only the unfinished row after server success', async () => {
  let cancelled = false;
  const intent = {
    uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4,
    state: 'initiated', canResume: true, canCancel: true, canFinalize: false,
  };
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.endsWith(`/${UPLOAD_ID}/cancel`) && options.method === 'POST') {
      cancelled = true;
      return response({ success: true, uploadId: UPLOAD_ID, cancelled: true });
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: cancelled ? [] : [intent] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(screen.getByText(/Unsaved progress will be lost/)).toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([url]) => url.endsWith(`/${UPLOAD_ID}/cancel`))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Keep upload' }));
  expect(screen.queryByRole('button', { name: 'Cancel upload' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }));
  expect(await screen.findByText('Unfinished upload cancelled.')).toBeInTheDocument();
  expect(screen.queryByText('recording.mp4')).not.toBeInTheDocument();
  expect(uploadBrowserDirectGraphFile).not.toHaveBeenCalled();
});

test('Retry requires the same selected file and explains that new progress starts at zero', async () => {
  const intent = {
    uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4,
    state: 'failed', canResume: false, canRetry: true, canCancel: true, canFinalize: false,
  };
  uploadBrowserDirectGraphFile.mockImplementation(async ({ onState }) => {
    onState({ phase: 'uploading', confirmedBytes: 0, inFlightBytes: 0, totalBytes: 4,
      percent: 0, mbps: null, etaSeconds: null });
    return new Promise(() => {});
  });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.endsWith(`/${UPLOAD_ID}/retry`) && options.method === 'POST') {
      return response({ success: true, upload: { ...uploadContract(), restarted: true } });
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: [intent] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry upload' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Reselect recording.mp4');
  expect(global.fetch.mock.calls.some(([url]) => url.endsWith(`/${UPLOAD_ID}/retry`))).toBe(false);
  fireEvent.change(screen.getByLabelText('Zoom MP4'), {
    target: { files: [new File(['test'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
  expect(await screen.findByText('A fresh Microsoft upload session is starting from zero.')).toBeInTheDocument();
  expect(screen.getByText(/Graph-confirmed: 0 bytes of 4 bytes/)).toBeInTheDocument();
  expect(uploadBrowserDirectGraphFile).toHaveBeenCalledWith(expect.objectContaining({
    start: 0, uploadUrl: 'https://upload.example/session',
  }));
  const [, options] = global.fetch.mock.calls.find(([url]) => url.endsWith(`/${UPLOAD_ID}/retry`));
  expect(JSON.parse(options.body)).toEqual({ resumeFingerprint: 'a'.repeat(64) });
});

test('Cancel stops an active local transfer before calling the server', async () => {
  let cancelled = false;
  let uploadSignal;
  uploadBrowserDirectGraphFile.mockImplementation(async ({ signal, onState }) => {
    uploadSignal = signal;
    onState({ phase: 'uploading', confirmedBytes: 0, inFlightBytes: 1, totalBytes: 4,
      percent: 0, mbps: null, etaSeconds: null });
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('stopped');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  });
  const intent = {
    uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4,
    state: 'initiated', canResume: true, canCancel: true,
  };
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.endsWith('/presentation-uploads') && options.method === 'POST') {
      return response({ success: true, upload: uploadContract() });
    }
    if (url.endsWith(`/${UPLOAD_ID}/cancel`)) {
      expect(uploadSignal.aborted).toBe(true);
      cancelled = true;
      return response({ success: true, cancelled: true });
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: cancelled ? [] : [intent] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom MP4'), {
    target: { files: [new File(['test'], 'recording.mp4', { type: 'video/mp4' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload recording' }));
  await waitFor(() => expect(uploadSignal).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }));
  expect(await screen.findByText('Unfinished upload cancelled.')).toBeInTheDocument();
  expect(uploadSignal.aborted).toBe(true);
});

test('Zoom copied message is validated, saved, and shown as the current recording', async () => {
  const zoomUrl = 'https://us02web.zoom.us/rec/share/recording?pwd=embedded';
  let saved = false;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'PATCH' && url.endsWith('/presentation-materials')) {
      expect(JSON.parse(options.body)).toEqual({
        action: 'save_zoom', operationId: UPLOAD_ID,
        zoomText: `Recording: ${zoomUrl}\nPasscode: embedded`,
      });
      saved = true;
      return response({ success: true, materials: [{ artifactId: UPLOAD_ID, artifactType: 100000005, artifactTypeLabel: 'Recording', backing: 'external', externalUrl: zoomUrl }] });
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: saved
      ? [{ artifactId: UPLOAD_ID, artifactType: 100000005, artifactTypeLabel: 'Recording', backing: 'external', externalUrl: zoomUrl }]
      : [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom recording link or copied Zoom message'), {
    target: { value: `Recording: ${zoomUrl}\nPasscode: embedded` },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save Zoom link' }));
  expect(await screen.findByText('Zoom recording link saved.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', zoomUrl);
});

test('Zoom save rejects a separate passcode and reuses its identity after an uncertain response', async () => {
  let attempts = 0;
  const zoomUrl = 'https://us02web.zoom.us/rec/share/recording?pwd=embedded';
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'PATCH' && url.endsWith('/presentation-materials')) {
      attempts += 1;
      if (attempts === 1) throw new Error('Connection lost');
      return response({ success: true, materials: [{ artifactType: 100000005, backing: 'external', externalUrl: zoomUrl }] });
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  const input = await screen.findByLabelText('Zoom recording link or copied Zoom message');
  fireEvent.change(input, { target: { value: 'https://us02web.zoom.us/rec/share/recording\nPasscode: separate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Zoom link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('passcode embedded');
  expect(attempts).toBe(0);
  fireEvent.change(input, { target: { value: zoomUrl } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Zoom link' }));
  expect(await screen.findByText('Connection lost')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save Zoom link' }));
  expect(await screen.findByText('Zoom recording link saved.')).toBeInTheDocument();
  const requests = global.fetch.mock.calls.filter(([url, options]) => options?.method === 'PATCH' && url.endsWith('/presentation-materials'));
  expect(requests).toHaveLength(2);
  expect(JSON.parse(requests[0][1].body).operationId).toBe(JSON.parse(requests[1][1].body).operationId);
});

test('transcript uses private staging and retries finalize without uploading bytes again', async () => {
  let finalizeAttempts = 0;
  put.mockResolvedValue({ pathname: 'portal-staging/transcript/item' });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) {
      expect(JSON.parse(options.body)).toEqual({
        artifactType: 'transcript', filename: 'transcript.vtt', contentType: 'text/vtt', size: 13,
      });
      return response({ success: true, upload: {
        stagingId: UPLOAD_ID, pathname: 'portal-staging/transcript/item',
        clientToken: 'scoped-token', contentType: 'text/vtt', access: 'private',
      } });
    }
    if (options.method === 'POST' && url.endsWith(`/${UPLOAD_ID}/finalize`)) {
      finalizeAttempts += 1;
      if (finalizeAttempts === 1) return response({ error: 'Temporarily unavailable' }, 503);
      return response({ success: true, materials: [] });
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  const file = new File(['WEBVTT\nhello\n'], 'transcript.vtt', { type: '' });
  fireEvent.change(await screen.findByLabelText('Transcript file'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload transcript' }));
  expect(await screen.findByRole('button', { name: 'Finish transcript' })).toBeInTheDocument();
  expect(screen.getByText(/staged file is retained/)).toBeInTheDocument();
  expect(put).toHaveBeenCalledWith('portal-staging/transcript/item', file, expect.objectContaining({
    access: 'private', token: 'scoped-token', contentType: 'text/vtt', abortSignal: expect.any(AbortSignal),
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Finish transcript' }));
  expect(await screen.findByText('Transcript saved.')).toBeInTheDocument();
  expect(put).toHaveBeenCalledTimes(1);
  expect(finalizeAttempts).toBe(2);
});

test('switching Requests during a transcript Blob upload prevents old-request finalize', async () => {
  let finishPut;
  put.mockImplementation(() => new Promise((resolve) => { finishPut = resolve; }));
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) {
      return response({ success: true, upload: {
        stagingId: UPLOAD_ID, pathname: 'portal-staging/transcript/item',
        clientToken: 'scoped-token', contentType: 'text/vtt', access: 'private',
      } });
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  const view = render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Transcript file'), {
    target: { files: [new File(['WEBVTT\n'], 'transcript.vtt', { type: 'text/vtt' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload transcript' }));
  await waitFor(() => expect(finishPut).toBeDefined());
  view.rerender(<PostPresentationMaterialsCard requestId={REQUEST_B} />);
  await act(async () => finishPut({ pathname: 'portal-staging/transcript/item' }));
  expect(global.fetch.mock.calls.some(([url]) => url.endsWith(`/${UPLOAD_ID}/finalize`))).toBe(false);
});

test('a permanently rejected transcript clears staged retry and asks for another file', async () => {
  put.mockResolvedValue({ pathname: 'portal-staging/transcript/item' });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) {
      return response({ success: true, upload: {
        stagingId: UPLOAD_ID, pathname: 'portal-staging/transcript/item',
        clientToken: 'scoped-token', contentType: 'text/vtt', access: 'private',
      } });
    }
    if (options.method === 'POST' && url.endsWith(`/${UPLOAD_ID}/finalize`)) {
      return response({ error: 'scan_infected', code: 'scan_infected' }, 422);
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Transcript file'), {
    target: { files: [new File(['WEBVTT\n'], 'transcript.vtt', { type: 'text/vtt' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload transcript' }));
  expect(await screen.findByText('The transcript failed the malware scan. Choose another file.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload transcript' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Finish transcript' })).not.toBeInTheDocument();
});

test.each([
  [410, 'staging_expired', 'Reselect the file'],
  [404, 'staging_not_found', 'Reselect the file'],
  [409, 'staged_upload_mismatch', 'Reselect the file'],
  [500, 'post_presentation_generation_ambiguous', 'contact support'],
])('unusable transcript stage %s/%s does not offer a futile finalize retry', async (status, code, expected) => {
  put.mockResolvedValue({ pathname: 'portal-staging/transcript/item' });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) {
      return response({ upload: {
        stagingId: UPLOAD_ID, pathname: 'portal-staging/transcript/item',
        clientToken: 'scoped-token', contentType: 'text/vtt', access: 'private',
      } });
    }
    if (url.endsWith(`/${UPLOAD_ID}/finalize`)) return response({ error: code, code }, status);
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Transcript file'), {
    target: { files: [new File(['WEBVTT\n'], 'transcript.vtt', { type: 'text/vtt' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload transcript' }));
  expect(await screen.findByText(new RegExp(expected))).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload transcript' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Finish transcript' })).not.toBeInTheDocument();
});

test('Zoom save reports when a newer MP4 is current', async () => {
  const zoomUrl = 'https://us02web.zoom.us/rec/share/older?pwd=embedded';
  const winner = { artifactId: OTHER_UPLOAD_ID, artifactType: 100000005, artifactTypeLabel: 'Recording', backing: 'sharepoint', filename: 'newer.mp4', webUrl: 'https://example.com/newer' };
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'PATCH') return response({ success: true, materials: [winner] });
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [winner], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom recording link or copied Zoom message'), { target: { value: zoomUrl } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Zoom link' }));
  expect(await screen.findByText(/newer recording is current/)).toBeInTheDocument();
  expect(screen.getByText('Recording · newer.mp4')).toBeInTheDocument();
});

test('a transcript completion error refreshes current materials while retaining the staged retry', async () => {
  let saved = false;
  const transcript = { artifactId: OTHER_UPLOAD_ID, artifactTypeLabel: 'Transcript', backing: 'sharepoint', filename: 'transcript.vtt' };
  put.mockResolvedValue({ pathname: 'portal-staging/transcript/item' });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: {
      stagingId: UPLOAD_ID, pathname: 'portal-staging/transcript/item',
      clientToken: 'scoped-token', contentType: 'text/vtt', access: 'private',
    } });
    if (url.endsWith(`/${UPLOAD_ID}/finalize`)) {
      saved = true;
      return response({ error: 'staging_completion_failed', code: 'staging_completion_failed' }, 503);
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: saved ? [transcript] : [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Transcript file'), {
    target: { files: [new File(['WEBVTT\n'], 'transcript.vtt', { type: 'text/vtt' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload transcript' }));
  expect(await screen.findByText('Transcript · transcript.vtt')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Finish transcript' })).toBeInTheDocument();
  expect(screen.getByText('Selected transcript: transcript.vtt')).toBeInTheDocument();
});

test('an older materials refresh cannot overwrite a newer refresh for the same Request', async () => {
  const intent = { uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4, state: 'uploaded', canFinalize: true };
  const existing = { artifactId: 'existing', artifactTypeLabel: 'Recording', backing: 'sharepoint', filename: 'existing.mp4', webUrl: 'https://example.com/existing' };
  const pendingReads = [];
  let reads = 0;
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith(`/${UPLOAD_ID}/finalize`)) return response({ materials: [] });
    if (url.endsWith('/presentation-link')) return response({ link: null });
    if (url.endsWith('/presentation-materials')) {
      reads += 1;
      if (reads === 1) return response({ status: 'ready', materials: [existing], uploads: [intent] });
      return new Promise((resolve) => pendingReads.push(resolve));
    }
    throw new Error(`Unexpected request ${url}`);
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  const finishButton = await screen.findByRole('button', { name: 'Finish saving' });
  act(() => {
    finishButton.click();
    finishButton.click();
  });
  await waitFor(() => expect(pendingReads).toHaveLength(2));
  expect(screen.getByRole('button', { name: 'Finish saving' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://example.com/existing');
  const newer = { artifactId: OTHER_UPLOAD_ID, artifactTypeLabel: 'Recording', backing: 'sharepoint', filename: 'newer.mp4' };
  await act(async () => pendingReads[1](response({ status: 'ready', materials: [newer], uploads: [] })));
  expect(screen.getByText('Recording · newer.mp4')).toBeInTheDocument();
  await act(async () => pendingReads[0](response({ status: 'ready', materials: [], uploads: [intent] })));
  expect(screen.getByText('Recording · newer.mp4')).toBeInTheDocument();
});

test('switching Requests during transcript finalize aborts the old request and suppresses its result', async () => {
  let finishFinalize;
  let finalizeSignal;
  put.mockResolvedValue({ pathname: 'portal-staging/transcript/item' });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: {
      stagingId: UPLOAD_ID, pathname: 'portal-staging/transcript/item',
      clientToken: 'scoped-token', contentType: 'text/vtt', access: 'private',
    } });
    if (url.endsWith(`/${UPLOAD_ID}/finalize`)) {
      finalizeSignal = options.signal;
      return new Promise((resolve) => { finishFinalize = resolve; });
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  const view = render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Transcript file'), {
    target: { files: [new File(['WEBVTT\n'], 'transcript.vtt', { type: 'text/vtt' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload transcript' }));
  await waitFor(() => expect(finishFinalize).toBeDefined());
  view.rerender(<PostPresentationMaterialsCard requestId={REQUEST_B} />);
  expect(finalizeSignal.aborted).toBe(true);
  await act(async () => finishFinalize(response({ materials: [{ artifactId: UPLOAD_ID }] })));
  expect(screen.queryByText('Transcript saved.')).not.toBeInTheDocument();
});

test('an unconfirmed Zoom response retains the same save identity for retry', async () => {
  const zoomUrl = 'https://us02web.zoom.us/rec/share/recording?pwd=embedded';
  let attempts = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'PATCH') {
      attempts += 1;
      return response(attempts === 1 ? { success: true }
        : { materials: [{ artifactType: 100000005, backing: 'external', externalUrl: zoomUrl }] });
    }
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Zoom recording link or copied Zoom message'), { target: { value: zoomUrl } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Zoom link' }));
  expect(await screen.findByText(/save was not confirmed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save Zoom link' }));
  expect(await screen.findByText('Zoom recording link saved.')).toBeInTheDocument();
  const patches = global.fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH');
  expect(JSON.parse(patches[0][1].body).operationId).toBe(JSON.parse(patches[1][1].body).operationId);
});

test('a temporary staged-file read error keeps Finish transcript available', async () => {
  put.mockResolvedValue({ pathname: 'portal-staging/transcript/item' });
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: {
      stagingId: UPLOAD_ID, pathname: 'portal-staging/transcript/item',
      clientToken: 'scoped-token', contentType: 'text/vtt', access: 'private',
    } });
    if (url.endsWith(`/${UPLOAD_ID}/finalize`)) return response({ error: 'staged_upload_missing', code: 'staged_upload_missing' }, 409);
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Transcript file'), {
    target: { files: [new File(['WEBVTT\n'], 'transcript.vtt', { type: 'text/vtt' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload transcript' }));
  expect(await screen.findByRole('button', { name: 'Finish transcript' })).toBeEnabled();
  expect(screen.getByText(/staged file is retained/)).toBeInTheDocument();
});

test('Open links require HTTPS and no embedded credentials', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [
      { artifactId: 'unsafe', artifactTypeLabel: 'Recording', backing: 'sharepoint', filename: 'unsafe.mp4', webUrl: 'javascript:alert(1)' },
      { artifactId: 'credentials', artifactTypeLabel: 'Transcript', backing: 'sharepoint', filename: 'credentials.vtt', webUrl: 'https://user:pass@example.com/file' },
      { artifactId: 'safe', artifactTypeLabel: 'Transcript', backing: 'sharepoint', filename: 'safe.vtt', webUrl: 'https://example.com/safe' },
    ], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  const links = await screen.findAllByRole('link', { name: 'Open' });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', 'https://example.com/safe');
});

test('transcript replay names the newer current transcript and reconciliation', async () => {
  put.mockResolvedValue({ pathname: 'portal-staging/transcript/item' });
  const winner = { artifactId: OTHER_UPLOAD_ID, artifactType: 100000006, artifactTypeLabel: 'Transcript', backing: 'sharepoint', filename: 'newer.vtt' };
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'POST' && url.endsWith('/presentation-uploads')) return response({ upload: {
      stagingId: UPLOAD_ID, pathname: 'portal-staging/transcript/item',
      clientToken: 'scoped-token', contentType: 'text/vtt', access: 'private',
    } });
    if (url.endsWith(`/${UPLOAD_ID}/finalize`)) return response({ materials: [winner], requestDocumentId: UPLOAD_ID, reconciliationRequired: true });
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [winner], uploads: [] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.change(await screen.findByLabelText('Transcript file'), {
    target: { files: [new File(['WEBVTT\n'], 'transcript.vtt', { type: 'text/vtt' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload transcript' }));
  expect(await screen.findByText(/newer transcript is current/)).toHaveTextContent('needs reconciliation');
});

test('MP4 finalize replay names the newer current recording and reconciliation', async () => {
  const intent = { uploadId: UPLOAD_ID, filename: 'recording.mp4', size: 4, state: 'uploaded', canFinalize: true };
  const winner = { artifactId: OTHER_UPLOAD_ID, artifactType: 100000005, artifactTypeLabel: 'Recording', backing: 'sharepoint', filename: 'newer.mp4' };
  global.fetch = jest.fn(async (url) => {
    if (url.endsWith(`/${UPLOAD_ID}/finalize`)) return response({ materials: [winner], requestDocumentId: UPLOAD_ID, reconciliationRequired: true });
    if (url.endsWith('/presentation-link')) return response({ link: null });
    return response({ status: 'ready', materials: [winner], uploads: [intent] });
  });
  render(<PostPresentationMaterialsCard requestId={REQUEST_A} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Finish saving' }));
  expect(await screen.findByText(/newer recording is current/)).toHaveTextContent('needs reconciliation');
});
