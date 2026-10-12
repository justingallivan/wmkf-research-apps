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
import ResourceLinks from '../shared/components/admin/ResourceLinks';
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

export { default as DynamicsFeedbackSection } from '../shared/components/admin/DynamicsFeedbackSection';
export { default as AppAccessSection } from '../shared/components/admin/AppAccessSection';

const ALERT_RECIPIENT_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Per-category recipient JSON',
    'alertRecipientsByCategory',
    'The active-superuser fallback roster is Postgres-backed, not Dataverse.',
  ),
];

const TEST_REQUEST_EMAIL_ALLOWLIST_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Test-request email allowlist',
    'testRequestEmailAllowlist',
    'JSON { addresses: [...] }. @wmkeck.org is always allowed in code and is not stored here.',
  ),
];

const MEETING_TRACKER_DEFAULTS_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Default deliberation attendees',
    'meeting_tracker.default_attendees',
    'Stores only active staff profile IDs (reference map v1); names and emails are resolved live from the recipient directory.',
  ),
];
const SITE_VISIT_MATERIALS_DEFAULTS_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Materials due-date offset',
    'site_visit_materials.due_business_days',
    'Whole number of business days before the site visit (1–30, default 2). New materials requests only; existing deadlines remain unchanged.',
  ),
  appSystemSettingField(
    'Applicant materials upload cap',
    'site_visit_materials.upload_max_mb',
    'Whole number of megabytes (1–500). Unset reads as the 500 MB default. The briefing page opens files up to 50 MB and lists larger ones with a note.',
  ),
];

const SITE_VISIT_RECIPIENT_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Curated recipient identity references',
    'site_visit.distribution_recipient_directory',
    'Stores only active staff profile IDs and Dataverse Contact GUIDs; names and emails are resolved live.',
  ),
];

const FINAL_WRITEUP_MATRIX_AUDIENCE_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Program-specific matrix audiences',
    'final_writeup.matrix_audiences',
    'Stores stable broad Grant Program GUIDs and enabled Final Writeup reviewer systemuser GUIDs; names resolve live.',
  ),
];

const MODEL_CONFIG_DATAVERSE_FIELDS = [
  appSystemSettingPattern(
    'Saved model override dropdown',
    'model_override:<appKey>:<modelType>',
    'Only saved overrides live here. Defaults, environment overrides, model registry status, and pricing are not stored in this Dataverse row.',
  ),
];

const HONORARIUM_DATAVERSE_FIELDS = [
  appSystemSettingField('Reviewer honorarium amount', 'honorarium.default_amount'),
];

const REVIEWER_TIME_BUDGET_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Reviewer search time budget',
    'reviewer.time_budget_seconds',
    'The UI clamps this value into the supported min/max range before saving.',
  ),
];

const REVIEWER_RELEASE_ATTACHMENTS_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Attach proposal to release email',
    'reviewer.release.attach_proposal_email',
    'Default OFF — the release email is portal-link-only. Read fresh by ReviewerManagePanel every time its email modal opens.',
  ),
];

const REVIEWER_CAMPAIGN_TIMELINE_DATAVERSE_FIELDS = [
  appSystemSettingField(
    'Reviewer campaign timeline defaults',
    'reviewer.campaign_timeline_defaults',
    'Cycle-level JSON defaults for reviewer invitation timing. Request-level campaign config still wins when present.',
  ),
];

const POLICY_SECTION_DATAVERSE_FIELDS = [
  {
    label: 'Policy slot rows',
    entity: 'wmkf_policy',
    entitySet: 'wmkf_policies',
    field: 'wmkf_code / wmkf_displayname / wmkf_activeversion',
    row: 'Visible slots are selected by wmkf_code.',
  },
  {
    label: 'Policy version rows',
    entity: 'wmkf_policyversion',
    entitySet: 'wmkf_policyversions',
    field: 'wmkf_versionlabel / wmkf_policytitle / wmkf_policybody / wmkf_effectivedate',
    row: 'Version rows are filtered by _wmkf_policy_value.',
  },
];

const REVIEW_QUESTIONS_DATAVERSE_FIELDS = [
  {
    label: 'Review question rows',
    entity: 'wmkf_reviewquestion',
    entitySet: 'wmkf_reviewquestions',
    field: 'wmkf_questionkey / wmkf_questionorder / wmkf_questiontext / wmkf_questiontype / wmkf_required / wmkf_options',
    row: 'Active rows (statecode 0) ordered by wmkf_questionorder. Saves apply one atomic changeset; edits are audited in Postgres review_question_audit.',
  },
];

const PROMPT_SECTION_DATAVERSE_FIELDS = [
  {
    label: 'Prompt inventory and editable body',
    entity: 'wmkf_ai_prompt',
    entitySet: 'wmkf_ai_prompts',
    field: 'wmkf_ai_promptname / wmkf_promptversion / wmkf_ai_systemprompt / wmkf_ai_promptbody / wmkf_ai_iscurrent',
    row: 'Prompt panels are grouped by wmkf_ai_promptname.',
  },
];

const EMAIL_DEFAULTS_DATAVERSE_FIELDS = [
  appSystemSettingPattern(
    'Editable email default value',
    'email.<workflow>.<subject|body>',
    'Each email default card shows its exact key in its own field mapping popover.',
  ),
];

export function OperationsWorkspace({ view }) {
  switch (view) {
    case 'incidents':
      return (
        <div className="space-y-6">
          <SystemAlertsSection />
          <OperationalEventsSection />
        </div>
      );
    case 'jobs':
      return <MaintenanceSection />;
    case 'credentials':
      return (
        <div className="space-y-6">
          <SecretExpirationSection />
          <ResourceLinks
            title="Credential resources"
            links={[
              { name: 'Vercel dashboard', href: 'https://vercel.com/dashboard', description: 'Deployment settings, logs, and environment configuration.', external: true },
            ]}
          />
        </div>
      );
    case 'notifications':
      return (
        <AdminEditorPanel
          id="alert-recipients"
          title="System alert recipients"
          description="Route operational alerts to the appropriate internal recipients by category."
          scope="Global"
          dataverseFields={ALERT_RECIPIENT_DATAVERSE_FIELDS}
        >
          <AlertRecipientsSection />
        </AdminEditorPanel>
      );
    case 'feedback':
      return <DynamicsFeedbackSection />;
    case 'dynamics-safeguards':
      return (
        <AdminEditorPanel
          id="dynamics-explorer-safeguards"
          title="Dynamics Explorer data safeguards"
          description="Control what Dynamics Explorer can query or export. These settings do not change a user&apos;s underlying Dynamics permissions."
          scope="Global Explorer policy"
        >
          <DynamicsExplorerRestrictionsSection />
        </AdminEditorPanel>
      );
    case 'health':
    default:
      return (
        <div className="space-y-6">
          <HealthSection />
          <HealthHistorySection />
        </div>
      );
  }
}

export function WorkflowsWorkspace({ view }) {
  switch (view) {
    case 'proposal-ranking':
      return (
        <AdminEditorPanel
          id="proposal-ranking-default-facilitator"
          title="Proposal Ranking facilitator"
          description="Choose the active staff member who can preview and open each cycle. Participants still need separate Proposal Ranking app access."
          scope="Global setting"
        >
          <DefaultFacilitatorSettings />
        </AdminEditorPanel>
      );
    case 'review-form':
      return (
        <AdminEditorPanel
          id="external-review-form"
          title="External review form"
          description="Edit the ordered questions shown to external reviewers. Existing answers keep the wording they were authored against."
          scope="Global external review"
          dataverseFields={REVIEW_QUESTIONS_DATAVERSE_FIELDS}
        >
          <ReviewQuestionsSection />
        </AdminEditorPanel>
      );
    case 'final-writeups':
      return (
        <AdminEditorPanel
          id="final-writeup-matrix-audiences"
          title="Final Writeup staffing"
          description="Assign staff responsibilities and choose the reviewers expected for each Dataverse Grant Program."
          scope="Global staff · Per Grant Program"
          dataverseFields={FINAL_WRITEUP_MATRIX_AUDIENCE_DATAVERSE_FIELDS}
        >
          <FinalWriteupMatrixAudiencesSection />
        </AdminEditorPanel>
      );
    case 'site-visits':
      return (
        <div className="space-y-6">
        <AdminEditorPanel
          id="site-visit-recipient-directory"
          title="Site Visit recipient directory"
          description="Choose the staff, consultants, and Board members available in the materials-email recipient menu."
          scope="Global directory"
          dataverseFields={SITE_VISIT_RECIPIENT_DATAVERSE_FIELDS}
        >
          <SiteVisitRecipientsSection />
        </AdminEditorPanel>
          <AdminEditorPanel
            id="meeting-tracker-default-attendees"
            title="Meeting Tracker default attendees"
            description="Choose the staff who attend every deliberation session by default. Board members are added per session in the Meeting Tracker."
            scope="Global setting"
            dataverseFields={MEETING_TRACKER_DEFAULTS_DATAVERSE_FIELDS}
          >
            <MeetingTrackerDefaultsSection />
          </AdminEditorPanel>
          <AdminEditorPanel
            id="site-visit-materials-upload-cap"
            title="Materials defaults"
            description="Set the deadline for new site visit materials requests and the largest file applicants can upload."
            scope="Global setting"
            dataverseFields={SITE_VISIT_MATERIALS_DEFAULTS_DATAVERSE_FIELDS}
          >
            <SiteVisitMaterialsDefaultsSection />
          </AdminEditorPanel>
        </div>
      );
    case 'governance':
      return (
        <div className="space-y-6">
          <AdminEditorPanel
            id="workflow-policies"
            title="Workflow policies"
            description="Reviewer and grantee policy text. Published versions are immutable: every edit publishes a new version and moves the active pointer."
            scope="Workflow-specific"
            dataverseFields={POLICY_SECTION_DATAVERSE_FIELDS}
            collapsible
            defaultOpen={false}
          >
            <PoliciesSection />
          </AdminEditorPanel>
          <AdminEditorPanel
            id="workflow-email-defaults"
            title="Workflow email defaults"
            description="Default copy for reviewer, grantee, and internal emails, plus staff display labels. A blank invitation default blocks sends until it is filled in."
            scope="Workflow-specific"
            dataverseFields={EMAIL_DEFAULTS_DATAVERSE_FIELDS}
            collapsible
            defaultOpen={false}
          >
            <EmailDefaultsSection />
          </AdminEditorPanel>
        </div>
      );
    case 'external-review':
    default:
      return (
        <div className="space-y-6">
          <div className="max-w-3xl">
            <h2 className="text-lg font-semibold text-gray-950">External review defaults</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              These settings govern new reviewer campaigns unless a request carries its own override.
              Each editor saves independently so a failure in one setting cannot be mistaken for a complete campaign update.
            </p>
          </div>
          <AdminEditorPanel
            id="reviewer-campaign-timeline"
            title="Campaign timeline"
            description="Current-cycle invitation dates and reviewer quota. Request-level campaign settings take precedence."
            scope="Global default · Request override"
            dataverseFields={REVIEWER_CAMPAIGN_TIMELINE_DATAVERSE_FIELDS}
          >
            <ReviewerCampaignTimelineSection />
          </AdminEditorPanel>
          <AdminEditorPanel
            id="reviewer-honorarium"
            title="Reviewer honorarium"
            description="The amount stamped on future reviewer honorarium records. Existing records keep their original amount."
            scope="Global"
            dataverseFields={HONORARIUM_DATAVERSE_FIELDS}
          >
            <HonorariumAmountSection />
          </AdminEditorPanel>
          <AdminEditorPanel
            id="reviewer-discovery-budget"
            title="Reviewer discovery time budget"
            description="The maximum runtime for reviewer analysis, discovery, enrichment, and email preparation."
            scope="Global"
            dataverseFields={REVIEWER_TIME_BUDGET_DATAVERSE_FIELDS}
          >
            <ReviewerTimeBudgetSection />
          </AdminEditorPanel>
          <AdminEditorPanel
            id="reviewer-release-behavior"
            title="Reviewer materials release"
            description="Choose whether release emails remain portal-link-only or may also include proposal files."
            scope="Global"
            dataverseFields={REVIEWER_RELEASE_ATTACHMENTS_DATAVERSE_FIELDS}
          >
            <ReviewerReleaseAttachmentsSection />
          </AdminEditorPanel>
        </div>
      );
  }
}

export function AiWorkspace({ view }) {
  switch (view) {
    case 'models':
      return (
        <div className="space-y-6">
          <AdminEditorPanel
            id="ai-model-routing"
            title="Model routing"
            description="Set reviewed model overrides by application and capability. Defaults remain in effect where no override is saved."
            scope="Per application"
            dataverseFields={MODEL_CONFIG_DATAVERSE_FIELDS}
          >
            <ModelConfigSection />
          </AdminEditorPanel>
          <ResourceLinks
            title="AI resources"
            links={[
              { name: 'Anthropic console', href: 'https://console.anthropic.com', description: 'Provider usage and billing.', external: true },
            ]}
          />
        </div>
      );
    case 'prompts':
      return (
        <AdminEditorPanel
          id="ai-prompts"
          title="Prompts and execution budgets"
          description="Publish versioned prompt bodies and maintain the reviewed token and timeout limits coupled to them."
          scope="Per prompt"
          dataverseFields={PROMPT_SECTION_DATAVERSE_FIELDS}
        >
          <PromptTemplatesSection />
        </AdminEditorPanel>
      );
    case 'usage':
    default:
      return <UsageSection />;
  }
}

function TestRequestsWorkspace() {
  // The Factory section learns the deployment's target from its own runs request.
  const [factoryTarget, setFactoryTarget] = useState(null);
  const factoryScope = factoryTarget ? `${factoryTarget === 'production' ? 'Production' : 'Sandbox'} data · Writes` : 'Writes';
  return (
    <div className="space-y-6">
      <AdminEditorPanel
        id="test-request-email-allowlist"
        title="Test-request email allowlist"
        description="Who may receive email about a test request, for testing and training. Everyone else is refused."
        scope="Global setting"
        dataverseFields={TEST_REQUEST_EMAIL_ALLOWLIST_DATAVERSE_FIELDS}
      >
        <TestRequestEmailAllowlistSection />
      </AdminEditorPanel>
      <AdminEditorPanel
        id="test-request-preview"
        title="Basic Request clone preview"
        description="Resolve one sandbox Request, choose proposal files, and inspect the server-controlled field and filename plan. This panel has no create or copy action."
        scope="Sandbox data · Shared files · Read-only"
      >
        <TestRequestPreviewSection />
      </AdminEditorPanel>
      <AdminEditorPanel
        id="test-request-factory"
        title="Create a test Request"
        description="Clone one production Request into a labelled test Request, step by step, then set its Phase I or Phase II status. Each step writes real data, so every control says why it is off."
        scope={factoryScope}
      >
        <TestRequestFactorySection onTarget={setFactoryTarget} />
      </AdminEditorPanel>
    </div>
  );
}

export function PeopleWorkspace({ view }) {
  switch (view) {
    case 'app-access':
      return (
        <AdminEditorPanel
          id="staff-app-access"
          title="Application access"
          description="Grant or revoke access by staff member. Changes are saved against the current canonical grant snapshot."
          scope="Per staff member"
        >
          <AppAccessSection />
        </AdminEditorPanel>
      );
    case 'identity':
      return (
        <AdminEditorPanel
          id="staff-identity-linkage"
          title="Dataverse identity linkage"
          description="Review active staff profiles and reconcile their Dataverse system-user identities."
          scope="Per staff member"
        >
          <DynamicsIdentitySection />
        </AdminEditorPanel>
      );
    case 'roles':
    default:
      return (
        <AdminEditorPanel
          id="staff-roles"
          title="Users and Dynamics Explorer roles"
          description="Assign internal Dynamics Explorer permissions. Removing a role returns the person to read-only access."
          scope="Per staff member"
        >
          <RoleManagementSection />
        </AdminEditorPanel>
      );
  }
}

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
