/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmailTemplatesModal from '../../shared/components/reviewers/EmailTemplatesModal';
import { loadEmailTemplates, loadAdminTemplateDefaults, saveEmailTemplates } from '../../shared/components/reviewers/email-template-store';

jest.mock('../../shared/components/reviewers/email-template-store', () => ({
  TEMPLATE_TYPES: ['invitation'],
  TEMPLATE_TYPE_LABELS: { invitation: 'Invitation' },
  loadEmailTemplates: jest.fn(),
  loadAdminTemplateDefaults: jest.fn(),
  saveEmailTemplates: jest.fn(),
}));

const templates = (body) => ({ invitation: { subject: 'Invitation', body } });

beforeEach(() => {
  jest.clearAllMocks();
  loadAdminTemplateDefaults.mockResolvedValue(templates('Use {{externalLink}}'));
  saveEmailTemplates.mockResolvedValue(true);
});

test('Save templates rejects an invitation without {{externalLink}}', async () => {
  loadEmailTemplates.mockResolvedValue(templates('Use a hardcoded link instead.'));
  render(<EmailTemplatesModal onClose={() => {}} />);
  const save = await screen.findByRole('button', { name: 'Save templates' });
  await waitFor(() => expect(save).not.toBeDisabled());
  fireEvent.click(save);
  expect(await screen.findByText('Invitation templates must include {{externalLink}} in the subject or body.')).toBeTruthy();
  expect(saveEmailTemplates).not.toHaveBeenCalled();
});

test('Save templates accepts an invitation containing {{externalLink}}', async () => {
  const valid = templates('Use {{externalLink}} to respond.');
  loadEmailTemplates.mockResolvedValue(valid);
  render(<EmailTemplatesModal onClose={() => {}} />);
  const save = await screen.findByRole('button', { name: 'Save templates' });
  await waitFor(() => expect(save).not.toBeDisabled());
  fireEvent.click(save);
  await waitFor(() => expect(saveEmailTemplates).toHaveBeenCalledWith(valid));
  expect(await screen.findByText('Saved ✓')).toBeTruthy();
});
