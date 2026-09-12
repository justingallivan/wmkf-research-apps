/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import {
  AdminEditorPanel,
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

test('a collapsible editor panel starts closed when asked, keeps its heading visible, and opens on the header', () => {
  const { container } = render(
    <AdminEditorPanel id="p1" title="Workflow policies" description="Policy text." scope="Workflow-specific" collapsible defaultOpen={false}>
      <p>Panel body</p>
    </AdminEditorPanel>,
  );
  const details = container.querySelector('details');
  expect(details).not.toBeNull();
  expect(details.open).toBe(false);
  expect(screen.getByRole('heading', { name: 'Workflow policies' })).toBeInTheDocument();
  fireEvent.click(container.querySelector('summary'));
  expect(details.open).toBe(true);
  expect(screen.getByText('Panel body')).toBeInTheDocument();
});

test('clicking the panel field-mapping button never toggles the collapsible panel', () => {
  const { container } = render(
    <AdminEditorPanel
      id="p3"
      title="Workflow email defaults"
      scope="Workflow-specific"
      collapsible
      defaultOpen={false}
      dataverseFields={[{ label: 'Setting', entity: 'wmkf_appsystemsetting', field: 'wmkf_settingvalue' }]}
    >
      <p>Panel body</p>
    </AdminEditorPanel>,
  );
  const details = container.querySelector('details');
  expect(details.open).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: /dataverse field mapping/i }));
  // The popover is now open; clicking the button toggled ONLY the popover, not the panel.
  expect(details.open).toBe(false);
  expect(screen.getByText('Setting')).toBeInTheDocument();

  // Clicking non-interactive content inside the popover must not toggle the panel either —
  // this is the case a bare bubble-phase preventDefault() misses once the popover's own
  // stopPropagation() already cuts the bubble before it reaches the guard.
  fireEvent.click(screen.getByText('Setting'));
  expect(details.open).toBe(false);
});

test('a non-collapsible editor panel renders no disclosure and shows its body immediately', () => {
  const { container } = render(
    <AdminEditorPanel id="p2" title="Plain panel" scope="Global">
      <p>Always visible</p>
    </AdminEditorPanel>,
  );
  expect(container.querySelector('details')).toBeNull();
  expect(screen.getByText('Always visible')).toBeInTheDocument();
});
