/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function personas() {
  return [
    { reviewerId: ADA_ID, roles: ['program-director'] },
    { reviewerId: ANNELI_ID, roles: ['program-director'] },
    { reviewerId: SASKIA_ID, roles: [] },
  ];
}

function state(overrides = {}) {
  return {
    success: true,
    configured: false,
    storedVersion: null,
    migrationRequired: false,
    revision: null,
    config: { version: 2, personas: personas(), programs: [] },
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
    unassignedReviewerIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

afterEach(() => jest.restoreAllMocks());

test('publishes responsibilities and a Research audience through one v2 replacement', async () => {
  global.fetch
    .mockResolvedValueOnce(response(state()))
    .mockResolvedValueOnce(response(state({
      configured: true,
      storedVersion: 2,
      revision: 'W/"2"',
      config: {
        version: 2,
        personas: personas(),
        programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] }],
      },
    })));

  render(<FinalWriteupMatrixAudiencesSection />);
  expect(await screen.findByText(/staffing has not been published/i)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Staff responsibilities' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Program review audiences' })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Add a Grant Program audience'), {
    target: { value: RESEARCH_ID },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add program' }));
  expect(screen.getByRole('heading', { name: 'Research' })).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/Anneli Stone/));
  fireEvent.click(screen.getByLabelText(/Saskia Pallais/));
  fireEvent.click(screen.getByRole('button', { name: 'Publish Final Writeup staffing' }));

  await waitFor(() => expect(global.fetch).toHaveBeenNthCalledWith(
    2,
    '/api/admin/final-writeup-matrix-audiences',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        config: {
          version: 2,
          personas: personas(),
          programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] }],
        },
        expectedRevision: null,
      }),
    }),
  ));
  expect(await screen.findByText(/responsibilities and program audiences now share this revision/i)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Publish/ })).toHaveLength(1);
});

test('a v1 migration draft is publishable without changing the preserved program audience', async () => {
  const migration = state({
    configured: true,
    storedVersion: 1,
    migrationRequired: true,
    revision: 'W/"7"',
    config: {
      version: 2,
      personas: personas(),
      programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] }],
    },
  });
  global.fetch
    .mockResolvedValueOnce(response(migration))
    .mockResolvedValueOnce(response(state({
      ...migration,
      storedVersion: 2,
      migrationRequired: false,
      revision: 'W/"8"',
    })));

  render(<FinalWriteupMatrixAudiencesSection />);
  expect(await screen.findByText(/still stored as version 1/i)).toBeInTheDocument();
  expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Publish Final Writeup staffing' }));

  await waitFor(() => expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
    config: {
      version: 2,
      personas: personas(),
      programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] }],
    },
    expectedRevision: 'W/"7"',
  }));
});

test('missing staff rows block publication until No persona lens is explicitly selected', async () => {
  global.fetch.mockResolvedValueOnce(response(state({
    configured: true,
    storedVersion: 2,
    revision: 'W/"4"',
    config: {
      version: 2,
      personas: [{ reviewerId: ADA_ID, roles: ['program-director'] }],
      programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] }],
    },
    unassignedReviewerIds: [ANNELI_ID, SASKIA_ID],
  })));

  render(<FinalWriteupMatrixAudiencesSection />);
  expect(await screen.findByText(/choose at least one responsibility/i)).toBeInTheDocument();
  const publish = screen.getByRole('button', { name: 'Publish Final Writeup staffing' });
  expect(publish).toBeDisabled();

  fireEvent.click(within(screen.getByRole('group', { name: /Responsibilities for Anneli Stone/ }))
    .getByLabelText('No persona lens'));
  fireEvent.click(within(screen.getByRole('group', { name: /Responsibilities for Saskia Pallais/ }))
    .getByLabelText('No persona lens'));
  expect(publish).toBeEnabled();
});

test('stale conflict keeps the complete local draft retryable', async () => {
  global.fetch
    .mockResolvedValueOnce(response(state({
      configured: true,
      storedVersion: 2,
      revision: 'W/"7"',
      config: {
        version: 2,
        personas: personas(),
        programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] }],
      },
    })))
    .mockResolvedValueOnce(response({
      error: 'Another administrator published Final Writeup staffing changes after this state was loaded. Reload and review before publishing again.',
      code: 'final_writeup_staffing_revision_conflict',
    }, 409));

  render(<FinalWriteupMatrixAudiencesSection />);
  const ada = await screen.findByRole('group', { name: /Responsibilities for Ada Reviewer/ });
  fireEvent.click(within(ada).getByLabelText('Leadership'));
  fireEvent.click(screen.getByRole('button', { name: 'Publish Final Writeup staffing' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/another administrator published/i);
  expect(within(ada).getByLabelText('Leadership')).toBeChecked();
  expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toMatchObject({ expectedRevision: 'W/"7"' });
});

test('configured program with no reviewers remains visibly invalid and cannot publish', async () => {
  global.fetch.mockResolvedValueOnce(response(state({
    configured: true,
    storedVersion: 2,
    revision: 'W/"3"',
    config: {
      version: 2,
      personas: personas(),
      programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] }],
    },
  })));
  render(<FinalWriteupMatrixAudiencesSection />);
  fireEvent.click(await screen.findByLabelText(/Ada Reviewer/));
  expect(screen.getByText(/select at least one reviewer/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Publish Final Writeup staffing' })).toBeDisabled();
});
