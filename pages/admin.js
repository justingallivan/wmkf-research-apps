import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../shared/components/Layout';
import AdminOverviewSection from '../shared/components/admin/AdminOverviewSection';
import {
  AdminViewNavigation,
  AdminWorkspaceHeader,
  AdminWorkspaceNavigation,
  adminLocationForHash,
  resolveAdminLocation,
} from '../shared/components/admin/AdminWorkspaceNavigation';
import { OperationsWorkspace } from '../shared/components/admin/workspaces/OperationsWorkspace';
import { WorkflowsWorkspace } from '../shared/components/admin/workspaces/WorkflowsWorkspace';
import { AiWorkspace } from '../shared/components/admin/workspaces/AiWorkspace';
import { TestRequestsWorkspace } from '../shared/components/admin/workspaces/TestRequestsWorkspace';
import { PeopleWorkspace } from '../shared/components/admin/workspaces/PeopleWorkspace';

export function WorkspaceContent({ workspace, view }) {
  switch (workspace) {
    case 'operations':
      return <OperationsWorkspace view={view} />;
    case 'workflows':
      return <WorkflowsWorkspace view={view} />;
    case 'test-requests':
      return <TestRequestsWorkspace />;
    case 'ai':
      return <AiWorkspace view={view} />;
    case 'people':
      return <PeopleWorkspace view={view} />;
    case 'overview':
    default:
      return <AdminOverviewSection />;
  }
}

// --- Main Page ---
export default function AdminDashboard() {
  const router = useRouter();
  const rawWorkspace = typeof router.query.workspace === 'string' ? router.query.workspace : 'overview';
  const rawView = typeof router.query.view === 'string' ? router.query.view : undefined;
  const { workspace, view } = resolveAdminLocation(rawWorkspace, rawView);
  const activeLocationKey = `${workspace.key}:${view}`;
  const [visitedLocations, setVisitedLocations] = useState(() => [activeLocationKey]);

  useEffect(() => {
    const rememberAdminLocation = (url) => {
      const nextUrl = new URL(url, window.location.origin);
      if (nextUrl.pathname !== router.pathname) return;
      const nextLocation = resolveAdminLocation(
        nextUrl.searchParams.get('workspace') || 'overview',
        nextUrl.searchParams.get('view') || undefined,
      );
      const nextKey = `${nextLocation.workspace.key}:${nextLocation.view}`;
      setVisitedLocations((current) => {
        const remembered = new Set(current);
        remembered.add(activeLocationKey);
        remembered.add(nextKey);
        return remembered.size === current.length ? current : [...remembered];
      });
    };
    router.events?.on('routeChangeStart', rememberAdminLocation);
    return () => router.events?.off('routeChangeStart', rememberAdminLocation);
  }, [activeLocationKey, router.events, router.pathname]);

  const renderedLocations = visitedLocations.includes(activeLocationKey)
    ? visitedLocations
    : [...visitedLocations, activeLocationKey];

  useEffect(() => {
    if (!router.isReady || typeof window === 'undefined') return;
    const legacyLocation = adminLocationForHash(window.location.hash);
    if (!legacyLocation) return;
    const alreadyThere = workspace.key === legacyLocation.workspace && view === legacyLocation.view;
    if (!alreadyThere) {
      void router.replace(
        {
          pathname: router.pathname,
          query: { workspace: legacyLocation.workspace, view: legacyLocation.view },
          hash: window.location.hash.slice(1),
        },
        undefined,
        { shallow: true, scroll: false },
      );
      return;
    }
    window.requestAnimationFrame(() => {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
    });
  }, [router, view, workspace.key]);

  return (
    <Layout title="Admin Workspace" description="WMKF system operations and configuration">
      <div className="py-6 sm:py-8">
        <AdminWorkspaceHeader workspace={workspace} />
        <div className="mt-6">
          <AdminWorkspaceNavigation activeWorkspace={workspace.key} />
        </div>
        <div className="mt-5">
          <AdminViewNavigation workspace={workspace} activeView={view} />
        </div>
        {renderedLocations.map((locationKey) => {
          const [visitedWorkspaceKey, visitedViewKey] = locationKey.split(':');
          const visitedLocation = resolveAdminLocation(visitedWorkspaceKey, visitedViewKey);
          const active = locationKey === activeLocationKey;
          const visitedViewLabel = visitedLocation.workspace.views.find((candidate) => candidate.key === visitedLocation.view)?.label;
          return (
            <main
              key={locationKey}
              hidden={!active}
              className="mt-6"
              aria-label={`${visitedLocation.workspace.label}: ${visitedViewLabel}`}
            >
              <WorkspaceContent workspace={visitedLocation.workspace.key} view={visitedLocation.view} />
            </main>
          );
        })}
      </div>
    </Layout>
  );
}
