import { useEffect, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

// --- Dynamics Identity Reconciliation ---
export default function DynamicsIdentitySection() {
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
