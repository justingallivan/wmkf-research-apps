import { useEffect, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

export default function ReviewerTimeBudgetSection() {
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
