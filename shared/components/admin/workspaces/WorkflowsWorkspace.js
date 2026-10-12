import DefaultFacilitatorSettings from '../../proposal-ranking/DefaultFacilitatorSettings';
import { AdminEditorPanel } from '../AdminWorkspaceNavigation';
import ReviewQuestionsSection from '../ReviewQuestionsSection';
import FinalWriteupMatrixAudiencesSection from '../FinalWriteupMatrixAudiencesSection';
import SiteVisitRecipientsSection from '../SiteVisitRecipientsSection';
import MeetingTrackerDefaultsSection from '../MeetingTrackerDefaultsSection';
import SiteVisitMaterialsDefaultsSection from '../SiteVisitMaterialsDefaultsSection';
import PoliciesSection from '../PoliciesSection';
import EmailDefaultsSection from '../EmailDefaultsSection';
import ReviewerCampaignTimelineSection from '../ReviewerCampaignTimelineSection';
import HonorariumAmountSection from '../HonorariumAmountSection';
import ReviewerTimeBudgetSection from '../ReviewerTimeBudgetSection';
import ReviewerReleaseAttachmentsSection from '../ReviewerReleaseAttachmentsSection';
import {
  appSystemSettingField,
  appSystemSettingPattern,
} from '../DataverseFieldInfoButton';

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

const EMAIL_DEFAULTS_DATAVERSE_FIELDS = [
  appSystemSettingPattern(
    'Editable email default value',
    'email.<workflow>.<subject|body>',
    'Each email default card shows its exact key in its own field mapping popover.',
  ),
];

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
