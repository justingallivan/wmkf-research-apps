import { useEffect, useState } from 'react';

/**
 * Admin editor for the applicant materials upload cap (plan §16 M3).
 * A whole number of megabytes; the default applies until a value is saved.
 */
export default function SiteVisitMaterialsDefaultsSection() {
  const [maxMb, setMaxMb] = useState('');
  const [baseline, setBaseline] = useState('');
  const [limits, setLimits] = useState({ min: 1, max: 500 });
  const [defaultMb, setDefaultMb] = useState(100);
  const [source, setSource] = useState('default');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/site-visit-materials-defaults');
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) throw new Error(data?.error || 'Failed to load the upload cap.');
        setMaxMb(String(data.maxMb));
        setBaseline(String(data.maxMb));
        setLimits(data.limits || { min: 1, max: 500 });
        setDefaultMb(data.defaultMb ?? 100);
        setSource(data.source || 'default');
        setError(null);
      } catch (err) {
        if (active) setError(err.message || 'Failed to load the upload cap.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch('/api/admin/site-visit-materials-defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxMb: Number(maxMb) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save the upload cap.');
      setMaxMb(String(data.maxMb));
      setBaseline(String(data.maxMb));
      setSource(data.source || 'setting');
      setStatus('Saved. New uploads use this cap.');
    } catch (err) {
      setError(err.message || 'Failed to save the upload cap.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  const dirty = maxMb !== baseline;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Largest file an applicant can upload for a site visit. The briefing page opens files up to 50 MB and lists larger ones with a note.
        {source === 'default' ? ` Using the default of ${defaultMb} MB.` : ''}
      </p>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <label className="block text-sm font-medium text-gray-700">
        Upload cap (MB)
        <input
          type="number"
          min={limits.min}
          max={limits.max}
          step="1"
          value={maxMb}
          onChange={(event) => { setStatus(null); setMaxMb(event.target.value); }}
          className="mt-1 w-40 rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save upload cap'}
        </button>
        {status && <span className="text-sm text-green-700" role="status">{status}</span>}
      </div>
    </div>
  );
}
