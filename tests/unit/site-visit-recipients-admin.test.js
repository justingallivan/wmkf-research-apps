/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  fireEvent.click(screen.getByRole('button', { name: 'Save recipients' }));

  await screen.findByText('Recipient directory saved.');
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
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save recipients' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/admin/site-visit-recipients',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ config: { version: 1, entries: [] } }),
    }),
  ));
});
