/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InitialAssessmentTab from '../../shared/components/workbench/InitialAssessmentTab';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';

const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

function readyArtifact() {
  return {
    artifactId: '44444444-4444-4444-4444-444444444444',
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    operationLabel: 'Ready',
    lifecycleLabel: 'Draft',
    attemptCount: 1,
    file: {
      name: '1003001 Initial Assessment.docx',
      webUrl: 'https://example.sharepoint.com/initial-assessment.docx',
      metadataStatus: 'current',
      versionId: '2.0',
      lastModified: '2026-07-30T18:00:00Z',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async (_url, options = {}) => {
    if ((options.method || 'GET') === 'POST') {
      return {
        ok: true,
        json: async () => ({ artifact: readyArtifact(), reused: true }),
      };
    }
    return {
      ok: true,
      json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }),
    };
  });
});

afterEach(() => {
  global.fetch = jest.fn();
  jest.useRealTimers();
});

it('lets staff refresh a Ready artifact so changed authoritative inputs can create a replacement', async () => {
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);

  expect(await screen.findByText(/Current in SharePoint · version 2\.0 · modified/))
    .toBeInTheDocument();
  const refresh = await screen.findByRole('button', {
    name: 'Refresh from current inputs',
  });
  expect(refresh).toBeEnabled();

  fireEvent.click(refresh);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/initial-assessment',
    expect.objectContaining({ method: 'POST' }),
  ));
});

it('binds version history to the artifact currently displayed', async () => {
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);

  await screen.findByText(/Current in SharePoint · version 2\.0 · modified/);
  fireEvent.click(screen.getByRole('button', { name: 'View version history' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    `/api/workbench/initial-assessment/versions?requestId=${REQUEST_ID}`
      + '&expectedArtifactId=44444444-4444-4444-4444-444444444444',
  ));
});

it('keeps restore and Board snapshot controls hidden from non-superusers', async () => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/versions?')) {
      return {
        ok: true,
        json: async () => ({
          status: 'current',
          versions: [
            { versionId: '2.0', isCurrent: true },
            { versionId: '1.0', isCurrent: false },
          ],
          hasMore: false,
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }),
    };
  });
  render(<InitialAssessmentTab requestId={REQUEST_ID} isSuperuser={false} />);
  await screen.findByText(/Current in SharePoint · version 2\.0 · modified/);
  expect(screen.queryByRole('button', { name: 'Create Board snapshot' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View version history' }));
  await screen.findByText('Version 1.0');
  expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
});

it('sends exact current-version fences when a superuser creates a Board snapshot', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  const snapshot = {
    ...readyArtifact(),
    artifactId: '55555555-5555-4555-8555-555555555555',
    lifecycleLabel: 'Board Ready',
    isBoardSnapshot: true,
    provenance: {
      sourceDocumentId: readyArtifact().artifactId,
      sourceVersionId: '2.0',
    },
    file: {
      ...readyArtifact().file,
      name: '1003001 Initial Assessment Board v2.0.docx',
      webUrl: 'https://example.sharepoint.com/board.docx',
    },
  };
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/workbench/initial-assessment/board-snapshot') {
      return { ok: true, json: async () => ({ snapshot, reused: false }) };
    }
    return {
      ok: true,
      json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }),
    };
  });
  render(<InitialAssessmentTab requestId={REQUEST_ID} isSuperuser />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create Board snapshot' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/initial-assessment/board-snapshot',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        requestId: REQUEST_ID,
        expectedArtifactId: readyArtifact().artifactId,
        expectedCurrentVersionId: '2.0',
      }),
    }),
  ));
  expect(await screen.findByText(/Source version 2\.0/)).toBeInTheDocument();
});

it('lets a superuser restore only a non-current displayed version', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  let historyReads = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).includes('/versions?')) {
      historyReads += 1;
      return {
        ok: true,
        json: async () => ({
          status: 'current',
          versions: historyReads === 1
            ? [
              { versionId: '2.0', isCurrent: true },
              { versionId: '1.0', isCurrent: false },
            ]
            : [
              { versionId: '3.0', isCurrent: true },
              { versionId: '2.0', isCurrent: false },
              { versionId: '1.0', isCurrent: false },
            ],
          hasMore: false,
        }),
      };
    }
    if (url === '/api/workbench/initial-assessment/restore-version'
      && options.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ artifact: { ...readyArtifact(), file: { ...readyArtifact().file, versionId: '3.0' } } }),
      };
    }
    return {
      ok: true,
      json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }),
    };
  });
  render(<InitialAssessmentTab requestId={REQUEST_ID} isSuperuser />);
  await screen.findByText(/Current in SharePoint · version 2\.0 · modified/);
  fireEvent.click(screen.getByRole('button', { name: 'View version history' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/initial-assessment/restore-version',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        requestId: REQUEST_ID,
        expectedArtifactId: readyArtifact().artifactId,
        targetVersionId: '1.0',
        expectedCurrentVersionId: '2.0',
      }),
    }),
  ));
  expect(await screen.findByText('Version 3.0')).toBeInTheDocument();
});

it('does not let a polling tick strand a retry in the generating state', async () => {
  jest.useFakeTimers();
  let resolvePost;
  const postResult = new Promise((resolve) => { resolvePost = resolve; });
  const generatingArtifact = {
    ...readyArtifact(),
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    operationLabel: 'Generating',
    retryable: true,
  };
  global.fetch = jest.fn(async (_url, options = {}) => {
    if ((options.method || 'GET') === 'POST') return postResult;
    return {
      ok: true,
      json: async () => ({ artifacts: [generatingArtifact], latestAttempts: [] }),
    };
  });
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  const retry = await screen.findByRole('button', { name: 'Retry draft' });

  fireEvent.click(retry);
  jest.advanceTimersByTime(5000);
  resolvePost({
    ok: true,
    json: async () => ({ artifact: readyArtifact(), reused: false }),
  });

  await waitFor(() => expect(screen.getByRole('button', {
    name: 'Refresh from current inputs',
  })).toBeEnabled());
});
