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
    key: 'email.grantee_reminder.body',
    label: 'Grantee reminder body',
    description: 'Reminder body copy',
    multiline: true,
    placeholders: [],
    group: 'grantees',
    emailKey: 'email.grantee_reminder',
    emailLabel: 'Grantee reminder',
    // Blank here is NOT one of the blocking keys — the reminder falls back
    // to a code default, so this should get the milder amber "Blank" chip.
    value: '',
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
  // The chevron must track this group's own open state, not an open ancestor's
  // (the panel wrapper is also a details/group).
  const chevron = reviewers.querySelector('summary svg');
  expect(chevron.getAttribute('class')).toContain('group-open/audience:rotate-180');
  expect(chevron.getAttribute('class')).not.toMatch(/(^|\s)group-open:rotate-180/);
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
  const card = screen.getByText('Grantee invite').closest('section');
  // Grantee invite subject/body are blocking keys (block a real send) -> red "Blank".
  expect(within(card).getByText('Blank')).toHaveClass('bg-red-50');
  expect(within(card).getByText('Unavailable')).toBeInTheDocument();
  expect(screen.getByLabelText('Grantee invite body')).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Grantee invite subject'), { target: { value: 'Updated subject' } });
  const subjectField = screen.getByLabelText('Grantee invite subject').closest('.space-y-2');
  fireEvent.click(within(subjectField).getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/email-defaults', expect.objectContaining({
    method: 'PUT',
  })));
  const putCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
  expect(JSON.parse(putCall[1].body)).toEqual({
    key: 'email.grantee_invite.subject',
    value: 'Updated subject',
  });
  expect(global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT')).toHaveLength(1);
  await waitFor(() => expect(within(subjectField).getByText(/^Saved · /)).toBeInTheDocument());
});

test('a blank non-blocking key gets the milder amber Blank chip', async () => {
  render(<EmailDefaultsSection />);
  await waitFor(() => expect(screen.getByLabelText('Grantee reminder body')).toBeInTheDocument());
  const card = screen.getByText('Grantee reminder').closest('section');
  expect(within(card).getByText('Blank')).toHaveClass('bg-amber-50');
});

test('saves only the edited field when its sibling field in the same card is available', async () => {
  render(<EmailDefaultsSection />);

  await waitFor(() => expect(screen.getByLabelText('Deliberation agenda subject')).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText('Deliberation agenda subject'), { target: { value: 'New agenda subject' } });
  const field = screen.getByLabelText('Deliberation agenda subject').closest('.space-y-2');
  fireEvent.click(within(field).getByRole('button', { name: 'Save' }));

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

test('dirty chip appears on edit, clears after save, and Save is disabled while clean', async () => {
  render(<EmailDefaultsSection />);
  await waitFor(() => expect(screen.getByLabelText('Deliberation agenda subject')).toBeInTheDocument());
  const card = screen.getByText('Deliberation agenda').closest('section');
  const field = screen.getByLabelText('Deliberation agenda subject').closest('.space-y-2');

  expect(within(card).queryByText('Unsaved changes')).toBeNull();
  const fieldSave = within(field).getByRole('button', { name: 'Save' });
  expect(fieldSave).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Deliberation agenda subject'), { target: { value: 'Edited' } });
  expect(within(card).getByText('Unsaved changes')).toBeInTheDocument();
  expect(within(field).getByRole('button', { name: 'Save' })).toBeEnabled();

  fireEvent.click(within(field).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(within(card).queryByText('Unsaved changes')).toBeNull());
  expect(within(field).getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('a failed PUT keeps the field dirty, shows the error, and does not advance savedValues', async () => {
  render(<EmailDefaultsSection />);
  await waitFor(() => expect(screen.getByLabelText('Deliberation agenda subject')).toBeInTheDocument());
  const field = screen.getByLabelText('Deliberation agenda subject').closest('.space-y-2');
  const card = screen.getByText('Deliberation agenda').closest('section');

  fireEvent.change(screen.getByLabelText('Deliberation agenda subject'), { target: { value: 'Edited' } });

  global.fetch.mockImplementationOnce(async () => ({ ok: false, json: async () => ({ error: 'Save failed.' }) }));
  fireEvent.click(within(field).getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(within(field).getByText('Save failed.')).toBeInTheDocument());
  // savedValues did not advance: the field is still dirty, so the card chip stays and Save stays enabled.
  expect(within(card).getByText('Unsaved changes')).toBeInTheDocument();
  expect(within(field).getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(screen.getByLabelText('Deliberation agenda subject')).toHaveValue('Edited');
});

test('the Saved timestamp persists across a re-render and clears on the next edit', async () => {
  const { rerender } = render(<EmailDefaultsSection />);
  await waitFor(() => expect(screen.getByLabelText('Deliberation agenda subject')).toBeInTheDocument());

  fireEvent.change(screen.getByLabelText('Deliberation agenda subject'), { target: { value: 'Edited' } });
  const field = screen.getByLabelText('Deliberation agenda subject').closest('.space-y-2');
  fireEvent.click(within(field).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(within(field).getByText(/^Saved · /)).toBeInTheDocument());

  rerender(<EmailDefaultsSection />);
  expect(within(field).getByText(/^Saved · /)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Deliberation agenda subject'), { target: { value: 'Edited again' } });
  expect(within(field).queryByText(/^Saved · /)).toBeNull();
});

test('Save all changes PUTs only dirty keys, in catalog order, and reports per-field status', async () => {
  render(<EmailDefaultsSection />);
  await waitFor(() => expect(screen.getByLabelText('Deliberation agenda subject')).toBeInTheDocument());
  const card = screen.getByText('Deliberation agenda').closest('section');

  const saveAll = within(card).getByRole('button', { name: 'Save all changes' });
  expect(saveAll).toBeDisabled();

  // Only the subject is edited — the body stays clean, so Save all must PUT
  // exactly the subject key and leave the clean body key alone.
  fireEvent.change(screen.getByLabelText('Deliberation agenda subject'), { target: { value: 'New subject' } });
  expect(saveAll).toBeEnabled();

  fireEvent.click(saveAll);

  await waitFor(() => {
    const putCalls = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT');
    expect(putCalls).toHaveLength(1);
  });
  const putCalls = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT');
  expect(putCalls.map(([, opts]) => JSON.parse(opts.body).key)).toEqual([
    'email.deliberation_agenda.subject',
  ]);
  await waitFor(() => expect(within(card).queryByText('Unsaved changes')).toBeNull());

  // Now dirty both fields, in reverse edit order, and confirm Save all still
  // PUTs them in catalog order (subject before body), not edit order.
  fireEvent.change(screen.getByLabelText('Deliberation agenda message'), { target: { value: 'New message' } });
  fireEvent.change(screen.getByLabelText('Deliberation agenda subject'), { target: { value: 'Newer subject' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Save all changes' }));
  await waitFor(() => {
    const putCalls2 = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT');
    expect(putCalls2).toHaveLength(3);
  });
  const putCalls2 = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT');
  expect(putCalls2.slice(1).map(([, opts]) => JSON.parse(opts.body).key)).toEqual([
    'email.deliberation_agenda.subject',
    'email.deliberation_agenda.body',
  ]);
});

test('registers a beforeunload guard while dirty and removes it when clean', async () => {
  const addSpy = jest.spyOn(window, 'addEventListener');
  const removeSpy = jest.spyOn(window, 'removeEventListener');
  render(<EmailDefaultsSection />);
  await waitFor(() => expect(screen.getByLabelText('Deliberation agenda subject')).toBeInTheDocument());

  expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));

  fireEvent.change(screen.getByLabelText('Deliberation agenda subject'), { target: { value: 'Edited' } });
  await waitFor(() => expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function)));

  const field = screen.getByLabelText('Deliberation agenda subject').closest('.space-y-2');
  fireEvent.click(within(field).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function)));

  addSpy.mockRestore();
  removeSpy.mockRestore();
});
