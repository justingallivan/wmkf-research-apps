import { useEffect, useState } from 'react';

/**
 * Admin editor for the Meeting Tracker's fixed default attendee list (D10).
 * Staff only; Board members are chosen per session in the tracker itself.
 */
export default function MeetingTrackerDefaultsSection() {
  const [staff, setStaff] = useState([]);
  const [selected, setSelected] = useState([]);
  const [baseline, setBaseline] = useState('[]');
  const [notice, setNotice] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // No synchronous setState before the first await: the effect only reacts to
  // the response, and an unmounted section ignores it.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/meeting-tracker-defaults');
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) throw new Error(data?.error || 'Failed to load Meeting Tracker defaults.');
        const ids = (data.defaultAttendeeRefs || []).map((ref) => Number(ref.profileId)).filter(Number.isFinite);
        setStaff(Array.isArray(data.staff) ? data.staff : []);
        setSelected(ids);
        setBaseline(JSON.stringify(ids));
        setNotice(typeof data.notice === 'string' ? data.notice : null);
        setError(null);
      } catch (err) {
        if (active) setError(err.message || 'Failed to load Meeting Tracker defaults.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const toggle = (profileId) => {
    setStatus(null);
    setSelected((prev) => (prev.includes(profileId) ? prev.filter((id) => id !== profileId) : [...prev, profileId]));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/meeting-tracker-defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees: selected.map((profileId) => ({ kind: 'staff', profileId })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save the default attendee list.');
      const ids = (data.defaultAttendeeRefs || []).map((ref) => ref.profileId);
      setSelected(ids);
      setBaseline(JSON.stringify(ids));
      setNotice(null);
      setStatus('Saved. New sessions start with this list.');
    } catch (err) {
      setError(err.message || 'Failed to save the default attendee list.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  const dirty = JSON.stringify(selected) !== baseline;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Every new deliberation session starts with these staff attendees. Board members are added per session in the Meeting Tracker.
      </p>
      {notice && <p className="text-sm text-amber-800">{notice}</p>}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {staff.length === 0 ? (
        <p className="text-sm text-gray-500">No active staff profiles are available.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {staff.map((person) => {
            const on = selected.includes(person.ref.profileId);
            return (
              <button
                key={person.ref.profileId}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(person.ref.profileId)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                {person.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save default attendees'}
        </button>
        {status && <span className="text-sm text-green-700" role="status">{status}</span>}
      </div>
    </div>
  );
}
