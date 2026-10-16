/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DefaultFacilitatorSettings from '../../shared/components/proposal-ranking/DefaultFacilitatorSettings';
import { requestEnvelope } from '../../shared/utils/api-request';

jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));

const settings = {
  facilitatorSystemUserIds: ['justin'],
  facilitatorNames: ['Justin Gallivan'],
  configured: true,
  configurationError: false,
  revision: 'r1',
  eligibleStaff: [{ systemUserId: 'beth', name: 'Beth Pruitt' }, { systemUserId: 'justin', name: 'Justin Gallivan' }],
};

afterEach(() => jest.resetAllMocks());

test('a superuser sees the facilitator form loaded from the settings API', async () => {
  requestEnvelope.mockImplementation(async (url) => (url === '/api/app-access'
    ? { ok: true, status: 200, data: { apps: [], isSuperuser: true } }
    : { ok: true, status: 200, data: settings }));
  render(<DefaultFacilitatorSettings />);
  expect(await screen.findByRole('option', { name: 'Beth Pruitt' })).toBeTruthy();
  expect(screen.getByText('Current facilitators: Justin Gallivan')).toBeTruthy();
  expect(requestEnvelope.mock.calls.map(([url]) => url)).toEqual(['/api/app-access', '/api/admin/proposal-ranking-facilitator']);
});

test('a non-superuser sees nothing and the settings API is never called', async () => {
  requestEnvelope.mockResolvedValue({ ok: true, status: 200, data: { apps: ['proposal-ranking'], isSuperuser: false } });
  const { container } = render(<DefaultFacilitatorSettings />);
  await waitFor(() => expect(requestEnvelope).toHaveBeenCalledTimes(1));
  expect(container.innerHTML).toBe('');
});
