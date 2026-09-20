/**
 * @jest-environment jsdom
 *
 * ArtifactVersionHistory — T5 gap-fill (Stage 5a). tests/unit/artifact-
 * version-history.test.js pins loadHistory's 2xx/409/500 branches; tests/
 * unit/initial-assessment-tab.test.js pins restore's 2xx and request bytes
 * through the parent tab. This file adds network rejection and axis (e)
 * for both fetch sites.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArtifactVersionHistory from '../../shared/components/workbench/ArtifactVersionHistory';
import InitialAssessmentTab from '../../shared/components/workbench/InitialAssessmentTab';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';

const REQUEST_ID = '33333333-3333-3333-3333-333333333333';
const ARTIFACT_ID = '44444444-4444-4444-4444-444444444444';
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

function readyArtifact() {
  return {
    artifactId: ARTIFACT_ID,
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    operationLabel: 'Ready',
    lifecycleLabel: 'Draft',
    attemptCount: 1,
    file: { name: 'x.docx', webUrl: 'https://example.sharepoint.com/x.docx', metadataStatus: 'current', versionId: '2.0', lastModified: '2026-07-30T18:00:00Z' },
  };
}

afterEach(() => jest.restoreAllMocks());

test('loadHistory: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<ArtifactVersionHistory requestId={REQUEST_ID} expectedArtifactId={ARTIFACT_ID} />);
  await userEvent.click(screen.getByRole('button', { name: 'View version history' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('loadHistory axis (e): non-2xx unparseable body falls to the status fallback, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<ArtifactVersionHistory requestId={REQUEST_ID} expectedArtifactId={ARTIFACT_ID} />);
  await userEvent.click(screen.getByRole('button', { name: 'View version history' }));
  expect(await screen.findByText('Failed to load version history (502)')).toBeInTheDocument();
});

async function readyWithHistoryOpen(postHandler) {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (String(url).includes('/versions?')) {
      return {
        ok: true, status: 200,
        json: async () => ({ status: 'current', hasMore: false, versions: [{ versionId: '2.0', isCurrent: true }, { versionId: '1.0', isCurrent: false }] }),
      };
    }
    if (String(url) === '/api/workbench/initial-assessment/restore-version' && options.method === 'POST') {
      return postHandler(options);
    }
    return { ok: true, status: 200, json: async () => ({ artifacts: [readyArtifact()], latestAttempts: [], milestones: [] }) };
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<InitialAssessmentTab requestId={REQUEST_ID} isSuperuser />);
  await screen.findByText(/Current in SharePoint · version 2\.0 · modified/);
  await userEvent.click(screen.getByRole('button', { name: 'View version history' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));
}

test('restore: network rejection is never silent', async () => {
  await readyWithHistoryOpen(() => Promise.reject(new Error('offline')));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('restore axis (e): non-2xx unparseable body falls to the status fallback, never silent', async () => {
  await readyWithHistoryOpen(() => Promise.resolve({ ok: false, status: 502, json: unparseable }));
  expect(await screen.findByText('Version restore failed (502)')).toBeInTheDocument();
});
