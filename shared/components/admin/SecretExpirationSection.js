import { useEffect, useState } from 'react';
import { Card } from '../Layout';
import DataverseFieldInfoButton, { appSystemSettingPattern } from './DataverseFieldInfoButton';
import { requestEnvelope } from '../../utils/api-request';

const SECRET_EXPIRATION_DATAVERSE_FIELDS = [
  appSystemSettingPattern(
    'Expiration date',
    'secret_expiration:<secret key>',
    'The status and days-left columns are computed from this stored date.',
  ),
  appSystemSettingPattern('Last rotated date', 'secret_rotation:<secret key>'),
];

// --- Section A5: Secret Expiration ---
export default function SecretExpirationSection() {
  const [secrets, setSecrets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState(null);
  const [editValues, setEditValues] = useState({ rotationDate: '', expirationDate: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fetchSecrets = () => {
    requestEnvelope('/api/admin/secrets')
      .then(envelope => {
        if (!envelope.ok) throw new Error('Credential expiration data could not be loaded.');
        return envelope.data;
      })
      .then(data => setSecrets(data?.secrets || []))
      .catch((loadError) => {
        setSecrets([]);
        setError(loadError.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSecrets(); }, []);

  const startEdit = (secret) => {
    setEditingKey(secret.key);
    setEditValues({
      rotationDate: secret.lastRotated || '',
      expirationDate: secret.expirationDate || '',
    });
  };

  const saveEdit = async () => {
    if (!editValues.rotationDate && !editValues.expirationDate) return;
    setSaving(true);
    setError(null);
    try {
      const envelope = await requestEnvelope('/api/admin/secrets', {
        method: 'PUT',
        body: { key: editingKey, ...editValues },
        tolerantBody: true,
      });
      if (envelope.ok) {
        setEditingKey(null);
        fetchSecrets();
      } else {
        setError(envelope.data?.error || 'The credential dates could not be saved.');
      }
    } catch (err) {
      setError(err.message || 'The credential dates could not be saved.');
    }
    setSaving(false);
  };

  const statusBadge = (status) => {
    const colors = {
      ok: 'bg-green-100 text-green-800',
      attention: 'bg-yellow-100 text-yellow-700',
      warning: 'bg-orange-100 text-orange-800',
      critical: 'bg-red-100 text-red-800',
      expired: 'bg-red-200 text-red-900',
      not_tracked: 'bg-gray-100 text-gray-500',
    };
    return (
      <span className={`inline-flex min-h-6 items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.not_tracked}`}>
        {status === 'not_tracked' ? 'not set' : status}
      </span>
    );
  };

  if (loading) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Secret Expiration Tracking</h2>
        <div className="text-gray-500 text-sm">Loading...</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Secret Expiration Tracking</h2>
        <DataverseFieldInfoButton items={SECRET_EXPIRATION_DATAVERSE_FIELDS} />
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Set expiration dates to receive automated alerts as secrets approach expiry. Dates are checked daily at 8:00 AM UTC.
      </p>
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setLoading(true);
              fetchSecrets();
            }}
            className="ml-3 font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 font-medium text-gray-600">Secret</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Status</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Expires</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Last Rotated</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600">Days Left</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody>
            {secrets.map(secret => (
              <tr key={secret.key} className="border-b border-gray-100">
                <td className="py-2 px-2 text-gray-900 font-medium text-xs">{secret.name}</td>
                <td className="py-2 px-2">{statusBadge(secret.status)}</td>
                {editingKey === secret.key ? (
                  <>
                    <td className="py-2 px-2">
                      <input
                        type="date"
                        value={editValues.expirationDate}
                        onChange={e => setEditValues(v => ({ ...v, expirationDate: e.target.value }))}
                        className="px-2 py-1 border border-gray-300 rounded text-xs w-32"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="date"
                        value={editValues.rotationDate}
                        onChange={e => setEditValues(v => ({ ...v, rotationDate: e.target.value }))}
                        className="px-2 py-1 border border-gray-300 rounded text-xs w-32"
                      />
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button onClick={saveEdit} disabled={saving} className="text-xs text-green-700 hover:text-green-900 mr-2">
                        {saving ? '...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingKey(null)} className="text-xs text-gray-500 hover:text-gray-700">
                        Cancel
                      </button>
                    </td>
                    <td />
                  </>
                ) : (
                  <>
                    <td className="py-2 px-2 text-gray-600 text-xs">{secret.expirationDate || '-'}</td>
                    <td className="py-2 px-2 text-gray-600 text-xs">{secret.lastRotated || '-'}</td>
                    <td className="py-2 px-2 text-right text-gray-700 text-xs">
                      {secret.daysUntilExpiry !== null ? secret.daysUntilExpiry : '-'}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button onClick={() => startEdit(secret)} className="text-xs text-blue-600 hover:text-blue-800">
                        Edit
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

