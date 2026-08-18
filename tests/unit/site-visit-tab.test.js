/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SiteVisitTab from '../../shared/components/workbench/SiteVisitTab';

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

  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('same SharePoint file'));
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

