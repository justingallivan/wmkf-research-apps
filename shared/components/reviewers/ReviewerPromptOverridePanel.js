/**
 * Per-user prompt override editor (S222). Lets a reviewers-grant user tweak their
 * OWN copy of either reviewer-finder prompt, layered over the shared Dataverse
 * template. A bad edit only affects this user's runs; the resolver also ignores
 * an invalid override at runtime. "Reset to template" removes the override.
 */
import { useEffect, useState } from 'react';
import { validatePromptForSave } from '../../../lib/utils/prompt-validators';
import {
  REVIEWER_PROMPT_OPTIONS,
  loadPromptOverride,
  savePromptOverride,
  deletePromptOverride,
} from './prompt-override-store';

export default function ReviewerPromptOverridePanel({ onClose }) {
  const [name, setName] = useState(REVIEWER_PROMPT_OPTIONS[0].name);
  const [data, setData] = useState(null); // { version, templateBody, userOverride, staleOverride }
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = (promptName) => {
    setLoading(true); setError(null); setNotice(null);
    loadPromptOverride(promptName)
      .then((d) => {
        setData(d);
        setBody(d.userOverride?.body ?? d.templateBody ?? '');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(name); }, [name]);

  const validation = validatePromptForSave(name, body);
  const usingOverride = !!data?.userOverride;
  const dirty = data && body !== (data.userOverride?.body ?? data.templateBody ?? '');

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await savePromptOverride(name, body);
      setNotice('Saved — your edits will be used for your reviewer searches.');
      load(name);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await deletePromptOverride(name);
      setNotice('Reset — you are back on the shared template.');
      load(name);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="border rounded-lg bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Edit my prompts</h3>
        {onClose && <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-800">Close</button>}
      </div>
      <p className="text-xs text-gray-500">
        Your personal edits layer over the shared template and only affect your own searches. Leave it on the template if unsure.
      </p>

      <div className="flex items-center gap-2">
        <select
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1.5 flex-1"
        >
          {REVIEWER_PROMPT_OPTIONS.map((o) => (<option key={o.name} value={o.name}>{o.label}</option>))}
        </select>
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {usingOverride ? 'using YOUR edit' : 'using template'}{data?.version != null ? ` · base v${data.version}` : ''}
        </span>
      </div>

      {data?.staleOverride && (
        <div className="text-xs px-3 py-2 rounded border bg-amber-50 text-amber-800 border-amber-200">
          Your edit is based on an older template version (v{data.staleOverride.baseVersion} → current v{data.staleOverride.currentVersion}).
          Reset to adopt the latest, or keep your edit.
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : (
        <>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs font-mono"
          />
          <div className="text-[10px] text-gray-400">{body.length} chars</div>

          {!validation.valid && (
            <div className="text-xs px-3 py-2 rounded border bg-red-50 text-red-800 border-red-200">
              <div className="font-medium">Fix before saving:</div>
              <ul className="mt-1 list-disc ml-5">{validation.issues.map((iss, i) => (<li key={i}>{iss}</li>))}</ul>
            </div>
          )}
          {error && <div className="text-xs text-red-600">{error}</div>}
          {notice && <div className="text-xs text-green-700">{notice}</div>}

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={reset}
              disabled={busy || !usingOverride}
              className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40"
              title="Remove your personal edit and use the shared template"
            >
              Reset to template
            </button>
            <button
              onClick={save}
              disabled={busy || !validation.valid || !dirty}
              className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Saving…' : 'Save my edit'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
