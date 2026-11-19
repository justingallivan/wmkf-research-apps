import { useEffect, useState } from 'react';
import { requestJson } from '../../utils/api-request';

/**
 * Admin editor for the test-Request email allowlist (production plan, owner
 * decision S546). One address per line. Foundation addresses are always
 * allowed and need no entry.
 */
function toLines(addresses) {
  return (addresses || []).join('\n');
}

/**
 * `onAttention(text)` reports a load-time problem ('' when none) so a collapsed
 * panel can show it in its summary (owner, 2026-11-15: the panel starts closed).
 */
export default function TestRequestEmailAllowlistSection({ onAttention } = {}) {
  const [text, setText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [domain, setDomain] = useState('wmkeck.org');
  const [max, setMax] = useState(200);
  const [unavailable, setUnavailable] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await requestJson('/api/admin/test-requests/email-allowlist', {
          tolerantBody: true,
          fallbackMessage: 'Failed to load the test-request email allowlist.',
        });
        if (!active) return;
        setText(toLines(data.addresses));
        setBaseline(toLines(data.addresses));
        setDomain(data.foundationDomain || 'wmkeck.org');
        setMax(data.maxAddresses || 200);
        setUnavailable(Boolean(data.unavailable));
      } catch (err) {
        if (active) {
          setError(err.message || 'Failed to load the test-request email allowlist.');
          setLoadFailed(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!onAttention) return;
    if (unavailable) onAttention(`The saved list can't be read, so only @${domain} addresses are allowed right now. Open this panel to fix it.`);
    else if (saveFailed) onAttention("The last change to the allowlist wasn't saved. Open this panel to see why.");
    else if (loadFailed) onAttention("The allowlist couldn't be loaded. Open this panel to see why.");
    else onAttention('');
  }, [onAttention, unavailable, loadFailed, saveFailed, domain]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setDetails([]);
    setStatus(null);
    try {
      const addresses = text.split(/[\n,;]+/).map((line) => line.trim()).filter(Boolean);
      const data = await requestJson('/api/admin/test-requests/email-allowlist', {
        method: 'PUT',
        body: { addresses },
        tolerantBody: true,
        fallbackMessage: 'Failed to save the test-request email allowlist.',
      });
      setText(toLines(data.addresses));
      setBaseline(toLines(data.addresses));
      setUnavailable(false);
      // A successful save establishes the saved list, so earlier load or save failures no longer apply.
      setLoadFailed(false);
      setSaveFailed(false);
      setStatus(`Saved ${data.addresses.length} address${data.addresses.length === 1 ? '' : 'es'}.`);
    } catch (err) {
      setError(err.message || 'Failed to save the test-request email allowlist.');
      setDetails(Array.isArray(err.payload?.details) ? err.payload.details : []);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  const dirty = text !== baseline;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Email about a test request goes out only when every recipient is allowed. Any @{domain} address is always allowed.
        Add other addresses here, one per line, such as test reviewer inboxes. A plus-tag on a listed address
        (name+tag@example.org) is allowed too.
      </p>
      {unavailable && (
        <p className="text-sm text-amber-700" role="alert">
          The saved list could not be read, so only @{domain} addresses are allowed right now. Saving replaces the list.
        </p>
      )}
      {error && (
        <div className="text-sm text-red-700" role="alert">
          <p>{error}</p>
          {details.length > 0 && <ul className="mt-1 list-disc pl-5">{details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}
      <label className="block text-sm font-medium text-gray-700">
        Allowed addresses (up to {max})
        <textarea
          rows={6}
          value={text}
          onChange={(event) => { setStatus(null); setText(event.target.value); }}
          className="mt-1 w-full max-w-xl rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
          placeholder="reviewer.test@example.org"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save allowlist'}
        </button>
        {status && <span className="text-sm text-green-700" role="status">{status}</span>}
      </div>
    </div>
  );
}
