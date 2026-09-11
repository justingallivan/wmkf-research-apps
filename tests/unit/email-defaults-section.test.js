/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EmailDefaultsSection from '../../shared/components/admin/EmailDefaultsSection';

const defaults = [
  {
    key: 'email.reviewer_invitation.subject',
    label: 'Reviewer invitation subject',
    description: 'Reviewer invitation subject copy',
    multiline: false,
    placeholders: [],
    group: 'reviewers',
    emailKey: 'email.reviewer_invitation',
    emailLabel: 'Reviewer invitation',
    value: 'Please review {{proposalTitle}}',
    unavailable: false,
  },
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
    key: 'email.grantee_reminder.subject',
    label: 'Grantee reminder subject',
    description: 'Reminder subject copy',
    multiline: false,
    placeholders: [],
    group: 'grantees',
    emailKey: 'email.grantee_reminder',
    emailLabel: 'Grantee reminder',
    value: 'Reminder about {{proposalTitle}}',
    unavailable: false,
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
  {
    key: 'email.deliberation_agenda.body',
    label: 'Deliberation agenda message',
    description: 'Agenda opening message copy',
    multiline: true,
    placeholders: ['{{sessionDate}}'],
    group: 'internal',
    emailKey: 'email.deliberation_agenda',
    emailLabel: 'Deliberation agenda',
    value: 'Opening message',
    unavailable: false,
  },
  {
    key: 'stage.deliberations.draft',
    label: 'Deliberations stage label: draft',
    description: 'Stage label copy',
    multiline: false,
    placeholders: [],
    group: 'labels',
    emailKey: 'stage.deliberations',
    emailLabel: 'Staff Deliberations stage labels',
    value: 'AI draft ready',
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
  expect(headings).toEqual(['Reviewer emails', 'Grantee emails', 'Internal emails', 'Staff labels']);
});

test('groups are collapsed by default and open independently', async () => {
  render(<EmailDefaultsSection />);
  await screen.findByText('Reviewer emails');
  const groups = Array.from(document.querySelectorAll('details'));
  expect(groups).toHaveLength(4);
  expect(groups.every((group) => !group.open)).toBe(true);
  const reviewers = screen.getByText('Reviewer emails').closest('details');
  fireEvent.click(reviewers.querySelector('summary'));
  expect(reviewers.open).toBe(true);
  expect(screen.getByText('Grantee emails').closest('details').open).toBe(false);
});

test('pairs subject and body of one email inside the same card, and does not mix cards within a group', async () => {
  render(<EmailDefaultsSection />);

  await waitFor(() => expect(screen.getByLabelText('Grantee invite subject')).toBeInTheDocument());

  const inviteCard = screen.getByText('Grantee invite').closest('section');
  expect(within(inviteCard).getByLabelText('Grantee invite subject')).toBeInTheDocument();
  expect(within(inviteCard).getByLabelText('Grantee invite body')).toBeInTheDocument();
  // The reminder email is a separate card in the same group; its field must not leak into the invite card.
  expect(within(inviteCard).queryByLabelText('Grantee reminder subject')).toBeNull();

  // Card order within the grantees group follows catalog order (invite before reminder).
  const cardTitles = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
  const granteeCardOrder = cardTitles.filter((t) => t === 'Grantee invite' || t === 'Grantee reminder');
  expect(granteeCardOrder).toEqual(['Grantee invite', 'Grantee reminder']);
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

test('saves only the edited field when its sibling field in the same card is available', async () => {
  render(<EmailDefaultsSection />);

  await waitFor(() => expect(screen.getByLabelText('Deliberation agenda subject')).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText('Deliberation agenda subject'), { target: { value: 'New agenda subject' } });
  const card = screen.getByText('Deliberation agenda').closest('section');
  // The agenda card has two available fields (subject, body); click the first (subject's) Save.
  fireEvent.click(within(card).getAllByRole('button', { name: /save/i })[0]);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/email-defaults', expect.objectContaining({
    method: 'PUT',
  })));
  const putCalls = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT');
  expect(putCalls).toHaveLength(1);
  expect(JSON.parse(putCalls[0][1].body)).toEqual({
    key: 'email.deliberation_agenda.subject',
    value: 'New agenda subject',
  });
});
