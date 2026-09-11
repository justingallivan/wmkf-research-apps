/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EmailDefaultsSection from '../../shared/components/admin/EmailDefaultsSection';

const defaults = [
  {
    key: 'email.grantee_invite.subject',
    label: 'Grantee invite subject',
    description: 'Subject copy',
    multiline: false,
    placeholders: ['[title]'],
    group: 'grantees',
    emailKey: 'email.grantee_invite',
    emailLabel: 'Grantee invite',
    value: '',
    unavailable: false,
  },
  {
    key: 'email.grantee_invite.body',
    label: 'Grantee invite body',
    description: 'Body copy',
    multiline: true,
    placeholders: ['[Name]', '[title]', 'COB [date]'],
    group: 'grantees',
    emailKey: 'email.grantee_invite',
    emailLabel: 'Grantee invite',
    value: '',
    unavailable: true,
  },
  {
    key: 'email.deliberation_agenda.subject',
    label: 'Deliberation agenda subject',
    description: 'Agenda subject copy',
    multiline: false,
    placeholders: ['{{sessionDate}}'],
    group: 'internal',
    emailKey: 'email.deliberation_agenda',
    emailLabel: 'Deliberation agenda',
    value: 'Agenda for {{sessionDate}}',
    unavailable: false,
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

test('renders group headings in order', async () => {
  render(<EmailDefaultsSection />);

  await waitFor(() => expect(screen.getByLabelText('Grantee invite subject')).toBeInTheDocument());

  const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  expect(headings).toEqual(['Grantee emails', 'Internal emails']);
});

test('pairs subject and body of one email inside the same card', async () => {
  render(<EmailDefaultsSection />);

  await waitFor(() => expect(screen.getByLabelText('Grantee invite subject')).toBeInTheDocument());

  const card = screen.getByText('Grantee invite').closest('section');
  expect(within(card).getByLabelText('Grantee invite subject')).toBeInTheDocument();
  expect(within(card).getByLabelText('Grantee invite body')).toBeInTheDocument();
});

test('shows blank and unavailable states distinctly and saves edited values', async () => {
  render(<EmailDefaultsSection />);

  await waitFor(() => expect(screen.getByLabelText('Grantee invite subject')).toBeInTheDocument());
  expect(screen.getByText(/blank — not configured/i)).toBeInTheDocument();
  expect(screen.getByText(/unavailable — settings read failed/i)).toBeInTheDocument();
  expect(screen.getByLabelText('Grantee invite body')).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Grantee invite subject'), { target: { value: 'Updated subject' } });
  const card = screen.getByText('Grantee invite').closest('section');
  fireEvent.click(within(card).getAllByRole('button', { name: /save/i })[0]);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/email-defaults', expect.objectContaining({
    method: 'PUT',
  })));
  const putCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
  expect(JSON.parse(putCall[1].body)).toEqual({
    key: 'email.grantee_invite.subject',
    value: 'Updated subject',
  });
  expect(global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT')).toHaveLength(1);
  await waitFor(() => expect(screen.getByText(/^Saved$/)).toBeInTheDocument());
});
