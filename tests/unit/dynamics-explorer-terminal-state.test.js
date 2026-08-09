/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
