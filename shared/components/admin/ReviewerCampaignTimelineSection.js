import { useEffect, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

export default function ReviewerCampaignTimelineSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [timeline, setTimeline] = useState({
    cycleLabel: '',
    respondOffsetDays: 7,
    desiredCount: 4,
  });
  const [isDefault, setIsDefault] = useState(false);
  const [malformed, setMalformed] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/campaign-timeline-defaults');
      if (envelope.error?.parseError) throw envelope.error.parseError;
      if (!envelope.ok) throw new Error(envelope.data?.error || 'Failed to load');
      const data = envelope.data;
      setTimeline({
        cycleLabel: data.timeline?.cycleLabel || '',
        respondOffsetDays: data.timeline?.respondOffsetDays == null ? '' : data.timeline.respondOffsetDays,
        desiredCount: data.timeline?.desiredCount == null ? '' : data.timeline.desiredCount,
      });
      setIsDefault(!!data.isDefault);
      setMalformed(!!data.malformed);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const update = (field, value) => {
    setTimeline((prev) => ({ ...prev, [field]: value }));
  };

  const normalizeOffsetInput = (value) => {
    if (value === '') return '';
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : '';
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const respondOffsetDays = timeline.respondOffsetDays === ''
        ? null
        : Number(timeline.respondOffsetDays);
      const desiredCount = timeline.desiredCount === ''
        ? null
        : Number(timeline.desiredCount);
      const envelope = await requestEnvelope('/api/review-manager/campaign-timeline-defaults', {
        method: 'PUT',
        body: {
          timeline: {
            ...timeline,
            respondOffsetDays,
            desiredCount,
          },
        },
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
        Current-cycle defaults for reviewer invitation copy. The invitation modal
        uses these values first, then overlays request-specific campaign settings
        when a proposal already has them.
      </p>
      {isDefault && (
        <p className="text-xs text-amber-700">
          No cycle defaults are set yet — the invitation modal will fall back to its built-in timing defaults.
        </p>
      )}
      {malformed && (
        <p className="text-xs text-red-700">
          The stored timeline JSON is malformed; save a clean set of dates.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs text-gray-600">
          Grant cycle label
          <input
            type="text"
            value={timeline.cycleLabel}
            onChange={(e) => update('cycleLabel', e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            placeholder="D26"
          />
        </label>
        <label className="text-xs text-gray-600">
          Days to respond to invitation
          <input
            type="number"
            min="0"
            step="1"
            value={timeline.respondOffsetDays}
            onChange={(e) => update('respondOffsetDays', normalizeOffsetInput(e.target.value))}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="text-xs text-gray-600">
          Reviewer quota
          <input
            type="number"
            min="0"
            step="1"
            value={timeline.desiredCount}
            onChange={(e) => update('desiredCount', normalizeOffsetInput(e.target.value))}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
          <span className="mt-1 block text-xs text-gray-400">
            Default number of committed reviewers before the PD is notified. Seeds new campaigns&apos; settings.
          </span>
        </label>
      </div>
      <div className="flex items-center gap-2">
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
