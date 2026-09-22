/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TestRequestPreviewSection from '../../shared/components/admin/TestRequestPreviewSection';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = 'opaque-document-id';

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

const loadedSource = {
  success: true,
  mode: 'read-only',
  executionEnabled: false,
  environment: {
    target: 'sandbox',
    hostname: 'orgd9e66399.crm.dynamics.com',
    sharePoint: {
      key: 'akoyago-shared',
      scope: 'shared',
      hostname: 'appriver3651007194.sharepoint.com',
      pathname: '/sites/akoyago',
    },
  },
  source: {
    requestId: SOURCE_ID,
    requestNumber: '1002001',
    title: 'Source title',
    applicant: 'Live University',
  },
  documents: [{
    id: DOCUMENT_ID,
    kind: 'projectDescription',
    label: 'Project Description',
    name: 'ProjectDescription.pdf',
    folder: 'Phase I',
    size: 1024,
    mimeType: 'application/pdf',
    source: 'dynamics',
    copyMode: 'copy',
  }],
  inventoryErrors: [],
  defaults: {
    recipe: 'basic',
    testLabel: 'Basic clone of Request 1002001',
    fiscalYear: 'December 2026',
    meetingDate: '2026-12-04',
  },
  filePolicy: { approved: false },
};

const previewResult = {
  ...loadedSource,
  documents: loadedSource.documents.map((document) => ({
    ...document,
    selected: true,
    previewOperation: 'blocked',
  })),
  preview: {
    planReady: false,
    blockers: [{
      code: 'FILE_POLICY_APPROVAL_REQUIRED',
      detail: 'The copy limits have not been approved.',
      scope: 'files',
    }],
    disclosures: ['Selected source files may contain confidential information.'],
    preview: {
      request: {
        authoritative: false,
        fields: [
          { field: 'akoya_title', value: 'TEST: Basic clone of Request 1002001' },
          { field: 'wmkf_istestrequest', value: true },
        ],
      },
      files: [],
    },
  },
};

beforeEach(() => {
  global.fetch.mockReset();
});

test('presents a read-only workflow with no create control', () => {
  render(<TestRequestPreviewSection />);
  expect(screen.getByText('Preview only')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load source' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /create test request/i })).not.toBeInTheDocument();
});

test('loads server inventory and posts only source identity plus browser choices', async () => {
  global.fetch
    .mockResolvedValueOnce(jsonResponse(loadedSource))
    .mockResolvedValueOnce(jsonResponse(previewResult));
  render(<TestRequestPreviewSection />);

  fireEvent.change(screen.getByLabelText('Source Request number'), { target: { value: '1002001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load source' }));

  expect(await screen.findByRole('heading', { name: 'Request 1002001' })).toBeInTheDocument();
  expect(screen.getByText('Dataverse sandbox')).toBeInTheDocument();
  expect(screen.getByText('Shared SharePoint')).toBeInTheDocument();
  expect(screen.getByLabelText('Include Project Description')).toBeChecked();
  expect(screen.getByDisplayValue('Basic clone of Request 1002001')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Build read-only preview' }));
  expect(await screen.findByRole('heading', { name: 'Preview result' })).toBeInTheDocument();
  expect(screen.getByText(/FILE_POLICY_APPROVAL_REQUIRED/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();

  const [, postOptions] = global.fetch.mock.calls[1];
  expect(postOptions.method).toBe('POST');
  expect(JSON.parse(postOptions.body)).toEqual({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [DOCUMENT_ID],
    testLabel: 'Basic clone of Request 1002001',
    fiscalYear: 'December 2026',
    meetingDate: '2026-12-04',
  });
  expect(postOptions.body).not.toContain('library');
  expect(postOptions.body).not.toContain('metadata');
  expect(postOptions.body).not.toContain('testOrganizationId');
});

test('changing the source invalidates an already rendered preview', async () => {
  global.fetch
    .mockResolvedValueOnce(jsonResponse(loadedSource))
    .mockResolvedValueOnce(jsonResponse(previewResult));
  render(<TestRequestPreviewSection />);

  fireEvent.change(screen.getByLabelText('Source Request number'), { target: { value: '1002001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load source' }));
  await screen.findByRole('heading', { name: 'Request 1002001' });
  fireEvent.click(screen.getByRole('button', { name: 'Build read-only preview' }));
  await screen.findByRole('heading', { name: 'Preview result' });

  fireEvent.change(screen.getByLabelText('Source Request number'), { target: { value: '1002002' } });
  await waitFor(() => {
    expect(screen.queryByRole('heading', { name: 'Preview result' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Request 1002001' })).not.toBeInTheDocument();
  });
});
