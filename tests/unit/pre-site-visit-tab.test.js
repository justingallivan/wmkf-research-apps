/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PreSiteVisitTab from '../../shared/components/workbench/PreSiteVisitTab';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REQUEST_ID = '33333333-3333-3333-3333-333333333333';

function successResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      artifact: {
        artifactId: '22222222-2222-2222-8222-222222222222',
        operationStatus: 100000001,
        lifecycleState: 100000000,
        file: {
          name: '1002379 Pre-Site Visit.docx',
          webUrl: 'https://sharepoint.test/pre-site.docx',
        },
      },
    }),
  };
}

function statusResponse({ currentArtifact = null, pendingArtifact = null } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, currentArtifact, pendingArtifact }),
  };
}

function readyArtifact() {
  return {
    artifactId: '22222222-2222-2222-8222-222222222222',
    operationStatus: 100000001,
    lifecycleState: 100000000,
    file: {
      name: '1002379 Pre-Site Visit.docx',
      webUrl: 'https://sharepoint.test/pre-site.docx',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async (_url, options = {}) => (
    options.method === 'POST' ? successResponse() : statusResponse()
  ));
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('shows compact actions and keeps generation details behind help', async () => {
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  expect(screen.queryByText(/current published Admin prompt/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'About Pre Site Visit Word drafts' }));
  expect(screen.getByText(/current published Admin prompt/i)).toBeInTheDocument();
  expect(screen.getByText(/saved in SharePoint/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requestId: REQUEST_ID }),
      signal: expect.any(AbortSignal),
    }),
  ));
  const edit = await screen.findByRole('link', { name: 'Edit' });
  expect(edit).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(edit).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('link', { name: 'Download' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx?download=1');
  expect(screen.getByRole('button', { name: 'Regenerate Word Draft' })).toBeEnabled();
  expect(screen.getByText('Latest draft:')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '1002379 Pre-Site Visit.docx' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.getByRole('link', { name: '1002379 Pre-Site Visit.docx' }))
    .toHaveAttribute('target', '_blank');
  expect(screen.getByRole('heading', { name: 'Ready for the Site Visit stage?' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start Site Visit' })).toBeInTheDocument();
});

test('loads existing Ready actions without another generation request', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }));
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  const link = await screen.findByRole('link', { name: 'Edit' });
  expect(link).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Regenerate Word Draft' })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    `/api/workbench/pre-site-visit?requestId=${REQUEST_ID}`,
    expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
  );
});

test('shows durable Ready warnings beside the Word link', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: {
      ...readyArtifact(),
      warnings: [{
        code: 'section_over_target',
        message: 'A generated section is longer than suggested and may need editing.',
      }],
    },
  }));
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Draft needs a quick edit check' }))
    .toBeInTheDocument();
  expect(screen.getByText(/longer than suggested/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
});

test('recovers a Ready Word link after the generation connection is interrupted', async () => {
  let getCount = 0;
  global.fetch.mockImplementation(async (_url, options = {}) => {
    if (options.method === 'POST') throw new TypeError('Failed to fetch');
    getCount += 1;
    return getCount === 1
      ? statusResponse()
      : statusResponse({ currentArtifact: readyArtifact() });
  });
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  const link = await screen.findByRole('link', { name: 'Edit' });
  expect(link).toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'POST')).toHaveLength(1);
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'GET')).toHaveLength(2);
});

test('shows a server error without creating a Word link', async () => {
  global.fetch.mockImplementation(async (_url, options = {}) => {
    if (options.method !== 'POST') return statusResponse();
    return {
      ok: false,
      status: 409,
      json: async () => ({ error: 'No usable AI proposal narrative was found.' }),
    };
  });
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No usable AI proposal narrative was found.',
  );
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'POST')).toHaveLength(1);
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'GET')).toHaveLength(2);
});

test('refreshes durable failure state once and shows its support reference', async () => {
  let getCount = 0;
  global.fetch.mockImplementation(async (_url, options = {}) => {
    if (options.method === 'POST') {
      return {
        ok: false,
        status: 502,
        json: async () => ({ error: 'Pre-Site Visit generation did not complete.', runId: 'run-from-post' }),
      };
    }
    getCount += 1;
    return getCount === 1 ? statusResponse() : statusResponse({
      pendingArtifact: {
        artifactId: 'failed-artifact',
        operationStatus: 100000002,
        retryable: false,
        lastError: {
          message: 'The governed output was invalid.',
          supportReference: 'durable-run-id',
        },
      },
    });
  });
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('The governed output was invalid.');
  expect(screen.getByRole('alert')).toHaveTextContent('Support reference: durable-run-id');
  expect(screen.getByText(/needs a prompt or application change/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate Word Draft' })).toBeDisabled();
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'POST')).toHaveLength(1);
  expect(global.fetch.mock.calls.filter(([, options = {}]) => options.method === 'GET')).toHaveLength(2);
});

test('requires confirmation before regenerating an existing draft', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }));
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate Word Draft' }));

  expect(confirm).toHaveBeenCalledWith(
    'Regenerating starts a new Claude call and creates new AI-generated content from '
    + 'the latest proposal source and Dataverse data. Edits in the current Word file '
    + 'will not be carried into the new draft. Continue?',
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('opens an explanatory Site Visit modal and cancel performs no transition', async () => {
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }));
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start Site Visit' }));

  const dialog = screen.getByRole('dialog', { name: 'Start the Site Visit stage?' });
  expect(dialog).toHaveTextContent('This exact Word document will become the Site Visit workspace.');
  expect(dialog).toHaveTextContent('current SharePoint version will be recorded in Dataverse');
  expect(dialog).toHaveTextContent('Staff can continue editing this same document in Word.');
  expect(dialog).toHaveTextContent('can no longer be regenerated after this change');
  expect(within(dialog).getByRole('button', { name: 'Start Site Visit' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(within(dialog).getByRole('button', { name: 'Start Site Visit' })).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('confirms the displayed artifact through the guarded route and opens Site Visit', async () => {
  const promoted = {
    ...readyArtifact(),
    lifecycleState: 100000001,
    milestone: {
      versionId: '2.0',
      contentHash: 'gdc1:handoff',
      createdAt: '2026-08-17T21:05:00Z',
    },
  };
  global.fetch
    .mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }))
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, artifact: promoted, reused: false }),
    });
  const onSelectTab = jest.fn();
  render(<PreSiteVisitTab requestId={REQUEST_ID} onSelectTab={onSelectTab} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start Site Visit' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start Site Visit' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit/start-site-visit',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        requestId: REQUEST_ID,
        expectedArtifactId: '22222222-2222-2222-8222-222222222222',
      }),
      signal: expect.any(AbortSignal),
    }),
  ));
  await waitFor(() => expect(onSelectTab).toHaveBeenCalledWith('site-visit'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('keeps the modal open and shows a transition failure for retry', async () => {
  global.fetch
    .mockResolvedValueOnce(statusResponse({ currentArtifact: readyArtifact() }))
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'The Word draft changed. Reload and retry.' }),
    });
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start Site Visit' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start Site Visit' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The Word draft changed. Reload and retry.',
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Start Site Visit' })).toBeEnabled();
});

test('a late Site Visit transition cannot navigate after the request changes', async () => {
  let resolvePromotion;
  global.fetch.mockImplementation((_url, options = {}) => {
    if (options.method !== 'POST') {
      return Promise.resolve(statusResponse({ currentArtifact: readyArtifact() }));
    }
    return new Promise((resolve) => { resolvePromotion = resolve; });
  });
  const onSelectTab = jest.fn();
  const { rerender } = render(
    <PreSiteVisitTab requestId={REQUEST_ID} onSelectTab={onSelectTab} />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Start Site Visit' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start Site Visit' }));
  rerender(<PreSiteVisitTab requestId={OTHER_REQUEST_ID} onSelectTab={onSelectTab} />);
  await act(async () => {
    resolvePromotion({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        artifact: { ...readyArtifact(), lifecycleState: 100000001 },
      }),
    });
  });

  await screen.findByRole('heading', { name: 'Ready for the Site Visit stage?' });
  expect(onSelectTab).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a promoted draft becomes a handoff receipt with work continuing in Site Visit', async () => {
  const promoted = {
    ...readyArtifact(),
    lifecycleState: 100000001,
    warnings: [{
      code: 'section_over_target',
      message: 'A generated section is longer than suggested and may need editing.',
    }],
    milestone: {
      versionId: '2.0',
      contentHash: 'gdc1:handoff',
      createdAt: '2026-08-17T21:05:00Z',
    },
  };
  const onSelectTab = jest.fn();
  global.fetch.mockResolvedValueOnce(statusResponse({ currentArtifact: promoted }));
  render(<PreSiteVisitTab requestId={REQUEST_ID} onSelectTab={onSelectTab} />);

  expect(await screen.findByText(/now managed in the Site Visit workspace/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Regenerate Word Draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '1002379 Pre-Site Visit.docx' })).not.toBeInTheDocument();
  expect(screen.getByText('Promoted document:')).toHaveTextContent('1002379 Pre-Site Visit.docx');
  expect(screen.getByRole('heading', { name: 'Pre-Site Visit handoff complete' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Working document needs a quick edit check' }))
    .toBeInTheDocument();
  expect(screen.getByText(/continue in Site Visit to review these warnings/i)).toBeInTheDocument();
  expect(screen.getByText(/longer than suggested/i)).toBeInTheDocument();
  expect(screen.getByText(/continue there to edit or download/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue in Site Visit' }));
  expect(onSelectTab).toHaveBeenCalledWith('site-visit');
});

test.each([
  ['Board Ready', 100000002],
  ['Superseded', 100000003],
  ['Final', 100000004],
  ['unknown', 999999999],
])('a Ready %s artifact fails closed in the Pre-Site tab', async (_label, lifecycleState) => {
  global.fetch.mockResolvedValueOnce(statusResponse({
    currentArtifact: { ...readyArtifact(), lifecycleState },
  }));
  render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('heading', { name: 'Pre-Site Visit is read-only' }))
    .toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '1002379 Pre-Site Visit.docx' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Regenerate Word Draft' })).not.toBeInTheDocument();
  expect(screen.getByText(/cannot be edited, downloaded, or regenerated from this tab/i))
    .toBeInTheDocument();
});


test('a late response for a prior request cannot publish a stale Word link', async () => {
  let resolveFirst;
  global.fetch.mockImplementation((_url, options = {}) => {
    if (options.method !== 'POST') return Promise.resolve(statusResponse());
    return new Promise((resolve) => { resolveFirst = resolve; });
  });
  const { rerender } = render(<PreSiteVisitTab requestId={REQUEST_ID} />);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Generate Word Draft' }));
  rerender(<PreSiteVisitTab requestId={OTHER_REQUEST_ID} />);
  await act(async () => { resolveFirst(successResponse()); });

  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Word Draft' })).toBeEnabled());
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
});
