import { useEffect, useState } from 'react';
import DataverseFieldInfoButton, { appSystemSettingField } from './DataverseFieldInfoButton';

const TONE = {
  saved: 'text-green-700',
  error: 'text-red-700',
  muted: 'text-gray-500',
};

export default function EmailDefaultsSection() {
  const [defaults, setDefaults] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [statusByKey, setStatusByKey] = useState({});
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/email-defaults');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load email defaults.');
      const nextDefaults = data.defaults || [];
      setDefaults(nextDefaults);
      setDrafts(Object.fromEntries(nextDefaults.map((entry) => [entry.key, String(entry.value ?? '')])));
      setStatusByKey({});
    } catch (err) {
      setError(err.message || 'Failed to load email defaults.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateDraft = (key, value) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
    setStatusByKey((prev) => ({ ...prev, [key]: null }));
  };

  const save = async (entry) => {
    const value = drafts[entry.key] ?? '';
    setSavingKey(entry.key);
    setStatusByKey((prev) => ({ ...prev, [entry.key]: null }));
    try {
      const res = await fetch('/api/admin/email-defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: entry.key, value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Save failed.');
      setDefaults((prev) => (prev || []).map((item) => (
        item.key === entry.key ? { ...item, value, unavailable: false } : item
      )));
      setStatusByKey((prev) => ({ ...prev, [entry.key]: { tone: 'saved', text: 'Saved' } }));
    } catch (err) {
      setStatusByKey((prev) => ({
        ...prev,
        [entry.key]: { tone: 'error', text: err.message || 'Save failed.' },
      }));
    } finally {
      setSavingKey(null);
    }
  };

  if (loading && !defaults) return <p className="text-sm text-gray-500">Loading...</p>;
  if (error && !defaults) return <p className="text-sm text-red-700">{error}</p>;
  if (!defaults || defaults.length === 0) return <p className="text-sm text-gray-500">No editable email defaults found.</p>;

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        Edit default copy used by email workflows. Blank values are allowed, but blank
        invitation defaults block sends until an admin configures them.
      </p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {defaults.map((entry) => {
        const value = drafts[entry.key] ?? '';
        const status = statusByKey[entry.key];
        const Input = entry.multiline ? 'textarea' : 'input';
        const dataverseFields = [
          appSystemSettingField(entry.label, entry.key, 'The admin editor reads and writes this setting value.'),
        ];
        return (
          <section key={entry.key} className="border border-gray-200 rounded-lg p-4 space-y-3">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{entry.label}</h3>
                  {entry.unavailable ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                      unavailable — settings read failed
                    </span>
                  ) : value === '' ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                      blank — not configured
                    </span>
                  ) : null}
                </div>
                <DataverseFieldInfoButton items={dataverseFields} />
              </div>
              <p className="text-xs text-gray-500 mt-1">{entry.description}</p>
              {entry.placeholders?.length ? (
                <p className="text-xs text-gray-500 mt-1">
                  Placeholders: {entry.placeholders.map((token) => <code key={token}>{token}</code>).reduce((acc, node, i) => (
                    i === 0 ? [node] : [...acc, ', ', node]
                  ), [])}
                </p>
              ) : null}
            </div>

            <Input
              type={entry.multiline ? undefined : 'text'}
              value={value}
              onChange={(e) => updateDraft(entry.key, e.target.value)}
              rows={entry.multiline ? 12 : undefined}
              disabled={entry.unavailable}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono disabled:bg-gray-50 disabled:text-gray-500"
              aria-label={entry.label}
            />

            <div className="flex items-center justify-between gap-3">
              <span className={`text-xs ${status ? TONE[status.tone] : TONE.muted}`}>
                {status?.text || (entry.unavailable ? 'Reload before editing this setting.' : `${value.length} chars`)}
              </span>
              <div className="flex items-center gap-2">
                {entry.unavailable && (
                  <button
                    type="button"
                    onClick={load}
                    className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Reload
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => save(entry)}
                  disabled={savingKey === entry.key || entry.unavailable}
                  className="px-3 py-1.5 text-sm rounded bg-blue-700 text-white disabled:opacity-50"
                >
                  {savingKey === entry.key ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
