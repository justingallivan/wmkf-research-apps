/**
 * Reviewer rollup for one request (counts only): { status, data: { counts, needed, hint } }.
 * Used by the Overview tab, and by the request page for 2027-or-later requests so the
 * J27 stage strip has reviewer counts whichever tab the request opens on.
 * A falsy requestId fetches nothing and reads as loading.
 */
import { useState, useEffect, useRef } from 'react';
import { requestEnvelope } from '../../utils/api-request';

export default function useReviewerProgress(requestId) {
  const requestKey = String(requestId || '').toLowerCase();
  const [state, setState] = useState({ status: 'loading', data: null, requestKey: '' });
  const reqRef = useRef(0);

  useEffect(() => {
    if (!requestId) return undefined;
    const token = (reqRef.current += 1);
    let cancelled = false;
    setState({ status: 'loading', data: null, requestKey });
    // Lightweight per-request rollup (counts only, no person/researcher fan-out —
    // Codex S260). Returns { counts, needed, workRemaining, hint }.
    requestEnvelope(`/api/workbench/reviewer-rollup?requestId=${encodeURIComponent(requestId)}`, { tolerantBody: true })
      .then(({ ok: resOk, status: resStatus, data: body }) => {
        if (cancelled || token !== reqRef.current) return;
        if (!resOk || !body.success) throw new Error(body.error || `Failed (${resStatus})`);
        const counts = body.counts && typeof body.counts === 'object' ? body.counts : {};
        setState({ status: 'ready', data: { counts, needed: body.needed, hint: body.hint }, requestKey });
      })
      .catch(() => {
        if (!cancelled && token === reqRef.current) setState({ status: 'error', data: null, requestKey });
      });
    return () => { cancelled = true; };
  }, [requestId, requestKey]);

  return state.requestKey === requestKey ? state : { status: 'loading', data: null };
}
