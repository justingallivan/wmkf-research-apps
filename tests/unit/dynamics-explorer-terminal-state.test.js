/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title, children }) => <header><h1>{title}</h1>{children}</header>,
  Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, loading: _loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/HelpButton', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));
jest.mock('../../shared/context/ProfileContext', () => {
  const React = require('react');
  return { __esModule: true, default: React.createContext(null) };
});

import DynamicsExplorerPage from '../../pages/dynamics-explorer';
import ProfileContext from '../../shared/context/ProfileContext';

const EOF = Symbol('EOF');

class FakeSseReadableStream {
  constructor(reads) {
    this.reads = [...reads];
  }

  getReader() {
    return {
      cancel: jest.fn(async () => {}),
      read: jest.fn(async () => {
        let next = this.reads.shift();
        if (next?.isDeferredRead) {
          next.started = true;
          const deferred = next;
          next = await deferred.promise;
          deferred.consumed = true;
        }
        if (next === EOF || next === undefined) {
          return { done: true, value: undefined };
        }
        if (next instanceof Error) throw next;
        return {
          done: false,
          value: Uint8Array.from(Buffer.from(next, 'utf8')),
        };
      }),
    };
  }
}

function deferredRead() {
  let resolve;
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise;
  });
  return { isDeferredRead: true, started: false, consumed: false, promise, resolve };
}

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(reads) {
  return {
    ok: true,
    status: 200,
    body: new FakeSseReadableStream(reads),
  };
}

function submitQuestion(question = 'How many requests are there?') {
  fireEvent.change(
    screen.getByPlaceholderText('Ask a question about your CRM data...'),
    { target: { value: question } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: jest.fn(),
  });
  // jsdom does not provide TextDecoder; the SSE reader needs it.
  if (typeof global.TextDecoder === 'undefined') {
    global.TextDecoder = require('util').TextDecoder;
  }
});

// The composer textarea is disabled by `isProcessing` alone, so it — not the
// Send button, which is also disabled whenever the input is empty — is what
// tells us the request finished.
function expectComposerUnlocked() {
  return waitFor(() => {
    expect(
      screen.getByPlaceholderText('Ask a question about your CRM data...'),
    ).toBeEnabled();
  });
}

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('Dynamics Explorer SSE terminal state', () => {
  test('renders submitted user text in white on the lighter blue message bubble', async () => {
    fetch.mockResolvedValueOnce(streamResponse([EOF]));
    render(<DynamicsExplorerPage />);

    submitQuestion('Can you tell me about Texas Tech?');

    const userText = await screen.findByText('Can you tell me about Texas Tech?');
    expect(userText).toHaveClass('text-white', 'prose-invert');
    expect(userText.parentElement).toHaveClass('bg-blue-500');
  });

  test('clean EOF without a terminal event clears the spinner and explains the failure', async () => {
    fetch.mockResolvedValueOnce(streamResponse([EOF]));
    render(<DynamicsExplorerPage />);

    submitQuestion();

    expect(
      await screen.findByText(/connection dropped before I could answer/i),
    ).toBeInTheDocument();
    await expectComposerUnlocked();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });

  test('complete followed by a read rejection produces exactly one assistant message', async () => {
    fetch.mockResolvedValueOnce(streamResponse([
      sse('response', { content: 'Final answer' }),
      sse('complete', { rounds: 1 }),
      new Error('read rejected after complete'),
    ]));
    render(<DynamicsExplorerPage />);

    submitQuestion();

    expect(await screen.findByText('Final answer')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(1);
    });
    expect(screen.getAllByText('Final answer')).toHaveLength(1);
    expect(
      screen.queryByText(/read rejected after complete/i),
    ).not.toBeInTheDocument();
  });

  test('text_delta followed by error finalizes the partial message before appending the error', async () => {
    fetch.mockResolvedValueOnce(streamResponse([
      sse('text_delta', { text: 'Partial answer' }),
      sse('error', { message: 'The query failed' }),
      EOF,
    ]));
    render(<DynamicsExplorerPage />);

    submitQuestion();

    const partial = await screen.findByText('Partial answer');
    expect(await screen.findByText(/The query failed/)).toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(partial.parentElement.parentElement).getByRole('button', {
          name: 'Copy',
        }),
      ).toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });

  test('error events render the server requestId as a reference', async () => {
    fetch.mockResolvedValueOnce(streamResponse([
      sse('error', {
        message: 'Unable to finish the query',
        requestId: 'req-123',
      }),
      EOF,
    ]));
    render(<DynamicsExplorerPage />);

    submitQuestion();

    expect(await screen.findByText('req-123')).toBeInTheDocument();
    expect(screen.getByText(/Reference:/)).toBeInTheDocument();
  });

  test('successful feedback submits the completed request id for server verification', async () => {
    fetch
      .mockResolvedValueOnce(streamResponse([
        sse('response', { content: 'Correlated answer' }),
        sse('complete', {
          requestId: '2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26',
          rounds: 1,
          outcome: 'completed',
        }),
        EOF,
      ]))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 7 }) });
    render(<DynamicsExplorerPage />);

    submitQuestion();
    expect(await screen.findByText('Correlated answer')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Helpful'));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(expect.objectContaining({
      requestId: '2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26',
      feedbackType: 'positive',
    }));
  });

  test('a non-ok fetch still reports its status before any terminal event can be seen', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    render(<DynamicsExplorerPage />);

    submitQuestion();

    expect(await screen.findByText(/Server error: 503/)).toBeInTheDocument();
    await expectComposerUnlocked();
  });

  test.each([
    [
      'server error',
      [sse('error', { message: 'First turn failed' }), EOF],
      /First turn failed/,
    ],
    [
      'clean EOF',
      [EOF],
      /connection dropped before I could answer/i,
    ],
    [
      'reader rejection',
      [new Error('first turn reader rejected')],
      /first turn reader rejected/i,
    ],
  ])('%s discards pending artifacts before the next answer', async (_label, terminalReads, firstTurnMessage) => {
    const pendingArtifacts = [
      sse('file_ready', {
        filename: 'stale-export.xlsx',
        base64: 'AA==',
        recordCount: 1,
        columns: ['name'],
      }),
      sse('document_links', {
        requestNumber: '1000001',
        files: [{ name: 'stale-document.docx', webUrl: 'https://example.test/stale', size: 12 }],
      }),
    ];
    fetch
      .mockResolvedValueOnce(streamResponse([...pendingArtifacts, ...terminalReads]))
      .mockResolvedValueOnce(streamResponse([
        sse('response', { content: 'Second answer' }),
        sse('complete', { rounds: 1 }),
        EOF,
      ]));
    render(<DynamicsExplorerPage />);

    submitQuestion('First question');
    expect(await screen.findByText(firstTurnMessage)).toBeInTheDocument();
    await expectComposerUnlocked();

    submitQuestion('Second question');
    expect(await screen.findByText('Second answer')).toBeInTheDocument();
    await expectComposerUnlocked();

    expect(screen.queryByText('stale-export.xlsx')).not.toBeInTheDocument();
    expect(screen.queryByText('stale-document.docx')).not.toBeInTheDocument();
  });

  test('clean EOF discards an out-of-protocol artifact received after complete', async () => {
    fetch
      .mockResolvedValueOnce(streamResponse([
        sse('response', { content: 'First answer' }),
        sse('complete', { rounds: 1 }),
        sse('file_ready', {
          filename: 'late-stale-export.xlsx',
          base64: 'AA==',
          recordCount: 1,
          columns: ['name'],
        }),
        EOF,
      ]))
      .mockResolvedValueOnce(streamResponse([
        sse('response', { content: 'Second answer' }),
        sse('complete', { rounds: 1 }),
        EOF,
      ]));
    render(<DynamicsExplorerPage />);

    submitQuestion('First question');
    expect(await screen.findByText('First answer')).toBeInTheDocument();
    await expectComposerUnlocked();

    submitQuestion('Second question');
    expect(await screen.findByText('Second answer')).toBeInTheDocument();
    await expectComposerUnlocked();

    expect(screen.queryByText('late-stale-export.xlsx')).not.toBeInTheDocument();
  });

  test('a prior turn stops reading at complete and cannot disturb the current turn', async () => {
    const priorTurnLateRead = deferredRead();
    const currentTurnRemainder = deferredRead();
    fetch
      .mockResolvedValueOnce(streamResponse([
        sse('response', { content: 'First answer' }),
        sse('complete', { rounds: 1 }),
        priorTurnLateRead,
      ]))
      .mockResolvedValueOnce(streamResponse([
        sse('file_ready', {
          filename: 'fresh-export.xlsx',
          base64: 'AA==',
          recordCount: 1,
          columns: ['name'],
        }),
        currentTurnRemainder,
      ]));
    render(<DynamicsExplorerPage />);

    submitQuestion('First question');
    expect(await screen.findByText('First answer')).toBeInTheDocument();
    await expectComposerUnlocked();
    expect(priorTurnLateRead.started).toBe(false);

    submitQuestion('Second question');
    await waitFor(() => expect(currentTurnRemainder.started).toBe(true));

    // This would reject the old reader if the client incorrectly consumed an
    // event after `complete`. It must remain untouched while turn two finishes.
    priorTurnLateRead.resolve(new Error('late prior-turn rejection'));

    currentTurnRemainder.resolve(
      sse('response', { content: 'Second answer' })
        + sse('complete', { rounds: 1 }),
    );

    expect(await screen.findByText('Second answer')).toBeInTheDocument();
    expect(await screen.findByText('fresh-export.xlsx')).toBeInTheDocument();
    expect(screen.queryByText(/late prior-turn rejection/i)).not.toBeInTheDocument();
    expect(priorTurnLateRead.started).toBe(false);
    expect(priorTurnLateRead.consumed).toBe(false);
    await expectComposerUnlocked();
  });
});

// ── T5 (client-request-layer Stage 5a, plan §5) matrix for the :153 roles
// GET now guards non-2xx envelopes while preserving tolerant malformed-2xx
// behavior. The :476 feedback
// POST (fire-and-forget: the response is never read today, only a network
// rejection reaches the console.error catch). ──────────────────────────

function renderWithProfile(profileId = 'profile-1') {
  return render(
    <ProfileContext.Provider value={{ currentProfile: { id: profileId } }}>
      <DynamicsExplorerPage />
    </ProfileContext.Provider>,
  );
}

describe('roles GET (:153, D1-preserve)', () => {
  test('T5(a) 2xx JSON sets the role badge from callerRole', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ callerRole: 'superuser' }) });
    renderWithProfile();
    expect(await screen.findByText('Superuser')).toBeInTheDocument();
  });

  test('T5(b) non-2xx body leaves the safe role and shows the load error', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ role: 'read_write' }) });
    renderWithProfile();
    expect(await screen.findByText('Request failed (500)')).toBeInTheDocument();
    expect(screen.getByText('Read Only')).toBeInTheDocument();
  });

  test('T5(c) network rejection is swallowed, badge stays the default', async () => {
    fetch.mockRejectedValueOnce(new Error('network down'));
    renderWithProfile();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText('Read Only')).toBeInTheDocument();
  });

  test('T5(d)/(e) malformed body at any status is swallowed, badge stays the default', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
    renderWithProfile();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText('Read Only')).toBeInTheDocument();
  });

  test('stale role response cannot overwrite the current profile', async () => {
    let resolveOld;
    fetch
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ callerRole: 'superuser' }) });
    const view = renderWithProfile('old');
    view.rerender(<ProfileContext.Provider value={{ currentProfile: { id: 'new' } }}><DynamicsExplorerPage /></ProfileContext.Provider>);
    expect(await screen.findByText('Superuser')).toBeInTheDocument();
    await act(async () => {
      resolveOld({ ok: true, status: 200, json: async () => ({ callerRole: 'read_write' }) });
      await Promise.resolve();
    });
    expect(screen.getByText('Superuser')).toBeInTheDocument();
  });
});

describe('feedback POST (:476, fire-and-forget)', () => {
  function renderReadyForFeedback() {
    fetch.mockResolvedValueOnce(streamResponse([
      sse('response', { content: 'Correlated answer' }),
      sse('complete', { requestId: 'req-1', rounds: 1, outcome: 'completed' }),
      EOF,
    ]));
    render(<DynamicsExplorerPage />);
    submitQuestion();
    return screen.findByText('Correlated answer');
  }

  test('T5(b) non-2xx response is ignored, feedback still records locally', async () => {
    await renderReadyForFeedback();
    fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    fireEvent.click(screen.getByTitle('Helpful'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTitle('Helpful')).toHaveClass('text-green-600'));
  });

  test('T5(d) malformed 2xx body is ignored (never read today), feedback still records locally', async () => {
    await renderReadyForFeedback();
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
    fireEvent.click(screen.getByTitle('Helpful'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTitle('Helpful')).toHaveClass('text-green-600'));
  });

  test('T5(c) network rejection is caught and logged, feedback still records locally', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await renderReadyForFeedback();
    fetch.mockRejectedValueOnce(new Error('network down'));
    fireEvent.click(screen.getByTitle('Helpful'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTitle('Helpful')).toHaveClass('text-green-600'));
    expect(errSpy).toHaveBeenCalledWith('Failed to submit feedback:', expect.any(Error));
    errSpy.mockRestore();
  });
});
