/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import App from '../../pages/_app';

let mockPathname = '/meeting-tracker/transcription-rehearsal';

jest.mock('next/router', () => ({ useRouter: () => ({ pathname: mockPathname }) }));
jest.mock('next/head', () => ({ __esModule: true, default: ({ children }) => <>{children}</> }));
jest.mock('next-auth/react', () => ({ SessionProvider: ({ children }) => <div data-testid="session-provider">{children}</div> }));
jest.mock('@vercel/analytics/next', () => ({ Analytics: () => <div data-testid="analytics" /> }));
jest.mock('../../shared/context/ProfileContext', () => ({ ProfileProvider: ({ children }) => <div data-testid="profile-provider">{children}</div> }));
jest.mock('../../shared/context/AppAccessContext', () => ({ AppAccessProvider: ({ children }) => <div data-testid="app-access-provider">{children}</div> }));
jest.mock('../../shared/components/RequireAuth', () => ({ __esModule: true, default: ({ children }) => <div data-testid="require-auth">{children}</div> }));
jest.mock('../../shared/components/WelcomeModal', () => ({ __esModule: true, default: () => <div data-testid="welcome-modal" /> }));

test('dedicated server-enabled route skips the normal app-wide providers', () => {
  render(<App Component={() => <p>Rehearsal page</p>} pageProps={{ rehearsalEnabled: true }} />);
  expect(screen.getByText('Rehearsal page')).toBeInTheDocument();
  expect(screen.queryByTestId('session-provider')).not.toBeInTheDocument();
  expect(screen.queryByTestId('require-auth')).not.toBeInTheDocument();
  expect(screen.queryByTestId('profile-provider')).not.toBeInTheDocument();
  expect(screen.queryByTestId('app-access-provider')).not.toBeInTheDocument();
  expect(screen.queryByTestId('analytics')).not.toBeInTheDocument();
});

test('route and server flag must both match before global providers are skipped', () => {
  mockPathname = '/meeting-tracker/transcription-rehearsal';
  const { rerender } = render(<App Component={() => <p>Page</p>} pageProps={{ rehearsalEnabled: false }} />);
  expect(screen.getByTestId('require-auth')).toBeInTheDocument();

  mockPathname = '/meeting-tracker/visits/[requestId]';
  rerender(<App Component={() => <p>Page</p>} pageProps={{ rehearsalEnabled: true }} />);
  expect(screen.getByTestId('require-auth')).toBeInTheDocument();
});
