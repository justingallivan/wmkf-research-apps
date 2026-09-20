/**
 * @jest-environment jsdom
 *
 * InitialAssessmentTab — T5 gap-fill (Stage 5a). tests/unit/initial-
 * assessment-tab.test.js already pins 2xx success and request shape for
 * this file's 4 fetch sites (load, poll, generate, createBoardSnapshot),
 * all bare-`.json().catch(() => ({}))` migrated to requestJson with
 * `tolerantBody: true`. This file adds network-rejection and axis-(e)
 * coverage.
 *
 * Parse-error policy / D3 note: each site's original fallback interpolated
 * the HTTP status (e.g. `Failed to load artifact (${response.status})`).
 * `requestJson`'s `fallbackMessage` is a static string, so the migrated
 * fallback text drops the status suffix (`'Failed to load artifact'`) —
 * the same accepted D3 deviation Stage 3 recorded at the four `pages/admin.js`
 * fallback sites: user-visible, never silent, not the raw parse text.
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

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('load: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('load axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  expect(await screen.findByText('Failed to load artifact')).toBeInTheDocument();
});

async function readyPanel() {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }) });
  render(<InitialAssessmentTab requestId={REQUEST_ID} />);
  await screen.findByText(/Current in SharePoint/);
}

test('generate: network rejection is never silent', async () => {
  await readyPanel();
  global.fetch = jest.fn((url, opts) => (
    (opts?.method === 'POST')
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh from current inputs' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('generate axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  await readyPanel();
  global.fetch = jest.fn((url, opts) => (
    (opts?.method === 'POST')
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh from current inputs' }));
  expect(await screen.findByText('Generation failed')).toBeInTheDocument();
});

async function readyPanelSuperuser() {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) });
  render(<InitialAssessmentTab requestId={REQUEST_ID} isSuperuser />);
  await screen.findByText(/Current in SharePoint/);
  jest.spyOn(window, 'confirm').mockReturnValue(true);
}

test('createBoardSnapshot: network rejection is never silent', async () => {
  await readyPanelSuperuser();
  global.fetch = jest.fn((url) => (
    String(url).includes('board-snapshot')
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create Board snapshot' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('createBoardSnapshot axis (e): non-2xx unparseable body falls to the fallback text, never silent', async () => {
  await readyPanelSuperuser();
  global.fetch = jest.fn((url) => (
    String(url).includes('board-snapshot')
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve({ ok: true, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) })
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Create Board snapshot' }));
  expect(await screen.findByText('Board snapshot failed')).toBeInTheDocument();
});
