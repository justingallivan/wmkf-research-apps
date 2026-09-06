import { useEffect, useState } from 'react';

/**
 * Superuser-managed safeguards for the Dynamics Explorer query surface.
 * These rules limit Explorer queries/exports; they do not change underlying
 * Dynamics permissions.
 */
export default function DynamicsExplorerRestrictionsSection({ userProfileId }) {
  const [restrictions, setRestrictions] = useState([]);
  const [newRestriction, setNewRestriction] = useState({ table_name: '', field_name: '', reason: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dynamics-explorer/restrictions')
      .then((response) => response.json())
      .then((data) => {
        setRestrictions(data.restrictions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const addRestriction = async () => {
    if (!newRestriction.table_name) return;
    const response = await fetch('/api/dynamics-explorer/restrictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newRestriction, userProfileId }),
    });
    const data = await response.json();
    if (data.restriction) {
      setRestrictions((previous) => [...previous, data.restriction]);
      setNewRestriction({ table_name: '', field_name: '', reason: '' });
    }
  };

  const removeRestriction = async (id) => {
    await fetch('/api/dynamics-explorer/restrictions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, userProfileId }),
    });
    setRestrictions((previous) => previous.filter((restriction) => restriction.id !== id));
  };

  if (loading) return <p className="text-sm text-gray-500">Loading safeguards…</p>;

  return (
    <div className="space-y-4">
      {restrictions.length > 0 ? (
        <div className="space-y-2">
          {restrictions.map((restriction) => (
            <div key={restriction.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              <span className="min-w-0 break-words">
                <span className="font-mono text-xs">{restriction.table_name}</span>
                {restriction.field_name && <span className="font-mono text-xs">.{restriction.field_name}</span>}
                <span className="ml-2 text-gray-500">({restriction.restriction_type})</span>
                {restriction.reason && <span className="ml-1 text-gray-500">— {restriction.reason}</span>}
              </span>
              <button
                type="button"
                onClick={() => removeRestriction(restriction.id)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">No Explorer safeguards configured.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-gray-600">
          Table name
          <input
            value={newRestriction.table_name}
            onChange={(event) => setNewRestriction((previous) => ({ ...previous, table_name: event.target.value }))}
            className="mt-1 w-40 rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="text-xs font-medium text-gray-600">
          Field (optional)
          <input
            value={newRestriction.field_name}
            onChange={(event) => setNewRestriction((previous) => ({ ...previous, field_name: event.target.value }))}
            className="mt-1 w-36 rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="text-xs font-medium text-gray-600">
          Reason
          <input
            value={newRestriction.reason}
            onChange={(event) => setNewRestriction((previous) => ({ ...previous, reason: event.target.value }))}
            className="mt-1 w-48 rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <button type="button" onClick={addRestriction} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2">
          Add safeguard
        </button>
      </div>
    </div>
  );
}
