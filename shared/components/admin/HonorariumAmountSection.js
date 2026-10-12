import { useEffect, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

export default function HonorariumAmountSection() {
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
