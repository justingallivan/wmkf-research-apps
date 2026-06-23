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
    currentProfile: { id: 1, name: 'Beth', displayName: 'Beth Pruitt', avatarColor: '#6366f1', isDefault: true },
    profiles: [{ id: 1, name: 'Beth', displayName: 'Beth Pruitt', avatarColor: '#6366f1', isDefault: true, lastUsedAt: '2026-06-20T00:00:00.000Z' }],
    preferences: {
      reviewer_finder_sender_info: JSON.stringify({ name: 'Legacy Beth', email: 'legacy@wmkeck.org', signature: 'Legacy block' }),
    },
    setPreference,
    deletePreference,
    updateProfile: jest.fn(),
    archiveProfile: jest.fn(),
    selectProfile: jest.fn(),
  }),
}));

beforeEach(() => {
  setPreference.mockReset().mockResolvedValue(true);
  deletePreference.mockReset().mockResolvedValue(true);
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
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => {
  if (global.fetch?.mockRestore) global.fetch.mockRestore();
});

test('saves the unified email_signature key from the Profile Settings editor', async () => {
  render(<ProfileSettings />);

  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Beth Pruitt' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'beth@wmkeck.org' } });
  fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'Beth Pruitt\nProgram Director' } });
  fireEvent.click(screen.getByRole('button', { name: /save email signature/i }));

  await waitFor(() => expect(setPreference).toHaveBeenCalled());
  expect(setPreference.mock.calls[0][0]).toBe(PREFERENCE_KEYS.EMAIL_SIGNATURE);
  expect(JSON.parse(setPreference.mock.calls[0][1])).toEqual({
    name: 'Beth Pruitt',
    email: 'beth@wmkeck.org',
    signature: 'Beth Pruitt\nProgram Director',
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
