/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmailDefaultsSection from '../../shared/components/admin/EmailDefaultsSection';

const defaults = [
  {
    key: 'email.grantee_invite.subject',
    label: 'Grantee invite subject',
    description: 'Subject copy',
    multiline: false,
    placeholders: ['[title]'],
    value: '',
    unavailable: false,
  },
  {
    key: 'email.grantee_invite.body',
    label: 'Grantee invite body',
    description: 'Body copy',
    multiline: true,
    placeholders: ['[Name]', '[title]', 'COB [date]'],
    value: '',
    unavailable: true,
  },
];

beforeEach(() => {
  global.fetch = jest.fn(async (url, opts = {}) => {
    if (String(url) === '/api/admin/email-defaults' && !opts.method) {
      return { ok: true, json: async () => ({ defaults }) };
    }
    if (String(url) === '/api/admin/email-defaults' && opts.method === 'PUT') {
      return { ok: true, json: async () => JSON.parse(opts.body) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

test('shows blank and unavailable states distinctly and saves edited values', async () => {
  render(<EmailDefaultsSection />);

  await waitFor(() => expect(screen.getByLabelText('Grantee invite subject')).toBeInTheDocument());
  expect(screen.getByText(/blank — not configured/i)).toBeInTheDocument();
  expect(screen.getByText(/unavailable — settings read failed/i)).toBeInTheDocument();
  expect(screen.getByLabelText('Grantee invite body')).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Grantee invite subject'), { target: { value: 'Updated subject' } });
  fireEvent.click(screen.getAllByRole('button', { name: /save/i })[0]);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/email-defaults', expect.objectContaining({
    method: 'PUT',
  })));
  const putCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
  expect(JSON.parse(putCall[1].body)).toEqual({
    key: 'email.grantee_invite.subject',
    value: 'Updated subject',
  });
  await waitFor(() => expect(screen.getByText(/^Saved$/)).toBeInTheDocument());
});
