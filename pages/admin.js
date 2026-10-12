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
import UsageSection from '../shared/components/admin/UsageSection';
import HonorariumAmountSection from '../shared/components/admin/HonorariumAmountSection';
import ReviewerReleaseAttachmentsSection from '../shared/components/admin/ReviewerReleaseAttachmentsSection';
import ReviewerCampaignTimelineSection from '../shared/components/admin/ReviewerCampaignTimelineSection';
import ReviewerTimeBudgetSection from '../shared/components/admin/ReviewerTimeBudgetSection';
import RoleManagementSection from '../shared/components/admin/RoleManagementSection';

export { default as DynamicsFeedbackSection } from '../shared/components/admin/DynamicsFeedbackSection';

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
