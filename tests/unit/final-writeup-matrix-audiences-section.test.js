/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FinalWriteupMatrixAudiencesSection from '../../shared/components/admin/FinalWriteupMatrixAudiencesSection';

jest.mock('next/router', () => ({
  useRouter: () => ({ beforePopState: jest.fn() }),
}));

const RESEARCH_ID = '10000000-0000-4000-8000-000000000001';
const SOCAL_ID = '10000000-0000-4000-8000-000000000002';
const ADA_ID = '20000000-0000-4000-8000-000000000001';
const ANNELI_ID = '20000000-0000-4000-8000-000000000002';
const SASKIA_ID = '20000000-0000-4000-8000-000000000003';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function state(overrides = {}) {
  return {
    success: true,
    configured: false,
    revision: null,
    config: { version: 1, programs: [] },
    programs: [
      { grantProgramId: RESEARCH_ID, name: 'Research' },
      { grantProgramId: SOCAL_ID, name: 'Southern California' },
    ],
    reviewers: [
      { reviewerId: ADA_ID, name: 'Ada Reviewer', initials: 'AR' },
      { reviewerId: ANNELI_ID, name: 'Anneli Stone', initials: 'AS' },
      { reviewerId: SASKIA_ID, name: 'Saskia Pallais', initials: 'SP' },
    ],
    staleReferences: { grantProgramIds: [], reviewerIds: [] },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

afterEach(() => jest.restoreAllMocks());

test('builds a Research audience from the live role roster and publishes explicit exclusions', async () => {
  global.fetch
    .mockResolvedValueOnce(response(state()))
    .mockResolvedValueOnce(response(state({
      configured: true,
      config: { version: 1, programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] }] },
    })));

  render(<FinalWriteupMatrixAudiencesSection />);

  expect(await screen.findByText(/matrix is still using the reviewer-role default/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Add a Grant Program audience'), {
    target: { value: RESEARCH_ID },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add program' }));

  expect(screen.getByRole('heading', { name: 'Research' })).toBeInTheDocument();
  expect(screen.getByLabelText(/Ada Reviewer/)).toBeChecked();
  expect(screen.getByLabelText(/Anneli Stone/)).toBeChecked();
  expect(screen.getByLabelText(/Saskia Pallais/)).toBeChecked();

  fireEvent.click(screen.getByLabelText(/Anneli Stone/));
  fireEvent.click(screen.getByLabelText(/Saskia Pallais/));
  fireEvent.click(screen.getByRole('button', { name: 'Publish audiences' }));

  await waitFor(() => expect(global.fetch).toHaveBeenNthCalledWith(
    2,
    '/api/admin/final-writeup-matrix-audiences',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        config: {
          version: 1,
          programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] }],
        },
        expectedRevision: null,
      }),
    }),
  ));
  expect(await screen.findByText(/program audiences published/i)).toBeInTheDocument();
});

test('keeps a stale draft visible when another administrator publishes first', async () => {
  global.fetch
    .mockResolvedValueOnce(response(state({ revision: 'W/"7"' })))
    .mockResolvedValueOnce(response({
      error: 'Another administrator published matrix audience changes after this page loaded. Reload and review the current configuration before publishing again.',
      code: 'final_writeup_matrix_audience_revision_conflict',
    }, 409));

  render(<FinalWriteupMatrixAudiencesSection />);
  await screen.findByText(/reviewer-role default/i);
  fireEvent.change(screen.getByLabelText('Add a Grant Program audience'), {
    target: { value: RESEARCH_ID },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add program' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publish audiences' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/another administrator published/i);
  expect(screen.getByRole('heading', { name: 'Research' })).toBeInTheDocument();
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toMatchObject({ expectedRevision: 'W/"7"' });
});

test('does not allow publishing a configured program with no reviewers', async () => {
  global.fetch.mockResolvedValueOnce(response(state({
    configured: true,
    config: {
      version: 1,
      programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] }],
    },
  })));
  render(<FinalWriteupMatrixAudiencesSection />);

  const ada = await screen.findByLabelText(/Ada Reviewer/);
  fireEvent.click(ada);

  expect(screen.getByText(/select at least one reviewer/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Publish audiences' })).toBeDisabled();
});
