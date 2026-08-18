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
    reviewerMaterials: [
      {
        library: 'akoya_request',
        folder: `${ROOT}/Reviewer Materials`,
        name: 'Proposal_1002379.pdf',
        mimeType: 'application/pdf',
      },
    ],
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
    phaseIIDocuments: [
      {
        library: 'akoya_request',
        folder: `${ROOT}/Phase II`,
        name: 'Proposal_1002379.pdf',
        mimeType: 'application/pdf',
      },
    ],
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

test('renders Reviewer Materials first, followed by canonical AI Materials, with scoped view and download links', async () => {
  render(<ProposalTab context={context} />);

  await waitFor(() => expect(screen.getByText('Proposal Narrative')).toBeInTheDocument());
  const reviewerHeading = screen.getByText('Reviewer Materials');
  const aiHeading = screen.getByText('AI Materials');
  expect(reviewerHeading.compareDocumentPosition(aiHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('AI Materials')).toBeInTheDocument();
  expect(screen.getByText('Phase I documents')).toBeInTheDocument();
  expect(screen.getByText('Phase II documents')).toBeInTheDocument();
  expect(screen.queryByText('Some document folders couldn’t be read.')).not.toBeInTheDocument();

  const narrativeRow = screen.getByText('Proposal Narrative').closest('li');
  const view = within(narrativeRow).getByRole('link', { name: 'View' });
  const download = within(narrativeRow).getByRole('link', { name: 'Download' });
  expect(view).toHaveAttribute('href', expect.stringContaining('ProposalNarrative_1002379.pdf'));
  expect(view).toHaveAttribute('href', expect.stringContaining('disposition=inline'));
  expect(download).toHaveAttribute('href', expect.stringContaining('ProposalNarrative_1002379.pdf'));

  const reviewerSection = reviewerHeading.parentElement;
  const reviewerRow = within(reviewerSection).getByText('Proposal_1002379.pdf').closest('li');
  expect(within(reviewerRow).getByRole('link', { name: 'View' }))
    .toHaveAttribute('href', expect.stringContaining('Reviewer+Materials'));
  expect(within(reviewerRow).getByRole('link', { name: 'Download' }))
    .toHaveAttribute('href', expect.stringContaining('Proposal_1002379.pdf'));

  const phaseIISection = screen.getByText('Phase II documents').parentElement;
  const phaseIIRow = within(phaseIISection).getByText('Proposal_1002379.pdf').closest('li');
  const phaseIIView = within(phaseIIRow).getByRole('link', { name: 'View' });
  const phaseIIViewUrl = new URL(phaseIIView.getAttribute('href'), 'http://localhost');
  expect(phaseIIViewUrl.searchParams.get('folder')).toBe(`${ROOT}/Phase II`);
  expect(within(phaseIIRow).getByRole('link', { name: 'Download' }))
    .toHaveAttribute('href', expect.stringContaining('Proposal_1002379.pdf'));
});

test('shows a clear empty state when no Reviewer Materials document exists', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => responseBody({ reviewerMaterials: [] }),
  });

  render(<ProposalTab context={context} />);

  const heading = await screen.findByText('Reviewer Materials');
  expect(within(heading.parentElement).getByText('No documents found.')).toBeInTheDocument();
});

test('shows a clear empty state when no Phase II documents exist', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => responseBody({ phaseIIDocuments: [] }),
  });

  render(<ProposalTab context={context} />);

  await waitFor(() => expect(screen.getByText('Phase II documents')).toBeInTheDocument());
  expect(screen.getByText('No documents found.')).toBeInTheDocument();
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
