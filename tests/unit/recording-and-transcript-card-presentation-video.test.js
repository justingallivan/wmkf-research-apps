/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RecordingAndTranscriptCard from '../../shared/components/meeting-tracker/RecordingAndTranscriptCard';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../shared/config/requestDocument';

jest.mock('@vercel/blob/client', () => ({ put: jest.fn() }));

// Stage 4 slice 5: the Video line under Presentation in step 3.
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '33333333-3333-4333-8333-333333333333';
const VISIT_ID = '55555555-5555-4555-8555-555555555555';
const SPLIT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OLD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const split = (over = {}) => ({ id: SPLIT_ID, state: 'review', failureCode: null, createdAt: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:05:00Z', completedAt: null, approvedAt: null, ...over });
const collection = () => ({
  featureState: 'enabled', siteVisitActivityId: VISIT_ID, candidateSources: {}, candidates: [], jobs: [], publications: [], correctionDrafts: [],
  currentArtifact: { id: ARTIFACT_ID, fingerprint: 'e'.repeat(64), bundleEditable: true,
    presentationEnd: { endMs: 62900, confirmedBy: 42, confirmedAt: '2026-10-04T23:30:00.000Z' },
    presentationTranscript: { state: 'bound', artifactId: ARTIFACT_ID }, staffDiscussionTranscript: { state: 'bound', artifactId: ARTIFACT_ID } },
});
const transcriptRow = () => ({ artifactId: ARTIFACT_ID, artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, artifactTypeLabel: 'Transcript',
  backing: 'file', filename: 'transcript.txt', createdAt: '2026-10-04T22:24:00.000Z', slotVersion: 3, webUrl: 'https://example.sharepoint.com/transcript.txt' });

let state;
function route(handlers = {}) {
  state = { splits: { available: true, splits: [] }, posts: [], ...handlers.state };
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    const method = options.method || 'GET';
    if (path.includes('kind=discussion')) return response({ kind: 'discussion', draft: null, draftMatchesTranscript: false, lastFailure: null, transcriptSummary: { state: 'missing', artifactId: null, publishedAt: null }, discussionNotRecorded: false });
    if (path.endsWith('/presentation-video-splits')) {
      if (method === 'POST') { const body = JSON.parse(options.body); state.posts.push(body); return handlers.post ? handlers.post(body) : response({}, 202); }
      return typeof state.splits === 'function' ? state.splits() : response(state.splits);
    }
    if (path.endsWith('/presentation-link')) return response({ link: null });
    if (path.endsWith('/presentation-materials')) return response({ materials: [transcriptRow()], uploads: [] });
    if (path.endsWith('/transcriptions')) return response(collection());
    return response({});
  });
}
const getCount = () => global.fetch.mock.calls.filter(([url, o]) => String(url).endsWith('/presentation-video-splits') && (o?.method || 'GET') === 'GET').length;
async function renderLine(props = {}) {
  const view = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} {...props} />);
  await screen.findByText(/Presentation ends at/);
  return view;
}
const line = () => screen.findByTestId('presentation-video-line');

afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('Video line', () => {
  test.each([['available:false', { available: false, splits: [] }], ['empty body', {}], ['no splits array', { available: true }]])('hidden when %s', async (_l, body) => {
    route({ state: { splits: body } });
    await renderLine();
    await waitFor(() => expect(getCount()).toBeGreaterThan(0));
    expect(screen.queryByTestId('presentation-video-line')).not.toBeInTheDocument();
  });

  test('none: Not made yet with a Create button', async () => {
    route();
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Not made yet');
    expect(within(el).getByRole('button', { name: 'Create presentation video' })).toBeEnabled();
  });

  test.each(['queued', 'cutting', 'uploading'])('%s shows Working and no create button', async (s) => {
    route({ state: { splits: { available: true, splits: [split({ state: s })] } } });
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Working…');
    expect(within(el).queryByRole('button')).not.toBeInTheDocument();
  });

  test('review: the name opens the video, approve is inline and re-create is in the menu', async () => {
    route({ state: { splits: { available: true, splits: [split()] } } });
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Ready to check');
    const open = within(el).getByRole('link', { name: 'Presentation video' });
    expect(open).toHaveAttribute('href', `/api/meeting-tracker/visits/${REQUEST_ID}/presentation-video-splits/${SPLIT_ID}/open`);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(el).getByRole('button', { name: 'Check the ending and approve' })).toBeInTheDocument();
    expect(within(el).queryByRole('button', { name: 'Create presentation video' })).not.toBeInTheDocument();
    // Staff can replace a video that is waiting for its check (e.g. after fixing the presentation end), behind a confirm.
    fireEvent.click(within(el).getByRole('button', { name: 'More actions for presentation video' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create it again' }));
    expect(within(el).getByRole('alertdialog')).toHaveTextContent('This discards the video waiting for your check and makes a new one.');
  });

  test('registering shows Approving', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'registering' })] } } });
    await renderLine();
    expect(await line()).toHaveTextContent('Approving…');
  });

  test('approved: the name opens it and re-create sits in the menu behind a confirm that posts start', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'approved', boardReady: true }), split({ id: OLD_ID, state: 'superseded', createdAt: '2026-10-01T10:00:00Z' })] } } });
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Approved');
    expect(within(el).getByRole('link', { name: 'Presentation video' })).toBeInTheDocument();
    expect(within(el).queryByRole('button', { name: 'Create presentation video' })).not.toBeInTheDocument();
    fireEvent.click(within(el).getByRole('button', { name: 'More actions for presentation video' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create presentation video' }));
    expect(state.posts).toHaveLength(0);
    expect(within(el).getByText('This replaces the approved video once the new one is approved.')).toBeInTheDocument();
    fireEvent.click(within(el).getByRole('button', { name: 'Create again' }));
    await waitFor(() => expect(state.posts).toEqual([{ action: 'start' }]));
  });

  test('superseded: Out of date with the reason and a create button', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'superseded', failureCode: 'presentation_video_approval_stale' })] } } });
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Out of date');
    expect(el).toHaveTextContent('The transcript or video changed. Create it again.');
    expect(within(el).getByRole('button', { name: 'Create presentation video' })).toBeInTheDocument();
  });

  test.each([
    ['unsupported_timeline', /timing can’t be cut safely/],
    ['upload_failed', /could not be saved/],
    ['some_future_code', /Something went wrong\. Try again\./],
  ])('failed %s maps to plain copy without the code', async (code, copy) => {
    route({ state: { splits: { available: true, splits: [split({ state: 'failed', failureCode: code })] } } });
    const { container } = await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Failed');
    expect(el).toHaveTextContent(copy);
    expect(container.textContent).not.toContain(code);
    expect(within(el).getByRole('button', { name: 'Create presentation video' })).toBeInTheDocument();
  });

  test('never renders the split id or a raw code', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'failed', failureCode: 'presentation_video_cut_crashed' })] } } });
    const { container } = await renderLine();
    await line();
    expect(container.textContent).not.toContain(SPLIT_ID);
    expect(container.textContent).not.toMatch(/presentation_video_/);
    expect(within(screen.getByTestId('presentation-video-line')).queryByText(GUID)).toBeNull();
  });
});

describe('actions', () => {
  test('create posts start and shows the server refusal inline', async () => {
    route({ post: () => response({ error: 'Confirm the end of the presentation in the transcript first.', code: 'presentation_video_boundary_required' }, 422) });
    await renderLine();
    const el = await line();
    fireEvent.click(within(el).getByRole('button', { name: 'Create presentation video' }));
    expect(await within(el).findByText('Confirm the end of the presentation in the transcript first.')).toBeInTheDocument();
    expect(state.posts).toEqual([{ action: 'start' }]);
    expect(el.textContent).not.toMatch(/presentation_video_/);
  });

  test('create is disabled while the request is in flight', async () => {
    let release;
    route({ post: () => new Promise((resolve) => { release = () => resolve(response({}, 202)); }) });
    await renderLine();
    const el = await line();
    fireEvent.click(within(el).getByRole('button', { name: 'Create presentation video' }));
    await waitFor(() => expect(within(el).getByRole('button', { name: 'Working…' })).toBeDisabled());
    await act(async () => { release(); });
  });

  test('approve posts after the confirm and refreshes', async () => {
    route({ state: { splits: { available: true, splits: [split()] } } });
    await renderLine();
    const el = await line();
    fireEvent.click(within(el).getByRole('button', { name: 'Check the ending and approve' }));
    expect(within(el).getByText('Approve this video for the Board? Board members will be able to watch it.')).toBeInTheDocument();
    expect(state.posts).toHaveLength(0);
    state.splits = { available: true, splits: [split({ state: 'approved', boardReady: true })] };
    fireEvent.click(within(el).getByRole('button', { name: 'Approve video' }));
    await waitFor(() => expect(state.posts).toEqual([{ action: 'approve', splitId: SPLIT_ID }]));
    await waitFor(() => expect(el).toHaveTextContent('Approved'));
  });

  test('declining the confirm sends nothing', async () => {
    route({ state: { splits: { available: true, splits: [split()] } } });
    await renderLine();
    const el = await line();
    fireEvent.click(within(el).getByRole('button', { name: 'Check the ending and approve' }));
    fireEvent.click(within(el).getByRole('button', { name: 'Not yet' }));
    expect(state.posts).toHaveLength(0);
    expect(within(el).queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('a stale approval shows the copy and refreshes', async () => {
    route({ state: { splits: { available: true, splits: [split()] } },
      post: () => response({ error: 'The transcript, presentation end or recording changed after this video was cut. Create the video again.', code: 'presentation_video_approval_stale' }, 409) });
    await renderLine();
    const el = await line();
    const before = getCount();
    state.splits = { available: true, splits: [split({ state: 'superseded', failureCode: 'presentation_video_approval_stale' })] };
    fireEvent.click(within(el).getByRole('button', { name: 'Check the ending and approve' }));
    fireEvent.click(within(el).getByRole('button', { name: 'Approve video' }));
    await waitFor(() => expect(el).toHaveTextContent('Out of date'));
    expect(within(el).getAllByText('The transcript or video changed. Create it again.').length).toBeGreaterThan(0);
    expect(getCount()).toBeGreaterThan(before);
  });
});

describe('polling', () => {
  const advance = (ms) => act(async () => { jest.advanceTimersByTime(ms); });
  test('polls every 15 s while working and stops once the state is terminal', async () => {
    jest.useFakeTimers();
    route({ state: { splits: { available: true, splits: [split({ state: 'cutting' })] } } });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    await advance(0);
    await screen.findByText(/Presentation ends at/);
    const el = await line();
    const start = getCount();
    await advance(14_000);
    expect(getCount()).toBe(start);
    state.splits = { available: true, splits: [split({ state: 'review' })] };
    await advance(1_500);
    expect(getCount()).toBe(start + 1);
    await waitFor(() => expect(el).toHaveTextContent('Ready to check'));
    await advance(60_000);
    expect(getCount()).toBe(start + 1);
  });

  test('does not poll when nothing is processing, and stops on unmount', async () => {
    jest.useFakeTimers();
    route({ state: { splits: { available: true, splits: [split({ state: 'registering' })] } } });
    const view = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    await advance(0);
    await screen.findByText(/Presentation ends at/);
    await line();
    const before = getCount();
    view.unmount();
    await advance(60_000);
    expect(getCount()).toBe(before);
  });
});

describe('registering recovery and failed refreshes', () => {
  test('registering offers Finish approving, which posts approve and ends Approved', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'registering' })] } } });
    await renderLine();
    const el = await line();
    state.splits = { available: true, splits: [split({ state: 'approved', boardReady: true })] };
    fireEvent.click(within(el).getByRole('button', { name: 'Finish approving' }));
    await waitFor(() => expect(state.posts).toEqual([{ action: 'approve', splitId: SPLIT_ID }]));
    await waitFor(() => expect(el).toHaveTextContent('Approved'));
  });

  test('a live claim (409 in progress) shows the wait message and keeps Approving', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'registering' })] } },
      post: () => response({ error: 'x', code: 'presentation_video_approval_in_progress' }, 409) });
    const { container } = await renderLine();
    const el = await line();
    fireEvent.click(within(el).getByRole('button', { name: 'Finish approving' }));
    expect(await within(el).findByText('Approval is still in progress. Try again in a few minutes.')).toBeInTheDocument();
    expect(el).toHaveTextContent('Approving…');
    expect(container.textContent).not.toMatch(/presentation_video_/);
  });

  test('a started cut stays Working and polling recovers after the refresh fails', async () => {
    jest.useFakeTimers();
    route({ post: () => response({ split: { id: SPLIT_ID, state: 'queued' } }, 202) });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    const advance = (ms) => act(async () => { jest.advanceTimersByTime(ms); });
    await advance(0);
    await screen.findByText(/Presentation ends at/);
    const el = await line();
    state.splits = () => { throw new Error('network down'); };
    fireEvent.click(within(el).getByRole('button', { name: 'Create presentation video' }));
    await waitFor(() => expect(el).toHaveTextContent('Couldn’t refresh the video status. Retrying…'));
    expect(el).toHaveTextContent('Working…');
    expect(within(el).queryByRole('button', { name: 'Create presentation video' })).not.toBeInTheDocument();
    const before = getCount();
    await advance(15_500);
    expect(getCount()).toBe(before + 1);
    state.splits = { available: true, splits: [split({ state: 'review' })] };
    await advance(15_500);
    await waitFor(() => expect(el).toHaveTextContent('Ready to check'));
    expect(el).not.toHaveTextContent('Retrying');
    expect(el.textContent).not.toContain(SPLIT_ID);
  });

  test('an initial load failure shows a Retry instead of hiding the line', async () => {
    route({ state: { splits: () => { throw new Error('network down'); } } });
    const { container } = await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Couldn’t load the video status.');
    state.splits = { available: true, splits: [] };
    fireEvent.click(within(el).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(el).toHaveTextContent('Not made yet'));
    expect(container.textContent).not.toMatch(/presentation_video_|network down/);
  });
});

describe('Board readiness of an approved video', () => {
  test('boardReady false shows Out of date with Create and no Open', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'approved', boardReady: false })] } } });
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Out of date');
    expect(el).toHaveTextContent('The transcript or video changed. Create it again.');
    expect(el).not.toHaveTextContent('Approved');
    expect(within(el).queryByRole('link', { name: 'Presentation video' })).not.toBeInTheDocument();
    fireEvent.click(within(el).getByRole('button', { name: 'Create presentation video' }));
    await waitFor(() => expect(state.posts).toEqual([{ action: 'start' }]));
  });

  test('boardReady true shows Approved with no Board-status note', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'approved', boardReady: true })] } } });
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Approved');
    expect(el).not.toHaveTextContent('Couldn’t check the Board status.');
  });

  test('boardReady unknown shows Approved with a small note', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'approved', boardReady: null })] } } });
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Approved');
    expect(el).toHaveTextContent('Couldn’t check the Board status.');
  });

  test('approve, then a later load after a boundary change shows Out of date', async () => {
    route({ state: { splits: { available: true, splits: [split()] } } });
    await renderLine();
    const el = await line();
    state.splits = { available: true, splits: [split({ state: 'approved', boardReady: true })] };
    fireEvent.click(within(el).getByRole('button', { name: 'Check the ending and approve' }));
    fireEvent.click(within(el).getByRole('button', { name: 'Approve video' }));
    await waitFor(() => expect(el).toHaveTextContent('Approved'));
    state.splits = { available: true, splits: [split({ state: 'approved', boardReady: false })] };
    // Mounting again (as a reload does) reads the Board status afresh.
    const again = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    await waitFor(() => expect(within(again.container).getByTestId('presentation-video-line')).toHaveTextContent('Out of date'));
  });
});

describe('an open confirmation is bound to the video it was opened for (Codex whole-branch review)', () => {
  test('a Refresh that brings in a different video closes the approval and never approves it', async () => {
    route({ state: { splits: { available: true, splits: [split()] } } });
    await renderLine();
    const el = await line();
    fireEvent.click(within(el).getByRole('button', { name: 'Check the ending and approve' }));
    expect(within(el).getByRole('alertdialog', { name: 'Approve the presentation video' })).toBeInTheDocument();
    // Another session replaced the video: B is now the newest one waiting for its check.
    state.splits = { available: true, splits: [split({ id: OLD_ID, createdAt: '2026-10-11T10:00:00Z' }), split()] };
    fireEvent.click(screen.getByTestId('card-refresh'));
    await waitFor(() => expect(within(el).queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(state.posts).toHaveLength(0);
    // Approving B needs its own confirmation, and it names B.
    fireEvent.click(within(el).getByRole('button', { name: 'Check the ending and approve' }));
    fireEvent.click(within(el).getByRole('button', { name: 'Approve video' }));
    await waitFor(() => expect(state.posts).toEqual([{ action: 'approve', splitId: OLD_ID }]));
  });
});

describe('Board materials readiness list', () => {
  const readiness = () => screen.findByTestId('board-readiness-video');
  const older = (over = {}) => split({ id: OLD_ID, state: 'approved', boardReady: true, createdAt: '2026-10-09T10:00:00Z', ...over });
  test.each([
    ['approved and served', [split({ state: 'approved', boardReady: true })], 'bound', 'On the Board page'],
    ['approved but out of date', [split({ state: 'approved', boardReady: false })], 'stale', 'Not yet'],
    ['approved with an unknown Board status', [split({ state: 'approved', boardReady: null })], 'unknown', 'Status unknown'],
    ['waiting for its check, with none approved', [split({ state: 'review' })], undefined, 'Not yet'],
    // An older approved video stays on the Board while a newer one is made (Codex round 2, four-card commit).
    ['being made again while the older one is served', [split({ state: 'queued' }), older()], 'bound', 'On the Board page'],
    ['made again and waiting for its check while the older one is served', [split({ state: 'review' }), older()], 'bound', 'On the Board page'],
    ['made again and failed while the older one is served', [split({ state: 'failed', failureCode: 'upload_failed' }), older()], 'bound', 'On the Board page'],
  ])('a video %s reads from the same load as its row', async (_l, splits, board, label) => {
    route({ state: { splits: { available: true, splits, ...(board ? { boardVideo: { status: board } } : {}) } } });
    await renderLine();
    await line();
    expect(await readiness()).toHaveTextContent(label);
    // Status only: the video's actions stay in the Presentation card.
    expect(within(screen.getByTestId('card-board-materials')).queryAllByRole('button').map((b) => b.textContent).join(' ')).not.toMatch(/approve|create/i);
    expect(getCount()).toBe(1);
  });

  test('the video line is left out when the feature is off for the request', async () => {
    route({ state: { splits: { available: false, splits: [] } } });
    await renderLine();
    await waitFor(() => expect(getCount()).toBeGreaterThan(0));
    expect(screen.getByTestId('board-readiness-transcript')).toBeInTheDocument();
    expect(screen.queryByTestId('board-readiness-video')).not.toBeInTheDocument();
  });

  test('approving the video in the Presentation card turns its Board line on', async () => {
    let approved = false;
    route({
      state: { splits: () => response({ available: true, splits: [split(approved ? { state: 'approved', boardReady: true } : {})], ...(approved ? { boardVideo: { status: 'bound' } } : {}) }) },
      post: () => { approved = true; return response({ split: { id: SPLIT_ID, state: 'approved' } }); },
    });
    await renderLine();
    expect(await readiness()).toHaveTextContent('Not yet');
    fireEvent.click(within(await line()).getByRole('button', { name: 'Check the ending and approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve video' }));
    await waitFor(() => expect(screen.getByTestId('board-readiness-video')).toHaveTextContent('On the Board page'));
  });
});

describe('Board readiness of the video follows the transcript revision (Codex review, four-card commit)', () => {
  test('a changed presentation end whose video re-read fails shows Status unknown, not the old On', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'approved', boardReady: true })], boardVideo: { status: 'bound' } } } });
    const base = global.fetch;
    let endMs = 62900;
    let failSplits = false;
    global.fetch = jest.fn(async (url, options = {}) => {
      const path = String(url);
      if (path.endsWith('/transcriptions')) {
        const body = collection();
        body.currentArtifact.presentationEnd.endMs = endMs;
        return response(body);
      }
      if (failSplits && path.endsWith('/presentation-video-splits') && (options.method || 'GET') === 'GET') return response({ error: 'down' }, 500);
      return base(url, options);
    });
    await renderLine();
    await waitFor(() => expect(screen.getByTestId('board-readiness-video')).toHaveTextContent('On the Board page'));
    endMs = 70000;
    failSplits = true;
    fireEvent.click(screen.getByTestId('card-refresh'));
    await waitFor(() => expect(screen.getByTestId('board-readiness-video')).toHaveTextContent('Status unknown'));
    expect(screen.getByTestId('board-readiness-video')).not.toHaveTextContent('On the Board page');
  });
});

describe('Board readiness when the approved video is outside the recent splits (Codex round 3, four-card commit)', () => {
  test('no Board status in the response but a Presentation video record exists: Status unknown, never Not yet', async () => {
    const failed = Array.from({ length: 10 }, (_v, i) => split({ id: `eeeeeeee-eeee-4eee-8eee-${String(i).padStart(12, '0')}`, state: 'failed', failureCode: 'upload_failed' }));
    route({ state: { splits: { available: true, splits: failed } } });
    const base = global.fetch;
    global.fetch = jest.fn(async (url, options = {}) => {
      if (String(url).endsWith('/presentation-materials')) {
        return response({ materials: [transcriptRow(), { artifactId: OLD_ID, artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_VIDEO, backing: 'file', filename: 'presentation.mp4' }], uploads: [] });
      }
      return base(url, options);
    });
    await renderLine();
    await waitFor(() => expect(screen.getByTestId('board-readiness-video')).toHaveTextContent('Status unknown'));
  });
});

describe('an absent Board status proves no video only when the split list is the whole history (Codex round 4)', () => {
  const failedSplits = (n) => Array.from({ length: n }, (_v, i) => split({ id: `ffffffff-ffff-4fff-8fff-${String(i).padStart(12, '0')}`, state: 'failed', failureCode: 'upload_failed' }));
  test.each([
    ['ten attempts (a full list) and materials without a video record', 10, 'Status unknown'],
    ['nine attempts (the whole history) and no video record', 9, 'Not yet'],
  ])('%s', async (_l, n, label) => {
    route({ state: { splits: { available: true, splits: failedSplits(n) } } });
    await renderLine();
    await waitFor(() => expect(screen.getByTestId('board-readiness-video')).toHaveTextContent(label));
  });
});

describe('Board readiness of the video follows the recording too (Codex round 5, four-card commit)', () => {
  test('replacing the recording re-reads the video status; a failed re-read is Status unknown, not the old On', async () => {
    const RECORDING_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const RECORDING_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const zoomUrl = 'https://zoom.us/rec/share/new-recording';
    const recordingRow = (id) => ({ artifactId: id, artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, backing: 'external',
      externalUrl: id === RECORDING_A ? 'https://zoom.us/rec/share/old-recording' : zoomUrl, slotVersion: 1, createdAt: '2026-10-09T10:00:00Z' });
    if (!globalThis.crypto) globalThis.crypto = {};
    if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = () => '99999999-9999-4999-8999-999999999999';
    let recording = RECORDING_A;
    let failSplits = false;
    route({ state: { splits: { available: true, splits: [split({ state: 'approved', boardReady: true })], boardVideo: { status: 'bound' } } } });
    const base = global.fetch;
    global.fetch = jest.fn(async (url, options = {}) => {
      const path = String(url);
      const method = options.method || 'GET';
      if (path.endsWith('/presentation-materials')) {
        if (method === 'PATCH') {
          recording = RECORDING_B;
          return response({ materials: [transcriptRow(), recordingRow(RECORDING_B)], uploads: [] });
        }
        return response({ materials: [transcriptRow(), recordingRow(recording)], uploads: [] });
      }
      if (failSplits && path.endsWith('/presentation-video-splits') && method === 'GET') return response({ error: 'down' }, 500);
      return base(url, options);
    });
    await renderLine();
    await waitFor(() => expect(screen.getByTestId('board-readiness-video')).toHaveTextContent('On the Board page'));
    const reads = getCount();
    failSplits = true;
    fireEvent.click(within(screen.getByTestId('step-recording')).getByRole('button', { name: 'More actions for get the recording' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Replace recording or transcript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace recording' }));
    fireEvent.change(screen.getByLabelText(/^Zoom link/), { target: { value: zoomUrl } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Zoom link' }));
    expect(await screen.findByText('Zoom recording link saved.')).toBeInTheDocument();
    await waitFor(() => expect(getCount()).toBeGreaterThan(reads));
    await waitFor(() => expect(screen.getByTestId('board-readiness-video')).toHaveTextContent('Status unknown'));
  });
});

describe('the page header status report matches the Board materials list (redesign §10 header chip)', () => {
  const LABEL_KEY = { 'On the Board page': 'on', 'Not yet': 'not_yet', 'Status unknown': 'unknown' };
  const shownKeys = () => ['board-readiness-transcript', 'board-readiness-summary', 'board-readiness-video']
    .map((id) => screen.queryByTestId(id)).filter(Boolean)
    .map((row) => Object.entries(LABEL_KEY).find(([label]) => row.textContent.includes(label))?.[1]);
  test.each([
    ['served', { status: 'bound' }, [split({ state: 'approved', boardReady: true })]],
    ['out of date', { status: 'stale' }, [split({ state: 'approved', boardReady: false })]],
    ['unknown', { status: 'unknown' }, [split({ state: 'approved', boardReady: null })]],
  ])('with the video %s, the reported lines are the shown lines', async (_l, boardVideo, splits) => {
    route({ state: { splits: { available: true, splits, boardVideo } } });
    const onStatusChange = jest.fn();
    await renderLine({ onStatusChange });
    await readinessVideo();
    await waitFor(() => expect(onStatusChange.mock.calls.at(-1)[0].board).toEqual(shownKeys()));
    expect(onStatusChange.mock.calls.at(-1)[0]).toMatchObject({ available: true, hasTranscript: true });
    expect(shownKeys()).toHaveLength(3);
  });

  test('with the video feature off, only the two shown lines are reported', async () => {
    route({ state: { splits: { available: false, splits: [] } } });
    const onStatusChange = jest.fn();
    await renderLine({ onStatusChange });
    await waitFor(() => expect(getCount()).toBeGreaterThan(0));
    await waitFor(() => expect(onStatusChange.mock.calls.at(-1)[0].board).toEqual(shownKeys()));
    expect(shownKeys()).toHaveLength(2);
  });

  test('before the first video read settles, the report says pending so the chip waits', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    route({ state: { splits: async () => { await gate; return response({ available: true, splits: [split({ state: 'approved', boardReady: true })], boardVideo: { status: 'bound' } }); } } });
    const onStatusChange = jest.fn();
    await renderLine({ onStatusChange });
    await waitFor(() => expect(onStatusChange).toHaveBeenCalled());
    expect(onStatusChange.mock.calls.at(-1)[0].board).toContain('pending');
    release();
    await waitFor(() => expect(onStatusChange.mock.calls.at(-1)[0].board).not.toContain('pending'));
  });
});
const readinessVideo = () => screen.findByTestId('board-readiness-video');
