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
async function renderLine() {
  const view = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
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

  test('none: Not started with a Create button', async () => {
    route();
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Not started');
    expect(within(el).getByRole('button', { name: 'Create presentation video' })).toBeEnabled();
  });

  test.each(['queued', 'cutting', 'uploading'])('%s shows Working and no create button', async (s) => {
    route({ state: { splits: { available: true, splits: [split({ state: s })] } } });
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Working…');
    expect(within(el).queryByRole('button')).not.toBeInTheDocument();
  });

  test('review: Open link and approve button', async () => {
    route({ state: { splits: { available: true, splits: [split()] } } });
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Ready to check');
    const open = within(el).getByRole('link', { name: 'Open video' });
    expect(open).toHaveAttribute('href', `/api/meeting-tracker/visits/${REQUEST_ID}/presentation-video-splits/${SPLIT_ID}/open`);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noreferrer');
    expect(within(el).getByRole('button', { name: 'Check the ending and approve' })).toBeInTheDocument();
    expect(within(el).queryByRole('button', { name: 'Create presentation video' })).not.toBeInTheDocument();
  });

  test('registering shows Approving', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'registering' })] } } });
    await renderLine();
    expect(await line()).toHaveTextContent('Approving…');
  });

  test('approved: Open plus re-create behind a confirm that posts start', async () => {
    route({ state: { splits: { available: true, splits: [split({ state: 'approved' }), split({ id: OLD_ID, state: 'superseded', createdAt: '2026-10-01T10:00:00Z' })] } } });
    await renderLine();
    const el = await line();
    expect(el).toHaveTextContent('Approved for the Board');
    expect(within(el).getByRole('link', { name: 'Open video' })).toBeInTheDocument();
    fireEvent.click(within(el).getByRole('button', { name: 'Create presentation video' }));
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
    state.splits = { available: true, splits: [split({ state: 'approved' })] };
    fireEvent.click(within(el).getByRole('button', { name: 'Approve video' }));
    await waitFor(() => expect(state.posts).toEqual([{ action: 'approve', splitId: SPLIT_ID }]));
    await waitFor(() => expect(el).toHaveTextContent('Approved for the Board'));
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
