/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmailTemplatesModal from '../../shared/components/reviewers/EmailTemplatesModal';
import { requestEnvelope } from '../../shared/utils/api-request';
jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));
const templates = { invitation: { subject: 'Invitation', body: 'Use {{externalLink}}' }, materials: { subject: 'Materials', body: 'Review materials' } };
beforeEach(() => {
  jest.clearAllMocks();
  requestEnvelope.mockImplementation(async (url, options) => {
    if (options?.method === 'POST') return { ok: true, data: { success: true } };
    if (url.includes('reviewer-templates')) return { ok: true, data: { templates } };
    return { ok: true, data: { value: null } };
  });
});
test('a family save rejects an invitation without its required link', async () => {
  render(<EmailTemplatesModal onClose={() => {}} />);
  fireEvent.change(await screen.findByLabelText('Default message'), { target: { value: 'Hardcoded wording' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' }));
  expect(await screen.findByText('Invitation wording must include {{externalLink}}.')).toBeInTheDocument();
  expect(requestEnvelope.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});
test('a family save persists only the explicitly edited field and preserves inheritance', async () => {
  render(<EmailTemplatesModal onClose={() => {}} />);
  fireEvent.change(await screen.findByLabelText('Default message'), { target: { value: 'Respond via {{externalLink}}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save as my default' }));
  await waitFor(() => expect(requestEnvelope.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true));
  const [, options] = requestEnvelope.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(JSON.parse(options.body.value)).toEqual({ invitation: { body: 'Respond via {{externalLink}}' } });
  expect(await screen.findByText('Saved for future emails. The current email is unchanged.')).toBeInTheDocument();
  expect(screen.getByText('Legacy templates')).toBeInTheDocument();
});
