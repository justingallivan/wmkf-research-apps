/**
 * @jest-environment jsdom
 *
 * Profile Settings email-signature editor.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProfileSettings from '../../pages/profile-settings';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences';
import { GRANTEE_INVITE_SEED_BODY } from '../../lib/seed/email-defaults/grantee-invite';

const setPreference = jest.fn();
const deletePreference = jest.fn();
const refreshPreferences = jest.fn();

jest.mock('../../shared/components/Layout', () => {
  const Layout = ({ children }) => <div>{children}</div>;
  return {
    __esModule: true,
    default: Layout,
    PageHeader: ({ title }) => <h1>{title}</h1>,
    Card: ({ children }) => <section>{children}</section>,
    Button: ({ children, loading: _loading, ...props }) => <button {...props}>{children}</button>,
  };
});

jest.mock('../../shared/context/ProfileContext', () => ({
  useProfile: () => ({
    status: 'ready',
    isLoading: false,
    currentProfile: { id: 1, name: 'Bailey', displayName: 'Bailey Stone', avatarColor: '#6366f1', isDefault: true },
    profiles: [{ id: 1, name: 'Bailey', displayName: 'Bailey Stone', avatarColor: '#6366f1', isDefault: true, lastUsedAt: '2026-06-20T00:00:00.000Z' }],
    preferences: {
      reviewer_finder_sender_info: JSON.stringify({ name: 'Legacy Bailey', email: 'legacy@example.org', signature: 'Legacy block' }),
    },
    setPreference,
    deletePreference,
    refreshPreferences,
    updateProfile: jest.fn(),
    archiveProfile: jest.fn(),
    selectProfile: jest.fn(),
  }),
}));

beforeEach(() => {
  setPreference.mockReset().mockResolvedValue(true);
  deletePreference.mockReset().mockResolvedValue(true);
  refreshPreferences.mockReset().mockResolvedValue(true);
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/api/email-defaults/grantee-invite')) {
      return {
        ok: true,
        json: async () => ({
          subject: 'Stored subject',
          body: GRANTEE_INVITE_SEED_BODY,
          configured: true,
          unavailable: false,
        }),
      };
    }
    if (String(url).includes('/api/email-automation-preferences')) {
      return {
        ok: true,
        json: async () => ({ configured: true, preference: { mode: 'review', leadDays: 3 } }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => {
  if (global.fetch?.mockRestore) global.fetch.mockRestore();
});

test('saves the unified email_signature key from the Profile Settings editor', async () => {
  render(<ProfileSettings />);

  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bailey Stone' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bailey.stone@example.org' } });
  fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'Until next time,\nBailey Stone\nProgram Director' } });
  fireEvent.click(screen.getByLabelText(/already includes its own closing/i));
  fireEvent.click(screen.getByRole('button', { name: /save email signature/i }));

  await waitFor(() => expect(setPreference).toHaveBeenCalled());
  expect(setPreference.mock.calls[0][0]).toBe(PREFERENCE_KEYS.EMAIL_SIGNATURE);
  expect(JSON.parse(setPreference.mock.calls[0][1])).toEqual({
    name: 'Bailey Stone',
    email: 'bailey.stone@example.org',
    signature: 'Until next time,\nBailey Stone\nProgram Director',
    customClosing: true,
  });
});

test('loads and resets the Request Abstract email body from the admin default endpoint', async () => {
  render(<ProfileSettings />);

  await waitFor(() => expect(screen.getByLabelText('Email body')).toHaveValue(GRANTEE_INVITE_SEED_BODY));
  fireEvent.change(screen.getByLabelText('Email body'), { target: { value: 'Personal override' } });
  fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));

  await waitFor(() => expect(deletePreference).toHaveBeenCalledWith(PREFERENCE_KEYS.GRANTEE_INVITE_BODY));
  expect(screen.getByLabelText('Email body')).toHaveValue(GRANTEE_INVITE_SEED_BODY);
});

test('saves a validated three-day advance-review choice through the dedicated route', async () => {
  render(<ProfileSettings />);
  fireEvent.click(screen.getByLabelText(/notify me before automatic sending/i));
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: /save automatic email setting/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/email-automation-preferences',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ mode: 'review', leadDays: 3 }),
    }),
  ));
  expect(refreshPreferences).toHaveBeenCalledWith(1);
});
