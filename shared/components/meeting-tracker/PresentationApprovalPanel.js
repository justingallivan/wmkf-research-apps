import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';
import { Button } from '../Layout';

/** Board publication is separate from preparation and from the link's lifetime. */
export default function PresentationApprovalPanel({ requestId, refreshToken = 0, onPolicyChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [videoReviewed, setVideoReviewed] = useState(false);
  const [summaryReviewed, setSummaryReviewed] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const mutationGeneration = useRef(0);
  const controllers = useRef(new Set());
  const endpoint = `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/presentation-approval`;
  const load = useCallback(async () => {
    if (!mounted.current) return;
    const sequence = ++generation.current;
    const controller = new AbortController(); controllers.current.add(controller);
    setLoading(true); setError(null);
    try {
      const result = await requestJson(endpoint, { signal: controller.signal, fallbackMessage: 'Board approval could not be checked.' });
      if (!mounted.current || generation.current !== sequence) return;
      setData(result); setVideoReviewed(false); setSummaryReviewed(false); setConfirmation(null); onPolicyChange?.(result.enrolled === true, result);
    } catch (readError) {
      if (!mounted.current || generation.current !== sequence || controller.signal.aborted) return;
      setData(null); setError(readError.message); onPolicyChange?.(null);
    } finally {
      controllers.current.delete(controller);
      if (mounted.current && generation.current === sequence) setLoading(false);
    }
  }, [endpoint, onPolicyChange]);
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => { if (mounted.current) { setBusy(false); setNotice(null); void load(); } });
    const active = controllers.current;
    return () => { mounted.current = false; generation.current += 1; mutationGeneration.current += 1; for (const controller of active) controller.abort(); };
  }, [load, refreshToken]);
  const mutate = async body => {
    if (busy || !data?.canApprove) return;
    const sequence = generation.current;
    const mutation = ++mutationGeneration.current;
    const controller = new AbortController(); controllers.current.add(controller);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson(endpoint, { method: 'POST', body, signal: controller.signal, fallbackMessage: 'The action could not be confirmed. Refresh to check its status.' });
      if (!mounted.current || generation.current !== sequence) return;
      setConfirmation(null); setVideoReviewed(false); setSummaryReviewed(false);
      setNotice(body.action === 'withdraw' ? 'Presentation materials withdrawn from the Board page.'
        : body.action === 'approve' ? 'Presentation materials approved for the Board.' : 'Board approval is set up. Review the presentation before approving it.');
      await load();
    } catch (actionError) {
      if (mounted.current && generation.current === sequence && !controller.signal.aborted) {
        setError(actionError.message); setData(null); onPolicyChange?.(null);
      }
    } finally {
      controllers.current.delete(controller);
      if (mounted.current && mutationGeneration.current === mutation) setBusy(false);
    }
  };
  const active = Boolean(data?.activeEditionId);
  return <div className="mt-4 border-t border-gray-200 pt-4" data-testid="presentation-approval">
    <h3 className="text-sm font-semibold text-gray-900">Presentation approval</h3>
    {loading && <p className="mt-2 text-sm text-gray-600" role="status">Checking Board approval…</p>}
    {!loading && data && <>
      <p className="mt-2 max-w-prose text-sm leading-6 text-gray-700">{!data.enrolled
        ? 'Set up one reviewed presentation version for the Board. Preparing corrections will keep that approved version available.'
        : active ? (data.activeEditionAvailable === false
          ? 'The approved presentation needs attention: one or more approved files no longer match. Prepare and approve a replacement, or withdraw it.'
          : data.activeEditionAvailable === null ? 'The approved version is retained, but its files could not be checked. Refresh before relying on Board availability.'
            : 'The approved presentation is available to the Board. It stays available while corrections are drafted.')
          : data.withdrawnAt ? 'The presentation has been withdrawn. Approve a reviewed version before making it available again.'
            : 'No presentation version has been approved. Applicant materials remain available under their existing sharing settings.'}</p>
      {!data.canApprove && <p className="mt-2 text-sm text-gray-600">The assigned Program Coordinator approves or withdraws presentation materials.</p>}
      {data.canApprove && !data.enrolled && !confirmation && <Button type="button" size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => setConfirmation('enroll')}>Set up presentation approval</Button>}
      {confirmation === 'enroll' && <div className="mt-3 space-y-3 text-sm leading-6 text-gray-800">
        <p>Presentation items currently on the Board page will be hidden until you approve a reviewed version. Applicant materials and the Board link stay available.</p>
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => void mutate({ action:'enroll', expectedVersion:0 })}>Set up approval</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button></div>
      </div>}
      {data.canApprove && data.enrolled && data.candidate?.ready && <div className="mt-3 space-y-3">
        <p className="text-sm text-gray-700">Review the presentation video and summary above before approving this version.</p>
        <label className="flex items-start gap-2 text-sm text-gray-800"><input type="checkbox" checked={videoReviewed} disabled={busy} onChange={e => setVideoReviewed(e.target.checked)} className="mt-1" />I checked the presentation video ending.</label>
        <label className="flex items-start gap-2 text-sm text-gray-800"><input type="checkbox" checked={summaryReviewed} disabled={busy} onChange={e => setSummaryReviewed(e.target.checked)} className="mt-1" />I reviewed the presentation summary.</label>
        {!confirmation && <Button type="button" size="sm" disabled={busy || !videoReviewed || !summaryReviewed} onClick={() => setConfirmation('approve')}>{active ? 'Approve replacement for Board' : 'Approve for Board'}</Button>}
      </div>}
      {data.enrolled && !data.candidate?.ready && <p className="mt-2 text-sm text-gray-600">{data.candidate?.message || 'The presentation is not ready for review.'}</p>}
      {confirmation === 'approve' && <div className="mt-3 space-y-3 text-sm leading-6 text-gray-800"><p>{active ? 'Replace the Board’s approved presentation with this reviewed version?' : 'Make this reviewed presentation video, summary and transcript available through the Board link?'}</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy || !videoReviewed || !summaryReviewed} onClick={() => void mutate({ action:'approve', expectedVersion:data.version, commandId:crypto.randomUUID(), candidateFingerprint:data.candidate.fingerprint, videoReviewed:true, summaryReviewed:true })}>Confirm approval</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button></div></div>}
      {data.canApprove && active && !confirmation && <Button type="button" size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => setConfirmation('withdraw')}>Withdraw from Board</Button>}
      {confirmation === 'withdraw' && <div className="mt-3 space-y-3 text-sm leading-6 text-gray-800"><p>Remove the presentation from new Board-page access now? Files already downloaded or a video already opened cannot be recalled. Your drafts and applicant materials will be kept.</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void mutate({ action:'withdraw', expectedVersion:data.version, expectedEditionId:data.activeEditionId })}>Withdraw presentation</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Keep available</Button></div></div>}
    </>}
    {busy && <p className="mt-2 text-sm text-gray-600" role="status">Saving Board approval…</p>}
    {notice && <p className="mt-2 text-sm text-gray-700" role="status">{notice}</p>}
    {error && <div className="mt-2"><p className="text-sm text-red-700" role="alert">{error}</p><Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy || loading} onClick={() => void load()}>Refresh approval status</Button></div>}
  </div>;
}
