import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';
import {
  normalizeDueBusinessDays,
  SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT,
  SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS,
} from '../../config/siteVisitMaterials';

/**
 * Admin editor for applicant materials defaults. Each control saves independently.
 */
export default function SiteVisitMaterialsDefaultsSection() {
  const mounted = useRef(true);
  const [dueDays, setDueDays] = useState('');
  const [dueBaseline, setDueBaseline] = useState('');
  const [dueSaving, setDueSaving] = useState(false);
  const [dueError, setDueError] = useState(null);
  const [dueStatus, setDueStatus] = useState(null);
  const [maxMb, setMaxMb] = useState('');
  const [baseline, setBaseline] = useState('');
  const [limits, setLimits] = useState(SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS);
  const [defaultMb, setDefaultMb] = useState(SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT);
  const [source, setSource] = useState('default');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    (async () => {
      try {
        const data = await requestJson('/api/admin/site-visit-materials-defaults', {
          tolerantBody: true,
          fallbackMessage: 'Failed to load the upload cap.',
        });
        if (!active) return;
        setDueDays(data.dueBusinessDays == null ? '' : String(data.dueBusinessDays));
        setDueBaseline(data.dueBusinessDays == null ? '' : String(data.dueBusinessDays));
        setMaxMb(String(data.maxMb));
        setBaseline(String(data.maxMb));
        setLimits(data.limits || SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS);
        setDefaultMb(data.defaultMb ?? SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT);
        setSource(data.source || 'default');
        setError(null);
      } catch (err) {
        if (active) setError(err.message || 'Failed to load the upload cap.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; mounted.current = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const data = await requestJson('/api/admin/site-visit-materials-defaults', {
        method: 'PUT',
        body: { maxMb: Number(maxMb) },
        tolerantBody: true,
        fallbackMessage: 'Failed to save the upload cap.',
      });
      if (!mounted.current) return;
      setMaxMb(String(data.maxMb));
      setBaseline(String(data.maxMb));
      setSource(data.source || 'setting');
      setStatus('Saved. New uploads use this cap.');
    } catch (err) {
      if (mounted.current) setError(err.message || 'Failed to save the upload cap.');
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const saveDueDays = async () => {
    const value = normalizeDueBusinessDays(dueDays);
    if (value === null || dueSaving) return;
    setDueSaving(true); setDueError(null); setDueStatus(null);
    try {
      const data = await requestJson('/api/admin/site-visit-materials-defaults', {
        method: 'PUT', body: { dueBusinessDays: value }, tolerantBody: true,
        fallbackMessage: 'The due-date offset could not be saved. Please try again.',
      });
      if (!mounted.current) return;
      if (data.success !== true || normalizeDueBusinessDays(data.dueBusinessDays) === null) {
        throw new Error('The save could not be confirmed. Reload and check the setting before trying again.');
      }
      setDueDays(String(data.dueBusinessDays));
      setDueBaseline(String(data.dueBusinessDays));
      setDueStatus('Saved. New materials requests use this offset. Existing deadlines are unchanged.');
    } catch (err) {
      if (mounted.current) setDueError(err.message);
    } finally {
      if (mounted.current) setDueSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  const dirty = maxMb !== baseline;
  return (
    <div className="space-y-3">
      <div className="space-y-3 border-b border-gray-200 pb-6 mb-6">
        <label className="block text-sm font-medium text-gray-700" htmlFor="materials-due-days">
          Materials due (business days before the site visit)
        </label>
        <input id="materials-due-days" type="number" min="1" max="30" step="1"
          value={dueDays} disabled={dueSaving} aria-describedby="materials-due-days-help"
          onChange={(event) => { setDueDays(event.target.value); setDueError(null); setDueStatus(null); }}
          className="w-40 rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600" />
        <p id="materials-due-days-help" className="text-sm text-gray-600">
          Enter 1–30 business days. The default is 2. Weekends are skipped; holidays are not.
          Changes apply to new materials requests only. Existing deadlines stay the same.
        </p>
        {dueError && <p role="alert" className="text-sm text-red-700">{dueError}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={saveDueDays}
            disabled={dueSaving || dueDays === dueBaseline || normalizeDueBusinessDays(dueDays) === null}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">
            {dueSaving ? 'Saving due-date offset…' : 'Save due-date offset'}
          </button>
          {dueStatus && <span role="status" className="text-sm text-green-700">{dueStatus}</span>}
        </div>
      </div>
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
