import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Layout, { Card } from '../shared/components/Layout';
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
import { APP_REGISTRY } from '../shared/config/appRegistry';
import { requestJson, requestEnvelope } from '../shared/utils/api-request';
import HealthSection from '../shared/components/admin/HealthSection';
import HealthHistorySection from '../shared/components/admin/HealthHistorySection';
import SystemAlertsSection from '../shared/components/admin/SystemAlertsSection';
import MaintenanceSection from '../shared/components/admin/MaintenanceSection';
import SecretExpirationSection from '../shared/components/admin/SecretExpirationSection';
import AlertRecipientsSection from '../shared/components/admin/AlertRecipientsSection';
import DynamicsFeedbackSection from '../shared/components/admin/DynamicsFeedbackSection';
import ModelConfigSection from '../shared/components/admin/ModelConfigSection';

export { default as DynamicsFeedbackSection } from '../shared/components/admin/DynamicsFeedbackSection';

const PERIOD_OPTIONS = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

function formatCost(cents) {
  if (cents == null) return '$0.00';
  return '$' + (Number(cents) / 100).toFixed(2);
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

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

// --- Section B: Usage Overview ---
function UsageSection() {
  const [period, setPeriod] = useState('30d');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    requestEnvelope(`/api/admin/stats?period=${period}`)
      .then(envelope => {
        if (envelope.status === 403) throw new Error('Admin access required');
        if (!envelope.ok) throw new Error('Failed to fetch stats');
        return envelope.data;
      })
      .then(setStats)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [period]);

  if (error) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">API Usage</h2>
        <div className="text-red-600 text-sm">{error}</div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary Cards */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">API Usage</h2>
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  period === opt.value
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm">Loading usage data...</div>
        ) : stats?.summary ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="Total Requests" value={stats.summary.total_requests} />
            <SummaryCard label="Estimated Cost" value={formatCost(stats.summary.total_cost_cents)} />
            <SummaryCard label="Active Users" value={stats.summary.unique_users} />
            <SummaryCard label="Errors" value={stats.summary.error_count} alert={stats.summary.error_count > 0} />
          </div>
        ) : (
          <div className="text-gray-500 text-sm">No usage data yet.</div>
        )}

        <div className="mt-3 flex justify-end">
          <button
            onClick={() => setDetailsOpen(o => !o)}
            className="text-xs text-gray-600 hover:text-gray-900"
          >
            {detailsOpen ? '▼ Hide breakdowns' : '▶ Show breakdowns (by user / by app / daily trend)'}
          </button>
        </div>
      </Card>

      {/* Usage by User */}
      {detailsOpen && stats?.byUser?.length > 0 && (
        <Card>
          <h3 className="text-md font-semibold text-gray-900 mb-3">Usage by User</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium text-gray-600">User</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Requests</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Tokens</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Est. Cost</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Errors</th>
                </tr>
              </thead>
              <tbody>
                {stats.byUser.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 px-2 text-gray-900">{row.user_name}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{row.request_count}</td>
                    <td className="py-2 px-2 text-right text-gray-700">
                      {formatTokens(Number(row.total_input_tokens) + Number(row.total_output_tokens))}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-700">{formatCost(row.total_cost_cents)}</td>
                    <td className={`py-2 px-2 text-right ${row.error_count > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {row.error_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Usage by App */}
      {detailsOpen && stats?.byApp?.length > 0 && (
        <Card>
          <h3 className="text-md font-semibold text-gray-900 mb-3">Usage by App</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium text-gray-600">App</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Requests</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Tokens</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Est. Cost</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {stats.byApp.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 px-2 text-gray-900">{row.app_name}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{row.request_count}</td>
                    <td className="py-2 px-2 text-right text-gray-700">
                      {formatTokens(Number(row.total_input_tokens) + Number(row.total_output_tokens))}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-700">{formatCost(row.total_cost_cents)}</td>
                    <td className="py-2 px-2 text-right text-gray-700">
                      {row.avg_latency_ms ? `${(row.avg_latency_ms / 1000).toFixed(1)}s` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Daily Trend */}
      {detailsOpen && stats?.byDay?.length > 0 && (
        <Card>
          <h3 className="text-md font-semibold text-gray-900 mb-3">Daily Trend</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium text-gray-600">Date</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Requests</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Est. Cost</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Users</th>
                </tr>
              </thead>
              <tbody>
                {stats.byDay.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 px-2 text-gray-900">{new Date(row.day).toLocaleDateString()}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{row.request_count}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{formatCost(row.total_cost_cents)}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{row.unique_users}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Review Panel ledger (never in api_usage_log — its own attempt ledger) */}
      {detailsOpen && stats?.reviewPanel && (
        <Card>
          <h3 className="text-md font-semibold text-gray-900 mb-3">Review Panel</h3>
          {stats.reviewPanel.available === false ? (
            <p className="text-sm text-gray-600">Not migrated — the review panel ledger table does not exist yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-3">
                <SummaryCard
                  label="Known Cost"
                  value={stats.reviewPanel.unknownCount > 0 ? 'Withheld' : formatCost(stats.reviewPanel.knownCostCents)}
                  alert={stats.reviewPanel.unknownCount > 0}
                />
                <SummaryCard label="Unknown-Outcome Attempts" value={stats.reviewPanel.unknownCount} alert={stats.reviewPanel.unknownCount > 0} />
              </div>
              {stats.reviewPanel.unknownCount > 0 && (
                <div className="text-xs text-red-700 mb-3">
                  Cost total withheld: {stats.reviewPanel.unknownCount} attempt(s) with unknown outcome are not counted toward the figure above.
                </div>
              )}
              {stats.reviewPanel.isolation?.available === true && (
                <div className="text-xs text-gray-600 mb-3">
                  Test requests (not included above): {stats.reviewPanel.isolation.testSpend.attemptCount} attempt(s),{' '}
                  {stats.reviewPanel.isolation.testSpend.unknownCount > 0
                    ? 'cost withheld'
                    : formatCost(stats.reviewPanel.isolation.testSpend.knownCostCents)}
                </div>
              )}
              {stats.reviewPanel.isolation?.available === false && (
                <div className="text-xs text-amber-700 mb-3">
                  Test-request spend could not be separated, so the figures above include it.
                </div>
              )}
              {stats.reviewPanel.byState?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-2 font-medium text-gray-600">State</th>
                        <th className="text-right py-2 px-2 font-medium text-gray-600">Attempts</th>
                        <th className="text-right py-2 px-2 font-medium text-gray-600">Known Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.reviewPanel.byState.map((row, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="py-2 px-2 text-gray-900">{row.state}</td>
                          <td className="py-2 px-2 text-right text-gray-700">{row.attemptCount}</td>
                          <td className="py-2 px-2 text-right text-gray-700">{row.unknownCount > 0 ? 'Withheld' : formatCost(row.knownCostCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ label, value, alert = false }) {
  return (
    <div className={`p-4 rounded-lg border ${alert ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${alert ? 'text-red-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

// --- Section C: Role Management ---
const ROLE_OPTIONS = [
  { value: 'superuser', label: 'Superuser' },
  { value: 'read_write', label: 'Read/Write' },
  { value: 'read_only', label: 'Read Only' },
];

function RoleManagementSection() {
  const [roles, setRoles] = useState(null);
  const [users, setUsers] = useState([]);
  const [callerRole, setCallerRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState('read_only');
  const [message, setMessage] = useState(null);

  const fetchRoles = () => {
    // D1 fix: the 401/403 branch is unchanged (still hides the section as
    // "denied"). Any other non-2xx status now surfaces the server's error in
    // the existing `message` banner instead of being read as if it were
    // success (docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md).
    requestEnvelope('/api/dynamics-explorer/roles')
      .then(envelope => {
        if (envelope.status === 403 || envelope.status === 401) {
          setCallerRole('denied');
          return null;
        }
        if (!envelope.ok) {
          setMessage({ type: 'error', text: envelope.error.message });
          return null;
        }
        return envelope.data;
      })
      .then(data => {
        if (!data) return;
        setCallerRole(data.callerRole);
        setRoles(data.roles || []);
      })
      .catch(() => setCallerRole('denied'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRoles();
    // D1 fix: a non-2xx response now surfaces the server's error in the
    // existing `message` banner instead of being read as if it were success.
    // The `.catch(() => {})` here still only covers network/parse failures,
    // unchanged from before (docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md).
    requestEnvelope('/api/user-profiles?all=true')
      .then(envelope => {
        // 401/403 mirrors the roles fetch: a non-superuser gets 403 from
        // `?all=true` and the section must stay hidden, not show a banner.
        if (envelope.status === 403 || envelope.status === 401) return;
        if (!envelope.ok) {
          setMessage({ type: 'error', text: envelope.error.message });
          return;
        }
        setUsers(envelope.data.profiles || []);
      })
      .catch(() => {});
  }, []);

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading...</div>;
  }

  // D1 fix: a generic (non-401/403) load failure leaves callerRole unset, so
  // this used to hide the section with no message. Reuse the same `message`
  // banner the save/remove actions already render, instead of adding a new
  // error surface (docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md).
  if (callerRole !== 'superuser') {
    if (!message) return null;
    return (
      <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${
        message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
      }`}>
        {message.text}
      </div>
    );
  }

  const assignRole = async () => {
    if (!selectedUser) return;
    setSaving(true);
    setMessage(null);
    try {
      await requestJson('/api/dynamics-explorer/roles', {
        method: 'POST',
        body: { userProfileId: parseInt(selectedUser), role: selectedRole },
        tolerantBody: true,
        fallbackMessage: 'Failed to assign role',
      });
      setMessage({ type: 'success', text: 'Role assigned' });
      setSelectedUser('');
      fetchRoles();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const removeRole = async (userProfileId, userName) => {
    if (!confirm(`Remove role from ${userName}? They will revert to read-only.`)) return;
    setMessage(null);
    try {
      const envelope = await requestEnvelope('/api/dynamics-explorer/roles', {
        method: 'DELETE',
        body: { userProfileId },
        tolerantBody: true,
      });
      if (!envelope.ok) {
        if (envelope.error?.parseError) throw envelope.error.parseError;
        throw new Error(envelope.data?.error || 'Failed to remove role');
      }
      setMessage({ type: 'success', text: `Role removed from ${userName}` });
      fetchRoles();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  // Users not yet in the roles table
  const assignedIds = new Set((roles || []).map(r => r.user_profile_id));
  const availableUsers = users.filter(u => !assignedIds.has(u.id) && u.isActive);

  return (
    <>
      {message && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Current roles */}
      {roles && roles.length > 0 ? (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 font-medium text-gray-600">User</th>
                <th className="text-left py-2 px-2 font-medium text-gray-600">Role</th>
                <th className="text-left py-2 px-2 font-medium text-gray-600">Granted By</th>
                <th className="text-right py-2 px-2 font-medium text-gray-600"></th>
              </tr>
            </thead>
            <tbody>
              {roles.map(role => (
                <tr key={role.id} className="border-b border-gray-100">
                  <td className="py-2 px-2 text-gray-900">{role.user_name}</td>
                  <td className="py-2 px-2">
                    <span className={`inline-flex min-h-6 items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      role.role === 'superuser' ? 'bg-purple-100 text-purple-800' :
                      role.role === 'read_write' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {role.role}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-gray-500">{role.granted_by_name || '-'}</td>
                  <td className="py-2 px-2 text-right">
                    <button
                      onClick={() => removeRole(role.user_profile_id, role.user_name)}
                      className="text-xs text-red-600 hover:text-red-800 transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500 text-sm mb-6">No roles assigned yet.</p>
      )}

      {/* Assign role form */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">User</label>
          <select
            value={selectedUser}
            onChange={e => setSelectedUser(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-gray-400"
          >
            <option value="">Select user...</option>
            {availableUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name}{u.azureEmail ? ` (${u.azureEmail})` : ''}</option>
            ))}
            {/* Also allow re-assigning existing users to change their role */}
            {roles && roles.length > 0 && (
              <optgroup label="Change existing role">
                {roles.map(r => (
                  <option key={`existing-${r.user_profile_id}`} value={r.user_profile_id}>
                    {r.user_name} (currently {r.role})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
          <select
            value={selectedRole}
            onChange={e => setSelectedRole(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-gray-400"
          >
            {ROLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={assignRole}
          disabled={!selectedUser || saving}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Assigning...' : 'Assign'}
        </button>
      </div>
    </>
  );
}

// --- Section D: App Access Management ---
export function AppAccessSection() {
  const [serverGrants, setServerGrants] = useState(null); // truth from API
  const [localGrants, setLocalGrants] = useState({});      // editable working copy: { userId: Set(appKeys) }
  const [allApps, setAllApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [snapshotStale, setSnapshotStale] = useState(false);

  // Build the server-state map and local working copy
  const applyServerData = (data) => {
    setServerGrants(data.grants || []);
    setAllApps(data.allApps || []);
    const local = {};
    (data.grants || []).forEach(g => {
      local[g.user_profile_id] = new Set(g.apps || []);
    });
    setLocalGrants(local);
  };

  const fetchGrants = async () => {
    try {
      const envelope = await requestEnvelope('/api/app-access?all=true');
      if (envelope.status === 403 || envelope.status === 401) {
        setIsSuperuser(false);
        setSnapshotStale(true);
        return 'unauthorized';
      }
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) {
        throw new Error(envelope.data.error || 'Unable to load app access grants');
      }
      setIsSuperuser(true);
      setSnapshotStale(false);
      setMessage(null);
      applyServerData(envelope.data);
      return 'ok';
    } catch (error) {
      // The admin page is already superuser-only. Keep this section visible so
      // a transport failure cannot masquerade as "no users/no grants."
      setIsSuperuser(true);
      setSnapshotStale(true);
      setMessage({ type: 'error', text: error.message });
      return 'error';
    } finally {
      setLoading(false);
    }
  };

  // Mount-only initial load; fetchGrants reads no reactive state (setters only).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchGrants(); }, []);

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading...</div>;
  }

  if (!isSuperuser) {
    return message ? (
      <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800 border border-red-200">
        {message.text}
      </div>
    ) : null;
  }

  const visibleAppSet = new Set(allApps);
  const visibleOnlySet = (keys) => new Set([...keys].filter(k => visibleAppSet.has(k)));

  // Toggle a single checkbox in local state
  const toggle = (userId, appKey) => {
    setLocalGrants(prev => {
      const next = { ...prev };
      const set = new Set(next[userId] || []);
      if (set.has(appKey)) set.delete(appKey); else set.add(appKey);
      next[userId] = set;
      return next;
    });
  };

  // Select / deselect all apps for a user
  const toggleAll = (userId) => {
    setLocalGrants(prev => {
      const next = { ...prev };
      const current = next[userId] || new Set();
      const nextSet = new Set(current);
      const hasAllVisibleApps = allApps.length > 0 && allApps.every(appKey => nextSet.has(appKey));
      allApps.forEach(appKey => {
        if (hasAllVisibleApps) nextSet.delete(appKey);
        else nextSet.add(appKey);
      });
      next[userId] = nextSet;
      return next;
    });
  };

  // Compute diff between server state and local edits
  const computeDiff = () => {
    const changes = []; // { userId, toGrant: [], toRevoke: [] }
    if (!serverGrants) return changes;
    for (const grant of serverGrants) {
      const uid = grant.user_profile_id;
      const serverSet = visibleOnlySet(new Set(grant.apps || []));
      const localSet = visibleOnlySet(localGrants[uid] || new Set());
      const toGrant = [...localSet].filter(k => !serverSet.has(k));
      const toRevoke = [...serverSet].filter(k => !localSet.has(k));
      if (toGrant.length > 0 || toRevoke.length > 0) {
        changes.push({ userId: uid, toGrant, toRevoke });
      }
    }
    return changes;
  };

  const diff = computeDiff();
  const hasChanges = diff.length > 0;

  // Save all pending changes
  const saveAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      for (const { userId, toGrant, toRevoke } of diff) {
        if (toGrant.length > 0) {
          await requestJson('/api/app-access', {
            method: 'POST',
            body: { userProfileId: userId, apps: toGrant },
            tolerantBody: true,
            fallbackMessage: 'Grant failed',
          });
        }
        if (toRevoke.length > 0) {
          await requestJson('/api/app-access', {
            method: 'DELETE',
            body: { userProfileId: userId, apps: toRevoke },
            tolerantBody: true,
            fallbackMessage: 'Revoke failed',
          });
        }
      }
      const totalGrants = diff.reduce((n, d) => n + d.toGrant.length, 0);
      const totalRevokes = diff.reduce((n, d) => n + d.toRevoke.length, 0);
      const parts = [];
      if (totalGrants) parts.push(`${totalGrants} granted`);
      if (totalRevokes) parts.push(`${totalRevokes} revoked`);
      const refreshed = await fetchGrants();
      setMessage(refreshed === 'ok'
        ? { type: 'success', text: `Saved: ${parts.join(', ')}` }
        : {
            type: 'error',
            text: refreshed === 'unauthorized'
              ? 'Changes were saved, but your admin session expired before the grant snapshot could be reloaded. Sign in again to verify the current grants.'
              : 'Changes were saved, but the current grant snapshot could not be reloaded. Refresh before editing again.',
          });
    } catch (err) {
      // A batch may have completed a prefix before the API returned non-2xx.
      // Always replace both server and local state from the canonical snapshot
      // before allowing Discard or another edit.
      const refreshed = await fetchGrants();
      setMessage({
        type: 'error',
        text: refreshed === 'ok'
          ? `${err.message}. Current grants were reloaded.`
          : refreshed === 'unauthorized'
            ? `${err.message}. Your admin session expired before current grants could be reloaded; sign in again to verify them.`
            : `${err.message}. Current grants could not be reloaded; refresh before editing again.`,
      });
    } finally {
      setSaving(false);
    }
  };

  // Discard local edits
  const discardChanges = () => {
    const local = {};
    (serverGrants || []).forEach(g => {
      local[g.user_profile_id] = new Set(g.apps || []);
    });
    setLocalGrants(local);
    setMessage(null);
  };

  // Soft-archive a user (sets is_active=false). The row stays for audit
  // integrity but auth/app-access lookups exclude inactive profiles.
  const removeUser = async (userId, userName) => {
    if (!confirm(`Remove ${userName || `user ${userId}`}? They will lose login and app access. The profile row is preserved for audit history.`)) return;
    setSaving(true);
    setMessage(null);
    try {
      const envelope = await requestEnvelope(`/api/admin/users?id=${userId}`, { method: 'DELETE' });
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data.error || 'Remove failed');
      const removedName = envelope.data.name || userName || userId;
      const refreshed = await fetchGrants();
      setMessage(refreshed === 'ok'
        ? { type: 'success', text: `Removed ${removedName}` }
        : {
            type: 'error',
            text: refreshed === 'unauthorized'
              ? `Removed ${removedName}, but your admin session expired before the grant snapshot could be reloaded. Sign in again to verify the current grants.`
              : `Removed ${removedName}, but the current grant snapshot could not be reloaded. Refresh before editing again.`,
          });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  // Short labels for column headers
  const appShortNames = {};
  APP_REGISTRY.forEach(app => {
    // Use first word or abbreviation to keep columns narrow
    appShortNames[app.key] = app.name;
  });

  return (
    <>
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              onClick={discardChanges}
              disabled={snapshotStale || saving}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Discard
            </button>
          )}
          <button
            onClick={saveAll}
            disabled={!hasChanges || saving || snapshotStale}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : hasChanges ? `Save Changes` : 'No Changes'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
          {snapshotStale && (
            <button
              type="button"
              onClick={fetchGrants}
              className="ml-2 underline font-medium"
            >
              Retry grant reload
            </button>
          )}
        </div>
      )}

      {serverGrants && serverGrants.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 font-medium text-gray-600 sticky left-0 bg-white z-10 min-w-[140px]">User</th>
                {allApps.map(appKey => (
                  <th key={appKey} className="py-2 px-1 font-medium text-gray-500 text-center min-w-[40px]" title={appShortNames[appKey]}>
                    <div className="writing-mode-vertical text-xs leading-tight" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', maxHeight: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {appShortNames[appKey]}
                    </div>
                  </th>
                ))}
                <th className="py-2 px-2 text-center font-medium text-gray-500 text-xs min-w-[50px]">All</th>
                <th className="py-2 px-2 text-center font-medium text-gray-500 text-xs min-w-[60px]"></th>
              </tr>
            </thead>
            <tbody>
              {serverGrants.map(grant => {
                const uid = grant.user_profile_id;
                const localSet = localGrants[uid] || new Set();
                const serverSet = visibleOnlySet(new Set(grant.apps || []));
                const allChecked = allApps.length > 0 && allApps.every(appKey => localSet.has(appKey));
                return (
                  <tr key={uid} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-2 text-gray-900 whitespace-nowrap sticky left-0 bg-white z-10">
                      <div className="text-sm font-medium">{grant.user_name}</div>
                      {grant.azure_email && (
                        <div className="text-xs text-gray-400">{grant.azure_email}</div>
                      )}
                    </td>
                    {allApps.map(appKey => {
                      const checked = localSet.has(appKey);
                      const changed = checked !== serverSet.has(appKey);
                      return (
                        <td key={appKey} className="py-2 px-1 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${appShortNames[appKey]} access for ${grant.user_name}`}
                            checked={checked}
                            disabled={snapshotStale || saving}
                            onChange={() => toggle(uid, appKey)}
                            className={`rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer ${changed ? 'ring-2 ring-amber-400' : ''}`}
                          />
                        </td>
                      );
                    })}
                    <td className="py-2 px-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${allChecked ? 'Remove' : 'Grant'} all application access for ${grant.user_name}`}
                        checked={allChecked}
                        disabled={snapshotStale || saving}
                        onChange={() => toggleAll(uid)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        title={allChecked ? 'Deselect all' : 'Select all'}
                      />
                    </td>
                    <td className="py-2 px-2 text-center">
                      <button
                        onClick={() => removeUser(uid, grant.user_name)}
                        disabled={snapshotStale || saving}
                        title="Soft-archive this user (sets is_active=false). The row is preserved for audit history."
                        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : serverGrants !== null && !snapshotStale ? (
        <p className="text-gray-500 text-sm">No users found.</p>
      ) : null}

      {hasChanges && (
        <p className="text-xs text-amber-600 mt-3">
          Unsaved changes for {diff.length} user(s). Changed checkboxes are highlighted.
        </p>
      )}
    </>
  );
}

// --- Dynamics Identity Reconciliation ---
function DynamicsIdentitySection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [message, setMessage] = useState(null);

  const fetchUsers = () => {
    setLoading(true);
    requestEnvelope('/api/user-profiles?all=true')
      .then(envelope => (envelope.ok ? envelope.data : null))
      .then(data => {
        if (!data) return;
        setUsers((data.profiles || []).filter(u => u.isActive));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const reconcile = async (all = false) => {
    setReconciling(true);
    setMessage(null);
    try {
      const envelope = await requestEnvelope('/api/admin/reconcile-identities', {
        method: 'POST',
        body: { all },
      });
      if (envelope.error?.parseError) throw envelope.error.parseError;
      const data = envelope.data;
      if (!envelope.ok) throw new Error(data.error || data.message || 'Reconcile failed');
      const s = data.summary || {};
      const parts = [];
      if (s.linked) parts.push(`${s.linked} linked`);
      if (s.unchanged) parts.push(`${s.unchanged} unchanged`);
      if (s.no_match) parts.push(`${s.no_match} no match`);
      if (s.disabled) parts.push(`${s.disabled} disabled`);
      if (s.error) parts.push(`${s.error} errors`);
      setMessage({ type: 'success', text: `Scanned ${data.totalScanned}: ${parts.join(', ') || 'no changes'}` });
      fetchUsers();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setReconciling(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading...</div>;
  }

  if (users.length === 0) return null; // not superuser (filtered list returned empty)

  const linked = users.filter(u => u.dynamicsSystemuserId).length;
  const formatDate = (d) => d ? new Date(d).toLocaleDateString() : 'never';

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-500">{linked} of {users.length} active users linked to a Dynamics systemuser.</p>
        <div className="flex gap-2">
          <button
            onClick={() => reconcile(false)}
            disabled={reconciling}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            {reconciling ? 'Reconciling...' : 'Reconcile stale'}
          </button>
          <button
            onClick={() => reconcile(true)}
            disabled={reconciling}
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-40"
          >
            Reconcile all
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 font-medium text-gray-600">User</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Status</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Systemuser ID</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Last checked</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-gray-100">
                <td className="py-2 px-2 text-gray-900">{u.displayName || u.name}</td>
                <td className="py-2 px-2">
                  {u.dynamicsSystemuserId ? (
                    <span className="inline-flex min-h-6 items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">✓ linked</span>
                  ) : (
                    <span className="inline-flex min-h-6 items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">not linked</span>
                  )}
                </td>
                <td className="py-2 px-2 text-gray-500 font-mono text-xs">{u.dynamicsSystemuserId || '-'}</td>
                <td className="py-2 px-2 text-gray-500 text-xs">{formatDate(u.dynamicsReconciledAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function HonorariumAmountSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [malformed, setMalformed] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const envelope = await requestEnvelope('/api/admin/honorarium-amount');
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Failed to load');
      const data = envelope.data;
      setAmount(String(data.amount ?? ''));
      setIsDefault(!!data.isDefault);
      setMalformed(!!data.malformed);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const n = Number(String(amount).trim());
      if (!Number.isFinite(n) || n <= 0) throw new Error('Enter a positive number');
      const envelope = await requestEnvelope('/api/admin/honorarium-amount', {
        method: 'PUT',
        body: { amount: n },
      });
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Save failed');
      setSavedAt(new Date());
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        The single reviewer-honorarium amount (USD). Read live when a reviewer accepts
        (the honorarium record + BILL onboarding) and when Review Manager renders invitation
        emails. Changing it affects future honoraria only; existing records keep the amount
        stamped at creation.
      </p>
      {isDefault && (
        <p className="text-xs text-amber-700">
          No value is set — the documented default of $250 is in effect until you save one.
        </p>
      )}
      {malformed && (
        <p className="text-xs text-red-700">
          The stored value is not a valid positive number; save a correct value.
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-gray-500">$</span>
        <input
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt && <span className="text-xs text-green-700">Saved</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReviewerReleaseAttachmentsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/release-settings');
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Failed to load');
      setEnabled(!!envelope.data.attachProposalEmail);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async () => {
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/release-settings', {
        method: 'PUT',
        body: { attachProposalEmail: next },
      });
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Save failed');
      setEnabled(!!envelope.data.attachProposalEmail);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        When ON, the release (materials) email offers the SharePoint proposal auto-attach
        and manual file uploads as email attachments, in addition to the reviewer&apos;s
        secure portal link. When OFF (default), the release email is portal-link-only —
        no attachment is uploaded to Blob or sent. Read live every time the release email
        modal opens.
      </p>
      <label className="flex items-center gap-2 text-sm text-gray-900">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={toggle}
          className="h-4 w-4"
        />
        Attach proposal/files to the release email (in addition to the portal link)
      </label>
      {savedAt && <span className="text-xs text-green-700">Saved</span>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReviewerCampaignTimelineSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timeline, setTimeline] = useState({
    cycleLabel: '',
    inviteStartDate: '',
    respondOffsetDays: 7,
    proposalReleaseDate: '',
    reviewDueDate: '',
    desiredCount: 4,
  });
  const [isDefault, setIsDefault] = useState(false);
  const [malformed, setMalformed] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/campaign-timeline-defaults');
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Failed to load');
      const data = envelope.data;
      setTimeline({
        cycleLabel: data.timeline?.cycleLabel || '',
        inviteStartDate: data.timeline?.inviteStartDate || '',
        respondOffsetDays: data.timeline?.respondOffsetDays == null ? '' : data.timeline.respondOffsetDays,
        proposalReleaseDate: data.timeline?.proposalReleaseDate || '',
        reviewDueDate: data.timeline?.reviewDueDate || '',
        desiredCount: data.timeline?.desiredCount == null ? '' : data.timeline.desiredCount,
      });
      setIsDefault(!!data.isDefault);
      setMalformed(!!data.malformed);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const update = (field, value) => {
    setTimeline((prev) => ({ ...prev, [field]: value }));
  };

  const normalizeOffsetInput = (value) => {
    if (value === '') return '';
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : '';
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const respondOffsetDays = timeline.respondOffsetDays === ''
        ? null
        : Number(timeline.respondOffsetDays);
      const desiredCount = timeline.desiredCount === ''
        ? null
        : Number(timeline.desiredCount);
      const envelope = await requestEnvelope('/api/review-manager/campaign-timeline-defaults', {
        method: 'PUT',
        body: {
          timeline: {
            ...timeline,
            respondOffsetDays,
            desiredCount,
          },
        },
      });
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Save failed');
      setSavedAt(new Date());
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Current-cycle defaults for reviewer invitation copy. The invitation modal
        uses these values first, then overlays request-specific campaign settings
        when a proposal already has them.
      </p>
      {isDefault && (
        <p className="text-xs text-amber-700">
          No cycle defaults are set yet — the invitation modal will fall back to its built-in timing defaults.
        </p>
      )}
      {malformed && (
        <p className="text-xs text-red-700">
          The stored timeline JSON is malformed; save a clean set of dates.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs text-gray-600">
          Grant cycle label
          <input
            type="text"
            value={timeline.cycleLabel}
            onChange={(e) => update('cycleLabel', e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            placeholder="D26"
          />
        </label>
        <label className="text-xs text-gray-600">
          Reviewer invitations begin
          <input
            type="date"
            value={timeline.inviteStartDate}
            onChange={(e) => update('inviteStartDate', e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="text-xs text-gray-600">
          Days to respond to invitation
          <input
            type="number"
            min="0"
            step="1"
            value={timeline.respondOffsetDays}
            onChange={(e) => update('respondOffsetDays', normalizeOffsetInput(e.target.value))}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="text-xs text-gray-600">
          Reviewer quota
          <input
            type="number"
            min="0"
            step="1"
            value={timeline.desiredCount}
            onChange={(e) => update('desiredCount', normalizeOffsetInput(e.target.value))}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
          <span className="mt-1 block text-xs text-gray-400">
            Default number of committed reviewers before the PD is notified. Seeds new campaigns&apos; settings.
          </span>
        </label>
        <label className="text-xs text-gray-600">
          Proposals released to reviewers
          <input
            type="date"
            value={timeline.proposalReleaseDate}
            onChange={(e) => update('proposalReleaseDate', e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="text-xs text-gray-600">
          Reviews due
          <input
            type="date"
            value={timeline.reviewDueDate}
            onChange={(e) => update('reviewDueDate', e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt && <span className="text-xs text-green-700">Saved</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReviewerTimeBudgetSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seconds, setSeconds] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [malformed, setMalformed] = useState(false);
  const [bounds, setBounds] = useState({ min: 120, max: 800 });
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const envelope = await requestEnvelope('/api/admin/reviewer-time-budget');
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Failed to load');
      const data = envelope.data;
      setSeconds(String(data.seconds ?? ''));
      setIsDefault(!!data.isDefault);
      setMalformed(!!data.malformed);
      setBounds({ min: data.min ?? 120, max: data.max ?? 800 });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const n = Number(String(seconds).trim());
      if (!Number.isFinite(n) || n <= 0) throw new Error('Enter a positive number of seconds');
      const envelope = await requestEnvelope('/api/admin/reviewer-time-budget', {
        method: 'PUT',
        body: { seconds: n },
      });
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Save failed');
      setSavedAt(new Date());
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Maximum time a reviewer search (analyze, discover, enrich, generate emails) may run
        before it stops gracefully with a clear message. Raise it if searches are being cut
        off; lower it to fail faster. The platform hard cap is {bounds.max}s
        ({Math.round(bounds.max / 60)} min) and the floor is {bounds.min}s — values outside
        that range are clamped.
      </p>
      {isDefault && (
        <p className="text-xs text-amber-700">
          No value is set — the default of 600s (10 min) is in effect until you save one.
        </p>
      )}
      {malformed && (
        <p className="text-xs text-red-700">
          The stored value is not a valid positive number; save a correct value.
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={bounds.min}
          max={bounds.max}
          step="10"
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-gray-500 text-sm">seconds</span>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt && <span className="text-xs text-green-700">Saved</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

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

function ResourceLinks({ title, links }) {
  return (
    <section aria-labelledby={`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-title`}>
      <h2 id={`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-title`} className="text-sm font-semibold text-gray-950">{title}</h2>
      <div className="mt-2 divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target={link.external ? '_blank' : undefined}
            rel={link.external ? 'noopener noreferrer' : undefined}
            className="block px-4 py-3 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500"
          >
            <span className="text-sm font-semibold text-gray-950">{link.name}</span>
            <span className="mt-0.5 block text-sm text-gray-600">{link.description}</span>
          </a>
        ))}
      </div>
    </section>
  );
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
