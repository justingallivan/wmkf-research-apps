/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import ProposalTab from '../../shared/components/workbench/ProposalTab';

const REQUEST_ID = '54e2b88b-04b9-f011-bbd3-6045bd02b4cc';
const ROOT = '1002379_54E2B88B04B9F011BBD36045BD02B4CC';

const context = {
  requestId: REQUEST_ID,
  proposalInfo: { coPIs: [] },
  aiContent: {},
};

function responseBody(overrides = {}) {
  return {
    success: true,
    aiMaterials: [
      {
        key: 'proposalNarrative',
        label: 'Proposal Narrative',
        filename: 'ProposalNarrative_1002379.pdf',
        found: true,
        library: 'akoya_request',
        folder: `${ROOT}/AI Materials`,
        name: 'ProposalNarrative_1002379.pdf',
        mimeType: 'application/pdf',
      },
      {
        key: 'proposalBibliography',
        label: 'Proposal Bibliography',
        filename: 'ProposalBibliography_1002379.pdf',
        found: true,
        library: 'akoya_request',
        folder: `${ROOT}/AI Materials`,
        name: 'ProposalBibliography_1002379.pdf',
        mimeType: 'application/pdf',
      },
    ],
    slots: [{ key: 'projectDescription', label: 'Project Description', found: false }],
    otherDocuments: [],
    errors: [],
    ...overrides,
  };
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => responseBody(),
  });
});

test('renders canonical AI Materials separately with scoped view and download links', async () => {
  render(<ProposalTab context={context} />);

  await waitFor(() => expect(screen.getByText('Proposal Narrative')).toBeInTheDocument());
  expect(screen.getByText('AI Materials')).toBeInTheDocument();
  expect(screen.getByText('Phase I documents')).toBeInTheDocument();
  expect(screen.queryByText('Some document folders couldn’t be read.')).not.toBeInTheDocument();

  const narrativeRow = screen.getByText('Proposal Narrative').closest('li');
  const view = within(narrativeRow).getByRole('link', { name: 'View' });
  const download = within(narrativeRow).getByRole('link', { name: 'Download' });
  expect(view).toHaveAttribute('href', expect.stringContaining('ProposalNarrative_1002379.pdf'));
  expect(view).toHaveAttribute('href', expect.stringContaining('disposition=inline'));
  expect(download).toHaveAttribute('href', expect.stringContaining('ProposalNarrative_1002379.pdf'));
});

test('still warns when the API reports a real folder-read failure', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => responseBody({
      errors: [{ library: 'akoya_request', folder: ROOT }],
    }),
  });

  render(<ProposalTab context={context} />);

  await waitFor(() => {
    expect(screen.getByText('Some document folders couldn’t be read.')).toBeInTheDocument();
  });
});
