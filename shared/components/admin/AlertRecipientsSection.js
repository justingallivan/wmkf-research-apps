import { useEffect, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

// --- Alert Recipients ---
//
// UI for the per-category alert routing config persisted as
// `alertRecipientsByCategory` in wmkf_appsystemsettings. Free-form category
// names allowed; SEED_CATEGORIES from the server provides discoverability
// scaffolding only.
export default function AlertRecipientsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState([]);
  const [fallback, setFallback] = useState([]);
  const [rows, setRows] = useState([]); // [{ category, description, emails: string[], newEmail: '' }]
  const [newCategory, setNewCategory] = useState('');
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const envelope = await requestEnvelope('/api/admin/alert-recipients');
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Failed to load');
      const data = envelope.data;
      const seedCats = data.seedCategories || [];
      const config = data.config || {};
      setSeed(seedCats);
      setFallback(data.fallbackRoster || []);

      // Merge: every seed category appears (even if empty), plus any custom
      // categories that exist in the saved config.
      const merged = [];
      const seenKeys = new Set();
      for (const s of seedCats) {
        merged.push({
          category: s.key,
          description: s.description,
          emails: config[s.key] || [],
          newEmail: '',
        });
        seenKeys.add(s.key);
      }
      for (const [cat, emails] of Object.entries(config)) {
        if (seenKeys.has(cat)) continue;
        merged.push({ category: cat, description: '', emails, newEmail: '' });
      }
      setRows(merged);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addEmail = (idx) => {
    setRows((prev) => {
      const copy = [...prev];
      const target = { ...copy[idx] };
      const e = (target.newEmail || '').trim().toLowerCase();
      if (!e) return prev;
      if (target.emails.includes(e)) {
        target.newEmail = '';
        copy[idx] = target;
        return copy;
      }
      target.emails = [...target.emails, e];
      target.newEmail = '';
      copy[idx] = target;
      return copy;
    });
  };

  const removeEmail = (idx, email) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], emails: copy[idx].emails.filter((e) => e !== email) };
      return copy;
    });
  };

  const updateNew = (idx, val) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], newEmail: val };
      return copy;
    });
  };

  const addCategory = () => {
    const key = newCategory.trim().toLowerCase();
    if (!key) return;
    if (rows.some((r) => r.category === key)) {
      setNewCategory('');
      return;
    }
    setRows((prev) => [...prev, { category: key, description: '', emails: [], newEmail: '' }]);
    setNewCategory('');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Build config: drop categories with no emails (server normalizes too,
      // but doing it here keeps the request shape tidy).
      const config = {};
      for (const r of rows) {
        if (r.emails.length) config[r.category] = r.emails;
      }
      const envelope = await requestEnvelope('/api/admin/alert-recipients', {
        method: 'PUT',
        body: { config },
      });
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) {
        const data = envelope.data;
        const detail = Array.isArray(data?.details) ? `: ${data.details.join('; ')}` : '';
        throw new Error((data?.error || 'Save failed') + detail);
      }
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
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Each alert is tagged with a category. Categories with no addresses listed fall
        back to <code className="text-xs">default</code>, then to the active superuser
        roster (currently:{' '}
        {fallback.length ? <strong>{fallback.join(', ')}</strong> : <em>none</em>}).
      </p>

      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div key={row.category} className="border rounded-md p-3 bg-gray-50">
            <div className="flex items-baseline justify-between mb-1">
              <div>
                <code className="text-sm font-semibold text-gray-900">{row.category}</code>
                {row.description && (
                  <span className="ml-2 text-xs text-gray-500">— {row.description}</span>
                )}
              </div>
              {row.emails.length === 0 && (
                <span className="text-xs text-gray-400 italic">
                  uses {row.category === 'default' ? 'superuser roster' : 'default'}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {row.emails.map((e) => (
                <span
                  key={e}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-white border rounded text-xs"
                >
                  {e}
                  <button
                    type="button"
                    onClick={() => removeEmail(idx, e)}
                    className="text-gray-400 hover:text-red-600"
                    title={`Remove ${e}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="add address…"
                value={row.newEmail}
                onChange={(e) => updateNew(idx, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(idx); } }}
                className="flex-1 px-2 py-1 border rounded text-xs"
              />
              <button
                type="button"
                onClick={() => addEmail(idx)}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
              >
                Add
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 items-center pt-2 border-t">
        <input
          type="text"
          placeholder="new category name (lowercase, no spaces)"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value.replace(/[^a-z0-9_-]/gi, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
          className="flex-1 px-2 py-1 border rounded text-sm"
        />
        <button
          type="button"
          onClick={addCategory}
          className="px-3 py-1 border border-gray-300 hover:bg-gray-100 rounded text-sm"
        >
          + Add category
        </button>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-gray-500">
          {error && <span className="text-red-600">{error}</span>}
          {!error && savedAt && <span className="text-green-700">Saved {savedAt.toLocaleTimeString()}.</span>}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded text-sm font-medium"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
