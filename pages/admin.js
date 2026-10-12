import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Layout from '../shared/components/Layout';
import PoliciesSection from '../shared/components/admin/PoliciesSection';
import OperationalEventsSection from '../shared/components/admin/OperationalEventsSection';
import ReviewQuestionsSection from '../shared/components/admin/ReviewQuestionsSection';
import PromptTemplatesSection from '../shared/components/admin/PromptTemplatesSection';
import EmailDefaultsSection from '../shared/components/admin/EmailDefaultsSection';
import SiteVisitRecipientsSection from '../shared/components/admin/SiteVisitRecipientsSection';
import MeetingTrackerDefaultsSection from '../shared/components/admin/MeetingTrackerDefaultsSection';
import DefaultFacilitatorSettings from '../shared/components/proposal-ranking/DefaultFacilitatorSettings';
import SiteVisitMaterialsDefaultsSection from '../shared/components/admin/SiteVisitMaterialsDefaultsSection';
import FinalWriteupMatrixAudiencesSection from '../shared/components/admin/FinalWriteupMatrixAudiencesSection';
import DynamicsExplorerRestrictionsSection from '../shared/components/admin/DynamicsExplorerRestrictionsSection';
import {
  appSystemSettingField,
  appSystemSettingPattern,
} from '../shared/components/admin/DataverseFieldInfoButton';
import AdminOverviewSection from '../shared/components/admin/AdminOverviewSection';
import TestRequestFactorySection from '../shared/components/admin/TestRequestFactorySection';
import TestRequestPreviewSection from '../shared/components/admin/TestRequestPreviewSection';
import TestRequestEmailAllowlistSection from '../shared/components/admin/TestRequestEmailAllowlistSection';
import {
  AdminEditorPanel,
  AdminViewNavigation,
  AdminWorkspaceHeader,
  AdminWorkspaceNavigation,
  adminLocationForHash,
  resolveAdminLocation,
} from '../shared/components/admin/AdminWorkspaceNavigation';
import HealthSection from '../shared/components/admin/HealthSection';
import HealthHistorySection from '../shared/components/admin/HealthHistorySection';
import SystemAlertsSection from '../shared/components/admin/SystemAlertsSection';
import MaintenanceSection from '../shared/components/admin/MaintenanceSection';
import SecretExpirationSection from '../shared/components/admin/SecretExpirationSection';
import AlertRecipientsSection from '../shared/components/admin/AlertRecipientsSection';
import DynamicsFeedbackSection from '../shared/components/admin/DynamicsFeedbackSection';
import ModelConfigSection from '../shared/components/admin/ModelConfigSection';
import UsageSection from '../shared/components/admin/UsageSection';
import HonorariumAmountSection from '../shared/components/admin/HonorariumAmountSection';
import ReviewerReleaseAttachmentsSection from '../shared/components/admin/ReviewerReleaseAttachmentsSection';
import ReviewerCampaignTimelineSection from '../shared/components/admin/ReviewerCampaignTimelineSection';
import ReviewerTimeBudgetSection from '../shared/components/admin/ReviewerTimeBudgetSection';
import RoleManagementSection from '../shared/components/admin/RoleManagementSection';
import AppAccessSection from '../shared/components/admin/AppAccessSection';
import DynamicsIdentitySection from '../shared/components/admin/DynamicsIdentitySection';
import { OperationsWorkspace } from '../shared/components/admin/workspaces/OperationsWorkspace';
import { WorkflowsWorkspace } from '../shared/components/admin/workspaces/WorkflowsWorkspace';
import { AiWorkspace } from '../shared/components/admin/workspaces/AiWorkspace';
import { TestRequestsWorkspace } from '../shared/components/admin/workspaces/TestRequestsWorkspace';
import { PeopleWorkspace } from '../shared/components/admin/workspaces/PeopleWorkspace';

export { default as DynamicsFeedbackSection } from '../shared/components/admin/DynamicsFeedbackSection';
export { default as AppAccessSection } from '../shared/components/admin/AppAccessSection';
export { OperationsWorkspace, WorkflowsWorkspace, AiWorkspace, PeopleWorkspace };

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
