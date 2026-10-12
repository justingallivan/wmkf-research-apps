import { useEffect, useState } from 'react';
import { requestEnvelope, requestJson } from '../../utils/api-request';

// --- Section C: Role Management ---
const ROLE_OPTIONS = [
  { value: 'superuser', label: 'Superuser' },
  { value: 'read_write', label: 'Read/Write' },
  { value: 'read_only', label: 'Read Only' },
];

export default function RoleManagementSection() {
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
