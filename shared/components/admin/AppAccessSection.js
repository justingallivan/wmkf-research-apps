import { useEffect, useState } from 'react';
import { APP_REGISTRY } from '../../config/appRegistry';
import { requestEnvelope, requestJson } from '../../utils/api-request';

// --- Section D: App Access Management ---
export default function AppAccessSection() {
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
