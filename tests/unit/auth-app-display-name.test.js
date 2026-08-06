/**
 * appDisplayName — the app name interpolated into requireAppAccess's guard
 * messages ("Could not verify your access to the Reviewers app; please
 * retry" / "Your account does not have access to the Reviewers app").
 * Owner reports 2026-08-06: "application access" read as a GRANT application,
 * then "your permissions" begged "permissions to what?" — the message must
 * name the guarded app. Pins:
 *   1. Legacy alternate keys (registry-absent) are skipped in favor of the
 *      first canonical key — ('review-manager', 'reviewers') → Reviewers.
 *   2. Unregistered namespaces and key-less guards fall back to "this app".
 */

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

import { appDisplayName } from '../../lib/utils/auth';

test('picks the first registry-known key, skipping legacy alternates', () => {
  expect(appDisplayName(['review-manager', 'reviewers'])).toBe('the Reviewers app');
  expect(appDisplayName(['reviewers'])).toBe('the Reviewers app');
});

test('falls back to "this app" for unregistered or empty key lists', () => {
  expect(appDisplayName(['no-such-app-key'])).toBe('this app');
  expect(appDisplayName([])).toBe('this app');
});
