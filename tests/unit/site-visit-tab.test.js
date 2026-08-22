/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SiteVisitTab from '../../shared/components/workbench/SiteVisitTab';
import { PRE_SITE_REOPEN_REASON } from '../../shared/config/requestDocument';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';

function artifact(lifecycleState = 100000000) {
  return {
    artifactId: ARTIFACT_ID,
    operationStatus: 100000001,
    lifecycleState,
    file: {
      name: '1002379 Pre-Site Visit.docx',
      webUrl: 'https://sharepoint.test/pre-site.docx',
    },
    milestone: lifecycleState === 100000001 ? {
      versionId: '2.0',
      contentHash: 'gdc1:handoff',
      createdAt: '2026-08-17T21:05:00Z',
    } : null,
  };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue(response({
    success: true,
    currentArtifact: artifact(),
    pendingArtifact: null,
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('shows the Ready Pre-Site draft as the proposed Site Visit workspace', async () => {
  render(<SiteVisitTab requestId={REQUEST_ID} />);

  expect(await screen.findByRole('button', { name: 'Start Site Visit Stage' })).toBeEnabled();
  expect(screen.getByRole('link', { name: '1002379 Pre-Site Visit.docx' }))
    .toHaveAttribute('target', '_blank');
  expect(screen.getByText(/same file/i)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
});

test('confirms and promotes the exact artifact, then exposes Edit and Download', async () => {
  global.fetch
    .mockResolvedValueOnce(response({
      success: true,
      currentArtifact: artifact(),
      pendingArtifact: null,
    }))
    .mockResolvedValueOnce(response({
      success: true,
      artifact: artifact(100000001),
      reused: false,
    }));
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<SiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start Site Visit Stage' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit/start-site-visit',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID }),
      signal: expect.any(AbortSignal),
    }),
  ));
  expect(await screen.findByText('Site Visit in progress')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx');
  expect(screen.getByRole('link', { name: 'Download' }))
    .toHaveAttribute('href', 'https://sharepoint.test/pre-site.docx?download=1');
  expect(screen.queryByRole('button', { name: 'Start Site Visit Stage' })).not.toBeInTheDocument();
});

test('requires confirmation before starting the stage', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<SiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start Site Visit Stage' }));

  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('exact current SharePoint version'));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('continue editing the same file in Word'));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Pre-Site regeneration will be disabled'));
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('links back to Pre-Site when no Ready draft exists', async () => {
  const onSelectTab = jest.fn();
  global.fetch.mockResolvedValueOnce(response({
    success: true,
    currentArtifact: null,
    pendingArtifact: null,
  }));
  render(<SiteVisitTab requestId={REQUEST_ID} onSelectTab={onSelectTab} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Go to Pre Site Visit Writeup →' }));
  expect(onSelectTab).toHaveBeenCalledWith('pre-site-visit');
});

test('a late promotion response from another request cannot publish stale workspace state', async () => {
  let resolvePromotion;
  global.fetch.mockImplementation((_url, options = {}) => {
    if (options.method !== 'POST') {
      return Promise.resolve(response({
        success: true,
        currentArtifact: artifact(),
        pendingArtifact: null,
      }));
    }
    return new Promise((resolve) => { resolvePromotion = resolve; });
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  const { rerender } = render(<SiteVisitTab requestId={REQUEST_ID} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Start Site Visit Stage' }));
  rerender(<SiteVisitTab requestId={OTHER_REQUEST_ID} />);
  await act(async () => {
    resolvePromotion(response({
      success: true,
      artifact: artifact(100000001),
      reused: false,
    }));
  });

  await waitFor(() => expect(screen.getByRole('button', { name: 'Start Site Visit Stage' })).toBeEnabled());
  expect(screen.queryByText('Site Visit in progress')).not.toBeInTheDocument();
});

test('only superusers can see the guarded reopen control', async () => {
  global.fetch.mockResolvedValueOnce(response({
    success: true,
    currentArtifact: artifact(100000001),
    pendingArtifact: null,
    reopenHistory: [],
  }));
  render(<SiteVisitTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser={false} />);
  expect(await screen.findByText('Site Visit in progress')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reopen Pre-Site Draft' })).not.toBeInTheDocument();
});

test('validates confirmation and submits one guarded reopen operation before returning to Pre-Site', async () => {
  const onSelectTab = jest.fn();
  global.fetch
    .mockResolvedValueOnce(response({
      success: true,
      currentArtifact: artifact(100000001),
      pendingArtifact: null,
      reopenHistory: [],
    }))
    .mockResolvedValueOnce(response({
      success: true,
      artifact: artifact(100000000),
      reused: false,
      recovered: false,
      inProgress: false,
    }))
    .mockResolvedValueOnce(response({
      success: true,
      currentArtifact: artifact(100000000),
      pendingArtifact: null,
      reopenHistory: [{
        artifactId: ARTIFACT_ID,
        correction: {
          cycleId: '33333333-3333-4333-8333-333333333333',
          reasonCode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
          reasonNote: 'The handoff was started too early.',
          actorName: 'Test Admin',
          createdAt: '2026-08-22T12:00:00Z',
        },
        source: { milestone: { versionId: '2.0' } },
      }],
    }));
  render(
    <SiteVisitTab
      requestId={REQUEST_ID}
      requestNumber="1002379"
      isSuperuser
      onSelectTab={onSelectTab}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Reopen Pre-Site Draft' }));
  const submit = screen.getByRole('button', { name: 'Create Draft Successor' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF },
  });
  fireEvent.change(screen.getByLabelText('Correction note'), {
    target: { value: 'The handoff was started too early.' },
  });
  fireEvent.change(screen.getByLabelText('Type request number 1002379 to confirm'), {
    target: { value: '1002379' },
  });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/pre-site-visit/reopen',
    expect.objectContaining({
      method: 'POST',
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    }),
  ));
  const reopenCall = global.fetch.mock.calls.find(([url]) => url.endsWith('/reopen'));
  expect(JSON.parse(reopenCall[1].body)).toMatchObject({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    requestNumber: '1002379',
    reasonCode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
    reasonNote: 'The handoff was started too early.',
    clientOperationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  });
  await waitFor(() => expect(onSelectTab).toHaveBeenCalledWith('pre-site-visit'));
  expect(screen.queryByRole('dialog', { name: 'Guarded reopen' })).not.toBeInTheDocument();
});

test('a failed submit keeps one operation id and immutable audit inputs for safe retry', async () => {
  global.fetch
    .mockResolvedValueOnce(response({
      success: true,
      currentArtifact: artifact(100000001),
      pendingArtifact: null,
      reopenHistory: [],
    }))
    .mockResolvedValueOnce(response({
      error: 'The first attempt failed.',
      code: 'pre_site_reopen_copy_verification_failed',
    }, 409))
    .mockResolvedValueOnce(response({
      success: true,
      artifact: artifact(100000000),
      reused: false,
      recovered: false,
      inProgress: false,
    }))
    .mockResolvedValueOnce(response({
      success: true,
      currentArtifact: artifact(100000000),
      pendingArtifact: null,
      reopenHistory: [],
    }));
  render(<SiteVisitTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  fireEvent.click(await screen.findByRole('button', { name: 'Reopen Pre-Site Draft' }));
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF },
  });
  fireEvent.change(screen.getByLabelText('Correction note'), {
    target: { value: 'The handoff was started too early.' },
  });
  fireEvent.change(screen.getByLabelText('Type request number 1002379 to confirm'), {
    target: { value: '1002379' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create Draft Successor' }));
  expect(await screen.findByText('The first attempt failed.')).toBeInTheDocument();

  const firstCall = global.fetch.mock.calls.find(([url]) => url.endsWith('/reopen'));
  const firstOperationId = JSON.parse(firstCall[1].body).clientOperationId;
  expect(screen.getByLabelText('Reason')).toBeDisabled();
  expect(screen.getByLabelText('Correction note')).toBeDisabled();
  expect(screen.getByLabelText('Type request number 1002379 to confirm')).toBeDisabled();
  expect(screen.getByText(/keeps its original reason and confirmation/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create Draft Successor' }));

  await waitFor(() => expect(
    global.fetch.mock.calls.filter(([url]) => url.endsWith('/reopen')),
  ).toHaveLength(2));
  const secondCall = global.fetch.mock.calls.filter(([url]) => url.endsWith('/reopen'))[1];
  expect(JSON.parse(secondCall[1].body).clientOperationId).toBe(firstOperationId);
});

test('renders append-only guarded reopen history from the status contract', async () => {
  global.fetch.mockResolvedValueOnce(response({
    success: true,
    currentArtifact: artifact(100000001),
    pendingArtifact: null,
    reopenHistory: [{
      artifactId: '77777777-7777-4777-8777-777777777777',
      outcome: 'completed',
      correction: {
        cycleId: '88888888-8888-4888-8888-888888888888',
        reasonCode: PRE_SITE_REOPEN_REASON.WRONG_GOVERNED_INPUTS,
        reasonNote: 'The governed inputs were corrected after handoff.',
        actorName: 'Test Admin',
        createdAt: '2026-08-22T12:00:00Z',
      },
      source: { milestone: { versionId: '2.0' } },
    }],
  }));
  render(<SiteVisitTab requestId={REQUEST_ID} requestNumber="1002379" isSuperuser />);

  expect(await screen.findByText('Guarded reopen attempts')).toBeInTheDocument();
  expect(screen.getByText('Completed')).toBeInTheDocument();
  expect(screen.getByText('Wrong governed inputs')).toBeInTheDocument();
  expect(screen.getByText('The governed inputs were corrected after handoff.')).toBeInTheDocument();
  expect(screen.getByText(/source version 2.0/)).toBeInTheDocument();
});
