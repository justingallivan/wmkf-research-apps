import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';

const endpoint = '/api/workbench/proposal-lists';

/**
 * Advisor picks on a Scored request (owner decisions 2026-11-19): any staff
 * member ticks the Chairs and Board members who should see this proposal.
 * Creating that person's proposal list highlights it for them. Each tick saves
 * on its own. The section renders only when the server says the request is
 * Scored, and not at all where proposal lists are off (503). A read-only
 * Preview deployment shows the ticks disabled (the server refuses them too).
 * Mounted keyed by request ID, so a request change remounts it.
 */
export default function AdvisorPicks({ requestId }) {
  const [state, setState] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    requestJson(`${endpoint}?requestId=${encodeURIComponent(requestId)}`)
      .then(result => { if (mounted.current) setState(result); })
      .catch(failure => {
        if (!mounted.current) return;
        if (failure.status === 503) setHidden(true);
        else setError(failure.message);
      });
    return () => { mounted.current = false; };
  }, [requestId]);

  async function toggle(rosterId, picked) {
    if (saving !== null) return;
    setSaving(rosterId); setError('');
    try {
      const result = await requestJson(endpoint, {
        method: 'POST',
        body: { action: 'pick', requestId, rosterId, picked },
        fallbackMessage: 'Could not save that advisor.',
      });
      if (mounted.current) setState(result);
    } catch (failure) {
      if (mounted.current) setError(failure.message);
    } finally {
      if (mounted.current) setSaving(null);
    }
  }

  if (hidden || (state && !state.scored)) return null;
  return <section aria-label="Advisors who should see this" className="mt-4 border-t pt-4">
    <h3 className="text-lg font-semibold">Advisors who should see this</h3>
    <p className="text-sm text-gray-600">Ticked proposals are highlighted on that person’s proposal list.</p>
    {!state && !error && <p role="status" className="mt-2 text-sm">Loading advisors…</p>}
    {state && !state.advisors.length && <p className="mt-2 text-sm text-gray-600">No Board members are on the roster.</p>}
    {state && state.advisors.length > 0 && <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
      {state.advisors.map(advisor => (
        <label key={advisor.rosterId} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={advisor.picked} disabled={saving !== null || state.readOnly}
            onChange={event => toggle(advisor.rosterId, event.target.checked)} />
          {advisor.name}
        </label>
      ))}
    </div>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </section>;
}
