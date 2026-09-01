/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import {
  ADMIN_WORKSPACES,
  AdminViewNavigation,
  AdminWorkspaceNavigation,
  adminHref,
  adminLocationForHash,
  resolveAdminLocation,
} from '../../shared/components/admin/AdminWorkspaceNavigation';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, scroll: _scroll, ...props }) => <a href={href} {...props}>{children}</a>,
}));

test('exposes the five confirmed admin workspaces in the confirmed order', () => {
  expect(ADMIN_WORKSPACES.map((workspace) => workspace.key)).toEqual([
    'overview',
    'operations',
    'workflows',
    'ai',
    'people',
  ]);
});

test('unknown workspace and view values fall back to safe defaults', () => {
  expect(resolveAdminLocation('not-a-workspace', 'anything')).toMatchObject({
    workspace: { key: 'overview' },
    view: 'summary',
  });
  expect(resolveAdminLocation('workflows', 'not-a-view')).toMatchObject({
    workspace: { key: 'workflows' },
    view: 'external-review',
  });
});

test('legacy anchors resolve to their new workspace locations', () => {
  expect(adminLocationForHash('#system-alerts')).toEqual({ workspace: 'operations', view: 'incidents' });
  expect(adminLocationForHash('#final-writeup-matrix-audiences')).toEqual({ workspace: 'workflows', view: 'final-writeups' });
  expect(adminLocationForHash('#unknown')).toBeNull();
});

test('workspace and view navigation are URL-addressable and announce the active route', () => {
  const workflows = resolveAdminLocation('workflows', 'final-writeups').workspace;
  const { rerender } = render(<AdminWorkspaceNavigation activeWorkspace="workflows" />);

  expect(screen.getByRole('link', { name: 'Workflows' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Operations' })).toHaveAttribute(
    'href',
    adminHref('operations', 'health'),
  );

  rerender(<AdminViewNavigation workspace={workflows} activeView="final-writeups" />);
  expect(screen.getByRole('link', { name: 'Final Writeups' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Site Visits' })).toHaveAttribute(
    'href',
    adminHref('workflows', 'site-visits'),
  );
});
