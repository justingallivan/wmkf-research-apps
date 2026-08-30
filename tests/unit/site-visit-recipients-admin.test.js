/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SiteVisitRecipientsSection from '../../shared/components/admin/SiteVisitRecipientsSection';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

afterEach(() => jest.restoreAllMocks());

test('selects active staff, searches existing Contacts, and saves reference-only config', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    if (options.method === 'PUT') {
      const config = JSON.parse(options.body).config;
      return response({
        success: true,
        config,
        entries: [
          {
            kind: 'staff',
            profileId: 7,
            key: 'staff:7',
            category: 'staff',
            name: 'Alice Staff',
            email: 'alice@example.org',
            available: true,
          },
          {
            kind: 'contact',
            contactId: CONTACT_ID,
            key: 'contact:' + CONTACT_ID,
            category: 'consultant',
            name: 'Casey Consultant',
            email: 'casey@example.org',
            available: true,
          },
        ],
      });
    }
    if (String(url).includes('?search=')) {
      return response({
        success: true,
        contacts: [{
          contactId: CONTACT_ID,
          name: 'Casey Consultant',
          email: 'casey@example.org',
          available: true,
          reason: null,
        }],
      });
    }
    return response({
      success: true,
      config: { version: 1, entries: [] },
      entries: [],
      staff: [{
        kind: 'staff',
        profileId: 7,
        key: 'staff:7',
        category: 'staff',
        name: 'Alice Staff',
        email: 'alice@example.org',
        available: true,
      }],
    });
  });

  render(<SiteVisitRecipientsSection />);
  const alice = await screen.findByRole('checkbox', { name: /Alice Staff/ });
  fireEvent.click(alice);
  fireEvent.change(screen.getByLabelText('Find a Dataverse Contact'), { target: { value: 'Casey' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add as Consultant' }));
  expect(screen.getAllByText('Added — unsaved')).toHaveLength(2);
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await screen.findByText('Recipient changes saved.');
  expect(screen.getByText('All changes saved')).toBeInTheDocument();
  expect(screen.getByText('Included in recipient menu')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Already saved' })).toBeDisabled();
  const saveCall = global.fetch.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(saveCall[1].body)).toEqual({
    config: {
      version: 1,
      entries: [
        { kind: 'staff', profileId: 7 },
        { kind: 'contact', contactId: CONTACT_ID, category: 'consultant' },
      ],
    },
  });
  expect(saveCall[1].body).not.toContain('Alice');
  expect(saveCall[1].body).not.toContain('@');
  expect(global.fetch.mock.calls.every(([, options]) => !options?.method || ['GET', 'PUT'].includes(options.method))).toBe(true);
});

test('discloses the bounded 50-result Contact search and clears the warning when the query changes', async () => {
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('?search=')) {
      return response({
        success: true,
        contacts: [{
          contactId: CONTACT_ID,
          name: 'Casey Harris',
          email: 'casey@example.org',
          available: true,
          reason: null,
        }],
        truncated: true,
        limit: 50,
      });
    }
    return response({
      success: true,
      config: { version: 1, entries: [] },
      entries: [],
      staff: [],
      maxEntries: 50,
    });
  });

  render(<SiteVisitRecipientsSection />);
  const input = await screen.findByLabelText('Find a Dataverse Contact');
  fireEvent.change(input, { target: { value: 'Harris' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText('Showing the first 50 matches. Refine the search to see other Contacts.')).toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'Harrison' } });
  expect(screen.queryByText(/Showing the first 50 matches/)).not.toBeInTheDocument();
});

test('shows a stale saved Contact and lets the admin remove it before saving', async () => {
  global.fetch = jest.fn(async (_url, options = {}) => {
    if (options.method === 'PUT') {
      return response({ success: true, config: { version: 1, entries: [] }, entries: [] });
    }
    return response({
      success: true,
      config: {
        version: 1,
        entries: [{ kind: 'contact', contactId: CONTACT_ID, category: 'board' }],
      },
      entries: [{
        kind: 'contact',
        contactId: CONTACT_ID,
        key: 'contact:' + CONTACT_ID,
        category: 'board',
        available: false,
        reason: 'contact_email_missing',
        detail: 'The Dataverse Contact has no valid primary email address.',
      }],
      staff: [],
    });
  });

  render(<SiteVisitRecipientsSection />);
  expect(await screen.findByText(/no valid primary email/i)).toBeInTheDocument();
  expect(screen.getByText('Saved but unavailable')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove from directory' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/admin/site-visit-recipients',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ config: { version: 1, entries: [] } }),
    }),
  ));
});

test('shows a stale saved staff profile and lets the admin remove it before saving', async () => {
  global.fetch = jest.fn(async (_url, options = {}) => {
    if (options.method === 'PUT') {
      return response({ success: true, config: { version: 1, entries: [] }, entries: [] });
    }
    return response({
      success: true,
      config: { version: 1, entries: [{ kind: 'staff', profileId: 99 }] },
      entries: [{
        kind: 'staff',
        profileId: 99,
        key: 'staff:99',
        available: false,
        reason: 'staff_unavailable',
        detail: 'The app profile is inactive or is not linked exactly to an enabled Dataverse user.',
      }],
      staff: [],
    });
  });

  render(<SiteVisitRecipientsSection />);
  expect(await screen.findByText('Unavailable staff profile')).toBeInTheDocument();
  expect(screen.getByText(/inactive or is not linked exactly/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/admin/site-visit-recipients',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ config: { version: 1, entries: [] } }),
    }),
  ));
});

test('editing a Contact search invalidates its in-flight response and clears searching state', async () => {
  let resolveSearch;
  global.fetch = jest.fn((url) => {
    if (String(url).includes('?search=')) {
      return new Promise((resolve) => {
        resolveSearch = () => resolve(response({
          success: true,
          contacts: [{
            contactId: CONTACT_ID,
            name: 'Casey Consultant',
            email: 'casey@example.org',
            available: true,
          }],
        }));
      });
    }
    return Promise.resolve(response({
      success: true,
      config: { version: 1, entries: [] },
      entries: [],
      staff: [],
    }));
  });

  render(<SiteVisitRecipientsSection />);
  const input = await screen.findByLabelText('Find a Dataverse Contact');
  fireEvent.change(input, { target: { value: 'Casey' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByRole('button', { name: 'Searching…' })).toBeDisabled();

  fireEvent.change(input, { target: { value: 'Bailey' } });
  expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
  await act(async () => {
    resolveSearch();
    await Promise.resolve();
  });

  expect(screen.queryByText('Casey Consultant')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
});

test('disables new selections when the server-provided directory cap is reached', async () => {
  const entries = Array.from({ length: 3 }, (_, index) => ({
    kind: 'staff',
    profileId: index + 1,
  }));
  global.fetch = jest.fn(async () => response({
    success: true,
    config: { version: 1, entries },
    entries: [],
    maxEntries: 3,
    staff: [{
      kind: 'staff',
      profileId: 99,
      key: 'staff:99',
      category: 'staff',
      name: 'Not Yet Selected',
      email: 'new@example.org',
      available: true,
    }],
  }));

  render(<SiteVisitRecipientsSection />);
  const checkbox = await screen.findByRole('checkbox', { name: /Not Yet Selected/ });
  expect(checkbox).toBeDisabled();
  expect(screen.getByText('3 of 3 selected recipients')).toBeInTheDocument();
});
