/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RecordingAndTranscriptCard from '../../shared/components/meeting-tracker/RecordingAndTranscriptCard';

jest.mock('@vercel/blob/client', () => ({ put: jest.fn() }));

// Stage 3b S7: Zoom video copy on the card (picker, replace confirmation, Recording block progress, polling).
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_ID = '55555555-5555-4555-8555-555555555555';
const COPY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WINNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID_A = 'meeting-a==';
const UUID_B = 'meeting-b==';
const UUID_C = 'meeting-c==';
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const collection = () => ({ featureState: 'enabled', siteVisitActivityId: VISIT_ID, candidateSources: {}, candidates: [],
  jobs: [], currentArtifact: null, publications: [], correctionDrafts: [] });
const video = (over = {}) => ({ recordingType: 'shared_screen_with_speaker_view', bytes: 240_000_000, tooLarge: false, segmented: false, copy: null, ...over });
const meetings = (over = {}) => [
  { meetingUuid: UUID_A, startTime: '2026-10-05T17:00:00Z', durationMinutes: 62, hostEmail: 'h@x.org', audio: { bytes: 5 }, transcript: null, import: null, video: video(), ...over.a },
  { meetingUuid: UUID_B, startTime: '2026-10-04T20:30:00Z', durationMinutes: 45, hostEmail: 'h@x.org', audio: { bytes: 5 }, transcript: null,
    import: { state: 'started', jobId: null, failureCode: null }, video: video(), ...over.b },
  { meetingUuid: UUID_C, startTime: '2026-10-03T20:30:00Z', durationMinutes: 10, hostEmail: 'h@x.org', audio: null, transcript: null, import: null, video: video(), ...over.c },
];
const list = (over) => ({ available: true, windowDays: 30, videoCopyAvailable: true, meetings: meetings(over) });
const copy = (over = {}) => ({ id: COPY_ID, meetingUuid: UUID_A, state: 'copying', bytesConfirmed: 120_000_000, declaredSize: 240_000_000,
  failureCode: null, cancelRequested: false, createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:01:00Z', completedAt: null, ...over });
const conflict = (code, extra = {}) => response({ error: 'x', code, ...extra }, 409);
const winner = { artifactId: WINNER_ID, slotVersion: 3, filename: 'Site visit recording.mp4', size: 90_000_000 };

let state;
function route(handlers = {}) {
  state = { copies: { available: true, copies: [] }, list: list(), posts: [], ...handlers.state };
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = String(url);
    const method = options.method || 'GET';
    if (path.endsWith('/zoom-video-copies')) {
      if (method === 'POST') { const body = JSON.parse(options.body); state.posts.push({ path: 'video', body }); return handlers.videoPost ? handlers.videoPost(body) : response({ copy: { id: COPY_ID, state: 'queued' } }, 202); }
      return typeof state.copies === 'function' ? state.copies() : response(state.copies);
    }
    if (path.endsWith('/zoom-recordings')) return response(state.list);
    if (path.endsWith('/zoom-imports')) {
      const body = JSON.parse(options.body); state.posts.push({ path: 'audio', body });
      return handlers.audioPost ? handlers.audioPost(body) : response({ import: { id: 'i1', state: 'started', failureCode: null }, job: { id: '22222222-2222-4222-8222-222222222222' } });
    }
    if (path.endsWith('/presentation-link')) return response({ link: null });
    if (path.endsWith('/presentation-materials')) return response({ materials: [], uploads: [] });
    if (path.endsWith('/transcriptions')) return response(collection());
    return response({});
  });
}
const posts = (kind) => state.posts.filter((p) => p.path === kind);
const copyGets = () => global.fetch.mock.calls.filter(([url, options]) => String(url).endsWith('/zoom-video-copies') && (options?.method || 'GET') === 'GET').length;
async function openPanel() {
  render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Import from Zoom' }));
  return screen.findByTestId('zoom-import');
}
async function importMeetingA(panel) {
  fireEvent.click(within(panel).getByRole('radio', { name: /Oct 5/ }));
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.click(within(panel).getByRole('button', { name: 'Import, transcribe and copy video' }));
}
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('off by default', () => {
  test.each([
    ['{}', {}], ['available:false', { available: false, copies: [] }], ['available:"true"', { available: 'true', copies: [] }], ['no copies array', { available: true }],
  ])('copies GET %s hides every video control and line, even when the listing carries video fields', async (_l, body) => {
    route({ state: { copies: body } });
    const panel = await openPanel();
    expect(within(panel).queryByText(/Video:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy video|Try again|Cancel copy/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('video-copy-status')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('radio', { name: /Oct 5/ }));
    fireEvent.click(within(panel).getByRole('checkbox'));
    expect(within(panel).getByRole('button', { name: 'Import and transcribe' })).toBeEnabled();
  });
});

describe('picker', () => {
  test('each meeting gets a plain-language video line and no ids', async () => {
    route({ state: { list: list({ a: { video: video({ copy: { id: COPY_ID, state: 'failed', failureCode: 'zoom_video_session_expired' } }) },
      b: { video: video({ tooLarge: true }) }, c: { video: null } }), copies: { available: true, copies: [] } } });
    const panel = await openPanel();
    expect(within(panel).getByText('Video: copy failed')).toBeInTheDocument();
    expect(within(panel).getByText('Video: too large to copy. Upload it manually.')).toBeInTheDocument();
    expect(within(panel).getByText('Video: none yet')).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(GUID);
  });
  test('segmented, waiting, copying (MB), saving, copied and cancelled lines', async () => {
    const lines = [['segmented', { video: video({ segmented: true }) }, 'Video: recorded in several parts. Upload it manually.']];
    for (const [stateName, text, extra] of [['queued', 'Video: waiting to copy'], ['copying', 'Video: copying 120 MB of 240 MB', {}], ['registering', 'Video: saving'],
      ['copied', 'Video: copied'], ['cancelled', 'Video: cancelled']]) {
      lines.push([stateName, { video: video({ copy: { id: COPY_ID, state: stateName, failureCode: null } }) }, text, extra]);
    }
    for (const [stateName, a, text] of lines) {
      route({ state: { list: list({ a }), copies: { available: true, copies: stateName === 'copying' ? [copy()] : [] } } });
      const { unmount } = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Import from Zoom' }));
      const panel = await screen.findByTestId('zoom-import');
      await waitFor(() => expect(within(panel).getByText(text)).toBeInTheDocument());
      unmount();
    }
  });
});

describe('Import starts audio and video as two independent POSTs', () => {
  test('both are sent, the video with replaces:null, and the meeting shows its results', async () => {
    route();
    const panel = await openPanel();
    await importMeetingA(panel);
    await waitFor(() => expect(posts('audio')).toHaveLength(1));
    expect(posts('video')).toEqual([{ path: 'video', body: { action: 'start', meetingUuid: UUID_A, replaces: null } }]);
    expect(posts('audio')[0].body).toEqual({ meetingUuid: UUID_A, nonSensitiveAcknowledged: true });
    expect(await within(panel).findByText(/Video copy started/)).toBeInTheDocument();
    expect(within(panel).getAllByText(/Imported, transcription started/)).toHaveLength(2);
  });
  test('a failing video start leaves the audio import and its result', async () => {
    route({ videoPost: () => response({ error: 'Too big.', code: 'zoom_video_too_large' }, 422) });
    const panel = await openPanel();
    await importMeetingA(panel);
    await waitFor(() => expect(posts('audio')).toHaveLength(1));
    expect(await within(panel).findByText('That video is too large to copy. Upload it manually.')).toBeInTheDocument();
    expect(within(panel).getAllByText(/Imported, transcription started/)).toHaveLength(2);
  });
  test('a failing audio import leaves the video copy started', async () => {
    route({ audioPost: () => response({ error: 'The audio could not be imported.', code: 'x' }, 500) });
    const panel = await openPanel();
    await importMeetingA(panel);
    expect(await within(panel).findByText('The audio could not be imported.')).toBeInTheDocument();
    expect(within(panel).getByText(/Video copy started/)).toBeInTheDocument();
    expect(posts('video')).toHaveLength(1);
  });
  test('a meeting whose video cannot be copied imports audio only, with the old button label', async () => {
    route({ state: { list: list({ a: { video: video({ segmented: true }) } }) } });
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole('radio', { name: /Oct 5/ }));
    fireEvent.click(within(panel).getByRole('checkbox'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Import and transcribe' }));
    await waitFor(() => expect(posts('audio')).toHaveLength(1));
    expect(posts('video')).toHaveLength(0);
  });
});

describe('replace confirmation', () => {
  const needsConfirm = (extra) => (body) => (body.replaces === null ? conflict('zoom_video_replace_confirmation_required', { winner, ...extra })
    : response({ copy: { id: COPY_ID, state: 'queued' } }, 202));
  test('asks first with the file name and size, sends nothing else, then resends with replaces and sends the audio', async () => {
    route({ videoPost: needsConfirm() });
    const panel = await openPanel();
    await importMeetingA(panel);
    expect(await within(panel).findByText('This will replace the recording file already saved for this request. Continue?')).toBeInTheDocument();
    expect(within(panel).getByText(/Site visit recording\.mp4 \(85\.8 MiB\)/)).toBeInTheDocument();
    expect(posts('audio')).toHaveLength(0);
    expect(panel.textContent).not.toMatch(GUID);
    fireEvent.click(within(panel).getByRole('button', { name: 'Replace and continue' }));
    await waitFor(() => expect(posts('audio')).toHaveLength(1));
    expect(posts('video').map((p) => p.body)).toEqual([
      { action: 'start', meetingUuid: UUID_A, replaces: null },
      { action: 'start', meetingUuid: UUID_A, replaces: { artifactId: WINNER_ID, slotVersion: 3 } },
    ]);
  });
  test('keeping the current file copies no video but still imports the audio', async () => {
    route({ videoPost: needsConfirm() });
    const panel = await openPanel();
    await importMeetingA(panel);
    fireEvent.click(await within(panel).findByRole('button', { name: 'Keep current file' }));
    expect(within(panel).queryByText(/This will replace/)).not.toBeInTheDocument();
    await waitFor(() => expect(posts('audio')).toHaveLength(1));
    expect(posts('video')).toHaveLength(1);
    expect(await within(panel).findByText('The current recording file was kept. The video was not copied.')).toBeInTheDocument();
  });
  test('a stale confirmation reloads and asks again with the new file', async () => {
    let calls = 0;
    route({ videoPost: (body) => {
      calls += 1;
      if (calls === 1) return conflict('zoom_video_replace_confirmation_required', { winner });
      if (body.replaces?.slotVersion === 3) return conflict('zoom_video_replace_stale');
      if (body.replaces) return response({ copy: { id: COPY_ID, state: 'queued' } }, 202);
      return conflict('zoom_video_replace_confirmation_required', { winner: { ...winner, filename: 'Newer recording.mp4', slotVersion: 4 } });
    } });
    const panel = await openPanel();
    await importMeetingA(panel);
    fireEvent.click(await within(panel).findByRole('button', { name: 'Replace and continue' }));
    expect(await within(panel).findByText(/Newer recording\.mp4/)).toBeInTheDocument();
    expect(posts('audio')).toHaveLength(0);
    fireEvent.click(within(panel).getByRole('button', { name: 'Replace and continue' }));
    await waitFor(() => expect(posts('audio')).toHaveLength(1));
    expect(posts('video').at(-1).body.replaces).toEqual({ artifactId: WINNER_ID, slotVersion: 4 });
  });
  test('no confirmation is asked when the server does not require it', async () => {
    route();
    const panel = await openPanel();
    await importMeetingA(panel);
    await waitFor(() => expect(posts('audio')).toHaveLength(1));
    expect(within(panel).queryByText(/This will replace/)).not.toBeInTheDocument();
  });
});

describe('standalone Copy video', () => {
  test('a meeting without audio, and an earlier import, offer Copy video; Import-able meetings do not', async () => {
    route();
    const panel = await openPanel();
    expect(within(panel).getAllByRole('button', { name: 'Copy video' })).toHaveLength(2);
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Copy video' })[1]);
    await waitFor(() => expect(posts('video')).toHaveLength(1));
    expect(posts('video')[0].body).toEqual({ action: 'start', meetingUuid: UUID_C, replaces: null });
    expect(posts('audio')).toHaveLength(0);
  });
  test('with transcription off the listing has no audio fields: Copy video on every meeting, no radio is selectable', async () => {
    const off = list().meetings.map(({ audio, transcript, import: i, ...rest }) => rest);
    route({ state: { list: { available: true, windowDays: 30, videoCopyAvailable: true, meetings: off } } });
    const panel = await openPanel();
    expect(within(panel).getAllByRole('button', { name: 'Copy video' })).toHaveLength(3);
    expect(within(panel).queryByText(/No audio yet/)).not.toBeInTheDocument();
    for (const radio of within(panel).getAllByRole('radio')) expect(radio).toBeDisabled();
  });
  test('Copy video asks the replace confirmation too, and resends with replaces', async () => {
    route({ videoPost: (body) => (body.replaces === null ? conflict('zoom_video_replace_confirmation_required', { winner }) : response({ copy: { id: COPY_ID, state: 'queued' } }, 202)) });
    const panel = await openPanel();
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Copy video' })[1]);
    fireEvent.click(await within(panel).findByRole('button', { name: 'Replace and continue' }));
    await waitFor(() => expect(posts('video')).toHaveLength(2));
    expect(posts('video')[1].body.replaces).toEqual({ artifactId: WINNER_ID, slotVersion: 3 });
    expect(posts('audio')).toHaveLength(0);
  });
  test('another active copy disables the buttons', async () => {
    route({ state: { copies: { available: true, copies: [copy({ meetingUuid: UUID_A })] } } });
    const panel = await openPanel();
    await waitFor(() => expect(screen.getByTestId('video-copy-status')).toBeInTheDocument());
    expect(within(panel).queryByRole('button', { name: 'Copy video' })).not.toBeInTheDocument();
  });
});

describe('Recording block', () => {
  const status = async (copies) => {
    route({ state: { copies: { available: true, copies } } });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    return screen.findByTestId('video-copy-status');
  };
  test('copying shows percent and megabytes, keeps the card usable, and offers Cancel copy', async () => {
    const box = await status([copy()]);
    expect(within(box).getByText('Copying the video from Zoom into SharePoint.')).toBeInTheDocument();
    expect(within(box).getByText('50% · 120 MB of 240 MB')).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Cancel copy' })).toBeEnabled();
    expect(box.textContent).not.toMatch(GUID);
  });
  test('queued offers Cancel copy; Cancel posts the copy id and shows Cancelling once flagged', async () => {
    const box = await status([copy({ state: 'queued', bytesConfirmed: 0 })]);
    expect(within(box).getByText('Waiting to copy the video from Zoom.')).toBeInTheDocument();
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel copy' }));
    await waitFor(() => expect(posts('video')).toHaveLength(1));
    expect(posts('video')[0].body).toEqual({ action: 'cancel', copyId: COPY_ID });
  });
  test('registering shows Saving… and has no Cancel copy', async () => {
    const box = await status([copy({ state: 'registering', bytesConfirmed: 240_000_000 })]);
    expect(within(box).getByText('Saving…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel copy' })).not.toBeInTheDocument();
  });
  test('a cancel flagged copy shows Cancelling… and no button', async () => {
    const box = await status([copy({ cancelRequested: true })]);
    expect(within(box).getByText('Cancelling…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel copy' })).not.toBeInTheDocument();
  });
  test('a 409 saving answer to Cancel explains it plainly', async () => {
    route({ state: { copies: { available: true, copies: [copy()] } }, videoPost: () => conflict('zoom_video_copy_saving') });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel copy' }));
    expect(await screen.findByText('The video is being saved and can no longer be cancelled.')).toBeInTheDocument();
  });
  test.each([
    ['zoom_video_recording_replaced', 'A newer recording was saved while the video was copying, so the copy was not used.'],
    ['zoom_recording_changed', 'The recording in Zoom changed or is no longer available, so the copy stopped.'],
    ['zoom_download_denied', 'Zoom would not provide the video. Try again in a few minutes.'],
    ['zoom_video_registration_failed', 'The video could not be saved to SharePoint. Try again.'],
    ['something_new', 'The video copy did not finish. Try again.'],
  ])('failed with %s shows "Video copy needs attention." with a plain reason and Try again', async (code, text) => {
    const box = await status([copy({ state: 'failed', failureCode: code })]);
    expect(within(box).getByText(new RegExp(`^Video copy needs attention\\. ${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(box.textContent).not.toContain(code);
  });
  test('Try again starts the same meeting, with the replace confirmation when the server asks', async () => {
    route({ state: { copies: { available: true, copies: [copy({ state: 'failed', failureCode: 'zoom_video_session_expired' })] } },
      videoPost: (body) => (body.replaces === null ? conflict('zoom_video_replace_confirmation_required', { winner }) : response({ copy: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', state: 'queued' } }, 202)) });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    const box = await screen.findByTestId('video-copy-status');
    expect(await within(box).findByText('This will replace the recording file already saved for this request. Continue?')).toBeInTheDocument();
    fireEvent.click(within(box).getByRole('button', { name: 'Replace and continue' }));
    await waitFor(() => expect(posts('video')).toHaveLength(2));
    expect(posts('video')[1].body).toEqual({ action: 'start', meetingUuid: UUID_A, replaces: { artifactId: WINNER_ID, slotVersion: 3 } });
  });
  test('cancelled shows one plain line', async () => {
    const box = await status([copy({ state: 'cancelled' })]);
    expect(within(box).getByText('Video copy cancelled.')).toBeInTheDocument();
  });
});

describe('polling', () => {
  const advance = (ms) => act(async () => { jest.advanceTimersByTime(ms); });
  test('polls every 10 s only while a copy is active, picks up completion and reloads materials, then stops', async () => {
    jest.useFakeTimers();
    let phase = 'copying';
    route({ state: { copies: () => response({ available: true, copies: [copy({ state: phase, completedAt: phase === 'copied' ? 'x' : null })] }) } });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    await advance(1);
    await screen.findByText('Copying the video from Zoom into SharePoint.');
    const materialsReads = () => global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/presentation-materials')).length;
    const reads = materialsReads();
    const first = copyGets();
    await advance(9_000);
    expect(copyGets()).toBe(first);
    await advance(1_500);
    expect(copyGets()).toBe(first + 1);
    phase = 'copied';
    await advance(10_000);
    await screen.findByText('The video was copied from Zoom.');
    expect(materialsReads()).toBeGreaterThan(reads);
    const done = copyGets();
    await advance(60_000);
    expect(copyGets()).toBe(done);
  });
  test('unmounting stops the polling', async () => {
    jest.useFakeTimers();
    route({ state: { copies: { available: true, copies: [copy()] } } });
    const { unmount } = render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    await advance(1);
    await screen.findByText('Copying the video from Zoom into SharePoint.');
    await advance(10_500);
    const before = copyGets();
    expect(before).toBeGreaterThan(1);
    unmount();
    await advance(60_000);
    expect(copyGets()).toBe(before);
  });
  test('a copy that is already terminal is never polled', async () => {
    jest.useFakeTimers();
    route({ state: { copies: { available: true, copies: [copy({ state: 'failed', failureCode: 'x' })] } } });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    await advance(1);
    await screen.findByText(/Video copy needs attention/);
    const before = copyGets();
    await advance(60_000);
    expect(copyGets()).toBe(before);
  });
  test('a slow older poll cannot overwrite a newer snapshot', async () => {
    jest.useFakeTimers();
    const resolvers = [];
    let calls = 0;
    route({ state: { copies: () => { calls += 1; if (calls === 1) return response({ available: true, copies: [copy()] });
      return new Promise((resolve) => { resolvers.push(resolve); }); } } });
    render(<RecordingAndTranscriptCard requestId={REQUEST_ID} />);
    await advance(1);
    await screen.findByText('Copying the video from Zoom into SharePoint.');
    await advance(10_500);
    await advance(10_000);
    expect(resolvers).toHaveLength(2);
    await act(async () => { resolvers[1](response({ available: true, copies: [copy({ state: 'copied' })] })); });
    await screen.findByText('The video was copied from Zoom.');
    await act(async () => { resolvers[0](response({ available: true, copies: [copy({ bytesConfirmed: 1 })] })); });
    expect(screen.getByText('The video was copied from Zoom.')).toBeInTheDocument();
  });
});

test('no GUID appears anywhere in the rendered card with copies, a winner and the confirmation open', async () => {
  route({ state: { copies: { available: true, copies: [copy({ state: 'failed', failureCode: 'zoom_video_session_expired' })] } },
    videoPost: () => conflict('zoom_video_replace_confirmation_required', { winner }) });
  const panel = await openPanel();
  fireEvent.click(within(panel).getAllByRole('button', { name: 'Copy video' })[0]);
  await within(panel).findByText(/This will replace/);
  expect(screen.getByTestId('recording-and-transcript-card').textContent).not.toMatch(GUID);
});
