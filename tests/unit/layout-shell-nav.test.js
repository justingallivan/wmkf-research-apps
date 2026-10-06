/**
 * @jest-environment jsdom
 *
 * Layout shell and nav (DESIGN.md "Page Structure": The One Shell Rule and the
 * Global navigation pattern). Top-level items are Home, Workbench, Meeting
 * Tracker, Tools, Guide, Admin; every other accessible app sits in Tools.
 * Width classes are literal strings so Tailwind generates them.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import Layout from '../../shared/components/Layout';

let mockPathname = '/';
let mockAccess = { isSuperuser: false, hasAccess: () => true };

jest.mock('next/router', () => ({ useRouter: () => ({ pathname: mockPathname }) }));
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Staff' } }, status: 'authenticated' }),
  signOut: jest.fn(),
}));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ currentProfile: null, profiles: [] }) }));
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: () => mockAccess }));
jest.mock('../../shared/utils/auth-enabled', () => ({ getAuthEnabled: () => Promise.resolve(true) }));
jest.mock('../../shared/utils/api-request', () => ({
  requestEnvelope: jest.fn(() => Promise.resolve({ ok: true, data: { critical: 0, error: 0 } })),
}));
jest.mock('../../shared/config/appRegistry', () => ({
  APP_REGISTRY: [
    { key: 'review-panel', name: 'Review Panel', href: '/review-panel' },
    { key: 'reviewers', name: 'Workbench', href: '/workbench' },
    { key: 'meeting-tracker', name: 'Meeting Tracker', href: '/meeting-tracker' },
    { key: 'grant-reporting', name: 'Grant Reporting', href: '/grant-reporting' },
  ],
}));
jest.mock('next/link', () => function LinkStub({ href, children, ...rest }) {
  return <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>;
});

function mainNav() {
  return screen.getAllByRole('navigation', { name: 'Main' })[0];
}

beforeEach(() => {
  mockPathname = '/';
  mockAccess = { isSuperuser: false, hasAccess: () => true };
});

test('top level is Home, Workbench, Meeting Tracker, Tools, Guide; other apps only inside Tools', async () => {
  render(<Layout>content</Layout>);
  await screen.findByText('content');
  const nav = mainNav();
  const topLevel = within(nav).getAllByRole('link').map(link => link.textContent);
  expect(topLevel).toEqual(['Home', 'Workbench', 'Meeting Tracker', 'Guide']);
  expect(within(nav).queryByText('Review Panel')).not.toBeInTheDocument();

  fireEvent.click(within(nav).getByRole('button', { name: 'Tools' }));
  const menu = screen.getByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Review Panel', 'Grant Reporting']);
});

test('Tools lists only apps the user can access; Cycle Dossier and Admin are superuser-only', async () => {
  mockAccess = { isSuperuser: false, hasAccess: key => key !== 'grant-reporting' && key !== 'meeting-tracker' };
  const { unmount } = render(<Layout>content</Layout>);
  await screen.findByText('content');
  expect(within(mainNav()).queryByText('Meeting Tracker')).not.toBeInTheDocument();
  expect(within(mainNav()).queryByText('Admin')).not.toBeInTheDocument();
  fireEvent.click(within(mainNav()).getByRole('button', { name: 'Tools' }));
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Review Panel']);
  unmount();

  mockAccess = { isSuperuser: true, hasAccess: () => true };
  render(<Layout>content</Layout>);
  await screen.findByText('content');
  expect(within(mainNav()).getByText('Admin')).toBeInTheDocument();
  fireEvent.click(within(mainNav()).getByRole('button', { name: 'Tools' }));
  expect(within(screen.getByRole('menu')).getByText('Cycle Dossier')).toBeInTheDocument();
});

test('the current item is marked by path prefix; a tool page marks the Tools trigger', async () => {
  mockPathname = '/workbench/[requestId]';
  const { unmount } = render(<Layout>content</Layout>);
  await screen.findByText('content');
  expect(within(mainNav()).getByRole('link', { name: 'Workbench' })).toHaveAttribute('aria-current', 'page');
  expect(within(mainNav()).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  expect(within(mainNav()).getByRole('button', { name: 'Tools' }).className).not.toContain('underline');
  unmount();

  mockPathname = '/review-panel';
  render(<Layout>content</Layout>);
  await screen.findByText('content');
  expect(within(mainNav()).getByRole('button', { name: 'Tools' }).className).toContain('underline');
  expect(within(mainNav()).getByRole('link', { name: 'Workbench' })).not.toHaveAttribute('aria-current');
});

test('Tools and user menus are exclusive; Escape closes the open one', async () => {
  render(<Layout>content</Layout>);
  await screen.findByText('content');
  const toolsButton = within(mainNav()).getByRole('button', { name: 'Tools' });
  fireEvent.click(toolsButton);
  expect(toolsButton).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(toolsButton).toHaveAttribute('aria-expanded', 'false');

  fireEvent.click(toolsButton);
  fireEvent.click((await screen.findAllByRole('button', { name: /Staff/ }))[0]);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getAllByText('Profile Settings').length).toBeGreaterThan(0);
});

test.each([
  ['4xl', 'max-w-4xl'],
  ['6xl', 'max-w-6xl'],
  ['7xl', 'max-w-7xl'],
  ['unknown', 'max-w-7xl'],
])('maxWidth %s gives <main> the literal %s while the header stays max-w-7xl', async (maxWidth, expected) => {
  const { container } = render(<Layout maxWidth={maxWidth}>content</Layout>);
  await screen.findByText('content');
  expect(container.querySelector('main > div').className).toContain(expected);
  expect(container.querySelector('header > div').className).toContain('max-w-7xl');
  expect(container.innerHTML).not.toMatch(/max-w-(undefined|unknown)/);
});
