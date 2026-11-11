/** Request-scoped, read-only delivery of retained AI drafts. */
import { useEffect, useRef, useState } from 'react';
import { Button, Card } from '../Layout';
import { requestEnvelope } from '../../utils/api-request';

const JOB_STATES = new Set(['queued','running','complete','needs_attention','expired']);
const LABELS = Object.freeze({'proposal.executive-summary':'Executive summary','proposal.methodology':'Methodology'});
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = new Set(['queued','running']);
const TASK_LABELS = {queued:'Waiting',dispatching:'Generating',response_saved:'Validating',validated:'Draft ready',failed_pre_dispatch:'Could not start',failed_validation:'Draft could not be validated',unknown:'Needs attention',expired:'Expired'};
const POLL_MS = 5000;
const same = (left,right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
function validJob(job, requestId) {
  return Boolean(job && typeof job === 'object' && GUID.test(job.id || '') && same(job.requestId,requestId)
    && Number.isSafeInteger(job.version) && job.version >= 0 && JOB_STATES.has(job.status)
    && typeof job.createdAt === 'string' && Number.isFinite(Date.parse(job.createdAt))
    && Array.isArray(job.tasks) && job.tasks.length > 0 && job.tasks.length <= 2
    && new Set(job.tasks.map(item => item?.taskKey)).size === job.tasks.length
    && job.tasks.every(item => Object.hasOwn(LABELS,item?.taskKey) && typeof item.state === 'string' && typeof item.resultAvailable === 'boolean'));
}
function latestJob(jobs, requestId) {
  if (!Array.isArray(jobs) || !jobs.every(job => validJob(job,requestId))) throw new Error('invalid status');
  return [...jobs].sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt))[0] || null;
}
function storageKey(profileId,requestId) { return `wmkf:proposal-drafts:v1:${profileId}:${requestId.toLowerCase()}`; }
function readPending(key) {
  try { const value = window.sessionStorage.getItem(key); return {available:true,value:value && GUID.test(value) ? value : null,invalid:Boolean(value && !GUID.test(value))}; }
  catch { return {available:false,value:null,invalid:false}; }
}

/** profileId is a client-side storage namespace, never sent as authorization. */
export default function ProposalDrafts({requestId, profileId, previewReadOnly = false}) {
  if (previewReadOnly || !GUID.test(requestId || '') || !/^[1-9]\d*$/.test(String(profileId || ''))) return null;
  return <DraftPanel key={`${profileId}:${requestId.toLowerCase()}`} requestId={requestId} profileId={profileId} />;
}

function DraftPanel({requestId,profileId}) {
  const key = storageKey(profileId,requestId);
  const [storage,setStorage] = useState(() => readPending(key));
  const [enabled,setEnabled] = useState(null);
  const [job,setJob] = useState(null);
  const [result,setResult] = useState(null);
  const [resultError,setResultError] = useState('');
  const [resultRetry,setResultRetry] = useState(0);
  const [error,setError] = useState('');
  const [submitting,setSubmitting] = useState(false);
  const [visible,setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const mounted = useRef(false), generation = useRef(0), jobRef = useRef(null), controllers = useRef(new Set());
  const pendingRef = useRef(storage.value);
  const selectedJobId = job?.id || null, selectedJobStatus = job?.status || null, selectedJobVersion = job?.version ?? null;
  const hasResults = Boolean(job?.tasks.some(task => task.resultAvailable));
  const url = `/api/workbench/prompt-jobs?requestId=${encodeURIComponent(requestId)}`;

  useEffect(() => {
    mounted.current = true; generation.current++; const running = controllers.current;
    return () => { mounted.current = false; running.forEach(controller => controller.abort()); running.clear(); };
  }, []);
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange',changed); return () => document.removeEventListener('visibilitychange',changed);
  }, []);
  function current(epoch) { return mounted.current && generation.current === epoch; }
  function accept(next) {
    const previous = jobRef.current;
    if (previous && same(previous.id,next.id) && next.version < previous.version) return;
    jobRef.current = next; setJob(next);
  }
  function denied() { jobRef.current = null; setJob(null); setResult(null); setResultError(''); setEnabled(false); setError(''); }
  useEffect(() => {
    const epoch = generation.current, controller = new AbortController(), running = controllers.current; running.add(controller);
    (async () => {
      try {
        const response = await requestEnvelope(url,{signal:controller.signal});
        if (!current(epoch)) return;
        if ([401,403].includes(response.status)) { denied(); return; }
        if (!response.ok || typeof response.data?.enabled !== 'boolean') throw new Error('unavailable');
        if (!response.data.enabled) { denied(); return; }
        const found = latestJob(response.data.jobs,requestId);
        setEnabled(true); setError(''); if (found) accept(found);
      } catch (errorValue) { if (current(epoch) && errorValue?.name !== 'AbortError') { setEnabled(false); setError(''); } }
      finally { running.delete(controller); }
    })();
    return () => { controller.abort(); running.delete(controller); };
  }, [requestId, url]);
  useEffect(() => {
    if (!enabled || !visible || !selectedJobId || !ACTIVE.has(selectedJobStatus)) return undefined;
    const epoch = generation.current, jobId = selectedJobId, running = controllers.current; let stopped = false, timer, controller;
    const tick = async () => {
      if (stopped || !current(epoch)) return;
      controller = new AbortController(); running.add(controller);
      try {
        const response = await requestEnvelope(`/api/workbench/prompt-jobs/${encodeURIComponent(jobId)}?requestId=${encodeURIComponent(requestId)}`,{signal:controller.signal});
        if (stopped || !current(epoch) || !same(jobRef.current?.id,jobId)) return;
        if ([401,403].includes(response.status)) { denied(); return; }
        if (!response.ok || !validJob(response.data?.job,requestId) || !same(response.data.job.id,jobId)) throw new Error('invalid status');
        accept(response.data.job); setError('');
      } catch (errorValue) { if (!stopped && current(epoch) && same(jobRef.current?.id,jobId) && errorValue?.name !== 'AbortError') setError('Could not refresh draft status. We will check again.'); }
      finally { running.delete(controller); if (!stopped && current(epoch) && same(jobRef.current?.id,jobId) && ACTIVE.has(jobRef.current?.status)) timer = setTimeout(tick,POLL_MS); }
    };
    timer = setTimeout(tick,POLL_MS);
    return () => { stopped = true; clearTimeout(timer); if (controller) {controller.abort(); running.delete(controller);} };
  }, [enabled,visible,selectedJobId,selectedJobStatus,requestId]);
  useEffect(() => {
    if (!enabled || !visible || !selectedJobId || !hasResults) return undefined;
    const epoch = generation.current, jobId = selectedJobId, version = selectedJobVersion, controller = new AbortController(), running = controllers.current; running.add(controller); let active = true;
    (async () => {
      try {
        const response = await requestEnvelope(`/api/workbench/prompt-jobs/${encodeURIComponent(jobId)}/results?requestId=${encodeURIComponent(requestId)}`,{signal:controller.signal});
        if (!active || !current(epoch) || !same(jobRef.current?.id,jobId) || jobRef.current.version !== version) return;
        if ([401,403].includes(response.status)) { denied(); return; }
        const data = response.data;
        if (response.ok && same(data?.jobId,jobId) && Number.isSafeInteger(data.version) && data.version > version) {
          const refreshed = await requestEnvelope(`/api/workbench/prompt-jobs/${encodeURIComponent(jobId)}?requestId=${encodeURIComponent(requestId)}`,{signal:controller.signal});
          if (!active || !current(epoch) || !same(jobRef.current?.id,jobId) || jobRef.current.version !== version) return;
          if ([401,403].includes(refreshed.status)) { denied(); return; }
          if (!refreshed.ok || !validJob(refreshed.data?.job,requestId) || !same(refreshed.data.job.id,jobId) || refreshed.data.job.version < data.version) throw new Error('invalid refreshed status');
          accept(refreshed.data.job); return;
        }
        if (!response.ok || !same(data?.jobId,jobId) || data.version !== version || !Array.isArray(data.results) || data.results.length > 2 || new Set(data.results.map(item => item?.taskKey)).size !== data.results.length || jobRef.current.tasks.some(task => task.resultAvailable && !data.results.some(item => item.taskKey === task.taskKey)) || !data.results.every(item => Object.hasOwn(LABELS,item?.taskKey) && ['available','expired'].includes(item.status) && (item.status !== 'available' || (typeof item.text === 'string' && item.text.length <= 20000)))) throw new Error('invalid result');
        setResult({jobId,version,items:data.results}); setResultError('');
      } catch (errorValue) { if (active && current(epoch) && same(jobRef.current?.id,jobId) && jobRef.current.version === version && errorValue?.name !== 'AbortError') { setResult(null); setResultError('Could not load the saved drafts.'); } }
      finally { running.delete(controller); }
    })();
    return () => { active = false; controller.abort(); running.delete(controller); };
  }, [enabled,visible,selectedJobId,selectedJobVersion,hasResults,requestId,resultRetry]);
  async function submit() {
    if (!enabled || submitting || !storage.available || storage.invalid) return;
    let requestKey = pendingRef.current;
    if (!requestKey) {
      if (typeof globalThis.crypto?.randomUUID !== 'function') { setError('This browser cannot safely start a draft request.'); return; }
      requestKey = globalThis.crypto.randomUUID();
      try { window.sessionStorage.setItem(key,requestKey); if (window.sessionStorage.getItem(key) !== requestKey) throw new Error('storage'); }
      catch { setStorage({available:false,value:null,invalid:false}); setError('This browser cannot retain the request safely. Enable session storage and try again.'); return; }
      pendingRef.current = requestKey; setStorage({available:true,value:requestKey,invalid:false});
    }
    const epoch = generation.current, controller = new AbortController(); controllers.current.add(controller);
    setSubmitting(true); setError('');
    try {
      const response = await requestEnvelope('/api/workbench/prompt-jobs',{method:'POST',headers:{'Idempotency-Key':requestKey},body:{requestId},signal:controller.signal});
      if (!current(epoch)) return;
      if ([401,403].includes(response.status)) { denied(); return; }
      if (!response.ok || !validJob(response.data?.job,requestId)) throw new Error('submission uncertain');
      try { window.sessionStorage.removeItem(key); if (window.sessionStorage.getItem(key) !== null) throw new Error('storage'); }
      catch { setStorage({available:false,value:requestKey,invalid:false}); setError('The request was accepted, but this browser could not clear its recovery key. Contact an administrator before starting another.'); accept(response.data.job); return; }
      pendingRef.current = null; setStorage({available:true,value:null,invalid:false}); setResultError(''); accept(response.data.job);
    } catch (errorValue) { if (current(epoch) && errorValue?.name !== 'AbortError') setError('The request may have been accepted. Retry this same request to check its status.'); }
    finally { controllers.current.delete(controller); if (current(epoch)) setSubmitting(false); }
  }
  if (enabled !== true) return null;
  const currentResult = result && job && same(result.jobId,job.id) && result.version === job.version ? result.items : [];
  const canStart = !job;
  return <Card hover={false}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-base font-semibold text-gray-900">AI drafts</h2><p className="mt-1 text-sm text-gray-600">Generate an executive summary and methodology draft for staff review. Drafts are retained separately and do not change the Request. This trial allows one run.</p></div>
      <Button type="button" size="sm" onClick={submit} loading={submitting} disabled={submitting || !storage.available || storage.invalid || (!storage.value && !canStart)}>{storage.value ? 'Retry draft request' : job ? 'Trial already started' : 'Generate drafts'}</Button>
    </div>
    {(!storage.available || storage.invalid) && <p role="alert" className="mt-3 text-sm text-amber-800">This browser cannot safely retain the request. Contact an administrator before starting drafts.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-amber-800">{error}</p>}
    {resultError && <p role="alert" className="mt-3 text-sm text-amber-800">{resultError} <Button type="button" variant="link" onClick={() => { setResultError(''); setResultRetry(value => value+1); }}>Reload saved drafts</Button></p>}
    {storage.value && <p className="mt-3 text-sm text-amber-800">A previous submission may have been accepted. Retry the same request to recover its status.</p>}
    {job ? <div className="mt-4 space-y-3 border-t border-gray-200 pt-4"><p className="text-sm text-gray-600">{job.status === 'complete' ? 'Draft processing complete.' : job.status === 'needs_attention' ? 'Some work needs attention. Contact an administrator.' : job.status === 'expired' ? 'These drafts have expired.' : 'Draft generation is in progress.'}</p>
      {job.tasks.map(task => { const item = currentResult.find(value => value.taskKey === task.taskKey); return <section key={task.taskKey} className="space-y-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-gray-900">{LABELS[task.taskKey]}</h3><span className="text-xs text-gray-600">{task.state === 'validated' && !task.resultAvailable ? (job.status === 'expired' ? 'Draft expired' : 'Draft unavailable') : (TASK_LABELS[task.state] || 'Status unavailable')}</span></div>{item?.status === 'available' && <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{item.text}</p>}{item?.status === 'expired' && <p className="text-sm text-gray-600">This retained draft has expired.</p>}{task.resultAvailable && !item && <p className="text-sm text-gray-600">Loading saved draft…</p>}</section>; })}
    </div> : !storage.value && <p className="mt-4 text-sm text-gray-600">No drafts have been generated for this Request yet.</p>}
  </Card>;
}
