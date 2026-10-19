import { useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
const PROGRAM = 'c247b11a-a7cb-ee11-9078-000d3a341e8f';
const button = 'rounded border px-4 py-2 text-sm disabled:opacity-50';
async function api(url, body, signal) {
  const result = await requestEnvelope(url, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal });
  if (!result.ok) throw new Error(result.data?.error || 'The operation could not be completed.');
  return result.data;
}
export default function BoardWriteups({ initialCycle = 'D26' }) {
  const [cycle, setCycle] = useState(initialCycle), [caps, setCaps] = useState(null), [data, setData] = useState(null);
  const [settings, setSettings] = useState(null), [form, setForm] = useState(null), [report, setReport] = useState(null);
  const [candidateSearch, setCandidateSearch] = useState(''), [rowFilter, setRowFilter] = useState('all');
  const [recovery, setRecovery] = useState(null);
  const [selected, setSelected] = useState([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success'), [messageScope, setMessageScope] = useState('page');
  const feedbackRef = useRef(null);
  useEffect(() => {
    if (message && messageScope === 'setup') {
      feedbackRef.current?.focus({ preventScroll: true });
      feedbackRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [message, messageScope]);
  const generation = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  useEffect(() => {
    const controller = new AbortController(), seq = ++generation.current;
    api('/api/workbench/board-writeups', null, controller.signal).then(async permissions => {
      if (seq !== generation.current) return;
      setCaps(permissions);
      if (!permissions.canRelease && !permissions.canArchive) throw new Error('This page is for the CSO, Grants Manager and administrators.');
      const state = await api(`/api/workbench/board-writeups?cycle=${cycle}`, null, controller.signal).catch(e => { if (!permissions.isSuperuser) throw e; return null; });
      if (seq !== generation.current) return;
      setData(state);
      if (permissions.isSuperuser) {
        const setup = await api(`/api/admin/board-writeup-cycles?cycle=${cycle}`, null, controller.signal);
        if (seq !== generation.current) return;
        setSettings(setup); setForm(setup.cycle.value || { version: 1, cycle, programId: PROGRAM, active: false, rosterConfirmed: false, requestIds: [], materialsDue: null, boardEnds: null, adminId: null });
      }
    }).catch(e => { if (seq === generation.current && !controller.signal.aborted) { setMessageType('error'); setMessageScope('page'); setMessage(e.message); } });
    return () => controller.abort();
  }, [cycle]);
  async function act(fn, scope = 'page') {
    const seq = generation.current;
    let actionSucceeded = false;
    setBusy(true); setMessage(''); setMessageScope(scope); setMessageType('success');
    try {
      const result = await fn(() => mounted.current && generation.current === seq);
      if (!mounted.current || generation.current !== seq) return;
      actionSucceeded = true;
      setMessage(result?.message || 'Saved.');
      const current = await api(`/api/workbench/board-writeups?cycle=${cycle}`).catch(e => { if (caps?.isSuperuser && !data) return null; throw e; });
      if (generation.current === seq) { setData(current); setSelected([]); }
    } catch (e) { if (mounted.current && generation.current === seq) { setMessageType(actionSucceeded ? 'refresh-error' : 'error'); setMessage(e.message); } }
    finally { if (mounted.current && generation.current === seq) setBusy(false); }
  }
  async function release() {
    const rows = data.rows.filter(row => selected.includes(row.requestId));
    if (rows.some(row => row.source.earlyDraft) && !window.confirm('This writeup is still in drafting. Release the current version to Allison?')) return;
    if (!window.confirm(`Release ${rows.length} writeup(s) to Allison? Existing Board copies will not be replaced.`)) return;
    await act(async () => {
      const result = await api('/api/workbench/board-writeups', { cycle, selections: rows.map(row => ({ requestId: row.requestId, documentId: row.source.documentId, eTag: row.source.eTag, versionId: row.source.versionId, draftConfirmed: row.source.earlyDraft })) });
      return { message: result.results.map(x => `${rows.find(r => r.requestId === x.requestId)?.source.number}: ${x.status}${x.message ? ` — ${x.message}` : ''}`).join('; ') + (result.results.some(x => x.status === 'queued') ? '. Copies are queued; refresh to check progress.' : '') };
    });
  }
  async function checkFiles() {
    const seq = generation.current;
    await act(async () => {
      const value = await api(`/api/admin/board-writeup-cycles?cycle=${cycle}&action=reconcile`);
      if (seq === generation.current) setReport(value);
      return { message: 'File check complete.' };
    });
  }
  async function inspectRecovery(requestId, operation) {
    await act(async isCurrent => {
      const details = await api(`/api/admin/board-writeup-cycles?cycle=${cycle}&action=inspectRecovery&requestId=${requestId}&operation=${operation}`);
      if (isCurrent()) setRecovery({ ...details, requestId, operation });
      return { message: 'Review recovery options below.' };
    });
  }
  async function recover(action, file = {}) {
    const reason = window.prompt('Explain the investigation and why this recovery is appropriate.');
    if (!reason) return;
    await act(async isCurrent => {
      const result = await api('/api/admin/board-writeup-cycles', { action: 'recover', cycle, resolution: { requestId: recovery.requestId, operation: recovery.operation, action, reason, ...file } });
      if (isCurrent()) setRecovery(null);
      return { message: result.status === 'excluded' ? 'Exclusion recorded in the archive history.' : result.status === 'cancelled' ? 'Uncommitted release cancelled. The CSO can select it again after resolving the issue.' : 'Recovery queued. Existing files will be verified before proceeding.' };
    });
  }
  const feedback = message && <div ref={feedbackRef} tabIndex={-1} role={messageType !== 'success' ? 'alert' : 'status'} className={`rounded border p-3 ${messageType !== 'success' ? 'border-red-300 bg-red-50 text-red-900' : 'border-green-300 bg-green-50 text-green-900'}`}><p className="font-semibold">{messageType === 'refresh-error' ? 'Saved, but status could not refresh' : messageType === 'error' ? (messageScope === 'setup' ? 'Setup could not be saved' : 'Action could not be completed') : 'Success'}</p><p>{message}</p>{messageType === 'error' && messageScope === 'setup' && <p className="mt-1">Your entries are still here. Resolve the issue and try Save setup again.</p>}</div>;
  const change = patch => setForm(current => ({ ...current, ...patch }));
  return <div className="space-y-6 py-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Board writeups</h1><p className="text-gray-600">Release to Allison, then preserve the final Board versions.</p></div><label>Cycle <input aria-label="Cycle" className="ml-2 w-20 rounded border p-2" value={cycle} maxLength={3} onChange={e => { generation.current += 1; setBusy(false); setData(null); setRecovery(null); setSettings(null); setForm(null); setReport(null); setSelected([]); setMessage(''); setCycle(e.target.value.toUpperCase()); }} /></label></div>
    <button className={button} disabled={busy} onClick={() => act(async () => ({ message: 'Refreshed.' }))}>Refresh status</button>
    {messageScope === 'page' && feedback}
    {data && <><div className="rounded border p-4"><strong className="text-xl">{data.progress.released} of {data.progress.expected} released to Allison</strong><p>Materials deadline: {data.config.materialsDue || 'Not set'}</p><p>{data.archiveCompletedAt ? 'Archival complete' : data.archiveStartedAt ? 'Archival started — releases closed' : data.firstEventAt ? 'Daily reminders active until all writeups are released' : 'Reminder window not started'}</p></div>
      <label>Show <select value={rowFilter} onChange={e => setRowFilter(e.target.value)} className="ml-2 rounded border p-2"><option value="all">All writeups</option><option value="outstanding">Outstanding</option><option value="released">Released</option></select></label>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['Select', 'Request', 'Institution', 'Lead PD', 'Stage', 'Delivery', 'Documents'].map(x => <th key={x} className="border-b p-2">{x}</th>)}</tr></thead><tbody>{data.rows.filter(row => rowFilter === 'all' || (rowFilter === 'released' ? Boolean(row.receipt?.releasedAt) : row.expected !== false && !row.receipt?.releasedAt)).map(row => <tr key={row.requestId}>
        <td className="border-b p-2">{data.canRelease && row.expected !== false && row.source && !row.receipt?.releasedAt && (!row.receipt || ['failed', 'cancelled'].includes(row.receipt.state)) && <input aria-label={`Select ${row.source.number}`} type="checkbox" checked={selected.includes(row.requestId)} onChange={e => setSelected(old => e.target.checked ? [...old, row.requestId] : old.filter(x => x !== row.requestId))} />}</td>
        <td className="border-b p-2">{row.source?.number || row.receipt?.source.number || row.number || 'Unavailable'}</td><td className="border-b p-2">{row.source?.institution || row.receipt?.source.institution || row.institution}</td><td className="border-b p-2">{row.source?.leadPD || row.leadPD || 'Not assigned'}</td><td className="border-b p-2">{row.expected === false ? 'Removed from expected list' : row.source?.stage || '—'}</td><td className="border-b p-2">{row.receipt?.state || (row.error ? 'Needs attention' : row.source ? 'Not released' : data.canRelease ? 'No available writeup' : 'Not released')}{row.receipt?.error && <p className="text-sm">Needs administrator investigation</p>}{data.canArchive && ['held', 'failed'].includes(row.receipt?.state) && <button className={button} disabled={busy} onClick={() => inspectRecovery(row.requestId, 'release')}>Investigate release</button>}{data.canArchive && row.archive?.state === 'held' && <button className={button} disabled={busy} onClick={() => inspectRecovery(row.requestId, 'archive')}>Investigate archive</button>}</td>
        <td className="space-x-3 border-b p-2">{row.source?.webUrl && <a className="underline" href={row.source.webUrl} target="_blank" rel="noreferrer">Working draft</a>}{row.receipt?.destination?.webUrl && <a className="underline" href={row.receipt.destination.webUrl} target="_blank" rel="noreferrer">Board copy</a>}{row.archive?.destination?.webUrl && <a className="underline" href={row.archive.destination.webUrl} target="_blank" rel="noreferrer">Archived writeup</a>}</td>
      </tr>)}</tbody></table></div>
      {data.canRelease && <button className={button} disabled={busy || !selected.length} onClick={release}>Release selected to Allison</button>}
      {data.isSuperuser && data.cleanup && <section id="discussion-cleanup" className="space-y-3 rounded border p-4">
        <h2 className="text-lg font-semibold">Staff-discussion cleanup</h2>
        <p>{data.cleanup.completedAt
          ? `Cleanup marked complete by ${data.cleanup.completedBy || 'an administrator'} on ${new Date(data.cleanup.completedAt).toLocaleDateString()}. Reminders have stopped.`
          : data.cleanup.dueDate
            ? `Daily email reminders to the cycle's admin recipient start ${data.cleanup.dueDate} at 9 a.m. Pacific, seven days after the Board meeting ends.`
            : 'Set the Board meeting end date to schedule the cleanup reminder.'}</p>
        {!data.config.active && !data.cleanup.completedAt && <p>Reminders are paused while this cycle is inactive.</p>}
        <p>Review the staff-discussion materials and carry out any cleanup you decide is appropriate. Marking complete records your decision and stops reminders; it does not delete files or records.</p>
        {data.cleanup.canComplete && <button className={button} disabled={busy} onClick={() => {
          if (window.confirm('Mark staff-discussion cleanup complete for this cycle and stop its daily reminders?')) act(async () => {
            await api('/api/admin/board-writeup-cycles', { action: 'completeCleanup', cycle });
            return { message: 'Cleanup marked complete. Daily cleanup reminders have stopped.' };
          });
        }}>Mark cleanup complete</button>}
      </section>}
      {data.canArchive && <div className="space-y-3"><h2 className="text-lg font-semibold">After the Board meeting</h2><button className={button} disabled={busy} onClick={checkFiles}>Check Board writeups</button>{report && <><ul>{report.rows.map(row => <li key={row.requestId} className="py-2">{row.number} — {row.institution}: {row.status} {row.status === 'moved' && <span>Restore this file to the cycle folder in SharePoint, then check again. </span>} {['missing', 'moved'].includes(row.status) && <button className={button} disabled={busy} onClick={() => { const reason = window.prompt('Why should this missing writeup be excluded?'); if (reason) act(() => api('/api/admin/board-writeup-cycles', { action: 'resolve', cycle, resolution: { action: 'exclude', requestId: row.requestId, reason } })); }}>Record exclusion</button>}{['missing', 'moved'].includes(row.status) && report.extras.length > 0 && <select aria-label={`Reconnect ${row.number}`} value="" disabled={busy} onChange={e => { const file = report.extras.find(x => x.itemId === e.target.value); const reason = window.prompt(`Confirm that ${file.name} is the restored Board writeup for ${row.number}. Explain the evidence.`); if (reason) act(async isCurrent => { await api('/api/admin/board-writeup-cycles', { action: 'resolve', cycle, resolution: { action: 'reconnect', requestId: row.requestId, itemId: file.itemId, eTag: file.eTag, confirmed: true, reason } }); if (isCurrent()) setReport(null); return { message: 'Restored copy reconnected. Check files again.' }; }); }}><option value="">Reconnect a restored copy…</option>{report.extras.map(file => <option key={file.itemId} value={file.itemId}>{file.name}</option>)}</select>}</li>)}</ul>{report.extras.length > 0 && <p>Unmatched files: {report.extras.map(x => x.name).join(', ')}. Resolve these files in SharePoint, then check again.</p>}<button className={button} disabled={busy || Boolean(data.archiveStartedAt) || report.extras.length > 0 || report.rows.some(x => !['present', 'excluded'].includes(x.status))} onClick={() => { if (window.confirm('Confirm that editing is finished and these are the versions used for the Board?')) act(() => api('/api/admin/board-writeup-cycles', { action: 'archive', cycle, expectedRevision: report.revision })); }}>Confirm and start archival</button></>}</div>}
      {recovery && <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">Recover interrupted {recovery.operation}</h2><p>Recovery verifies the existing copy. It never replaces a file that has been edited.</p>{recovery.canExclude && <button className={button} disabled={busy} onClick={() => { if (window.confirm('Exclude this writeup from the final archive? The reason and original release remain in the history.')) recover('exclude'); }}>Record archive exclusion</button>}{recovery.canCancel && <button className={button} disabled={busy} onClick={() => recover('cancel')}>Cancel release with no committed copy</button>}{recovery.canRetry && <button className={button} disabled={busy} onClick={() => recover('retry')}>Verify and resume</button>}{recovery.canRefreeze && recovery.eTag && <button className={button} disabled={busy} onClick={() => { if (window.confirm('Confirm that the current edited Board copy is the final version to archive?')) recover('refreeze', { eTag: recovery.eTag }); }}>Confirm current Board version</button>}{recovery.candidates.map(file => <div key={file.itemId}><a href={file.webUrl} target="_blank" rel="noreferrer" className="underline">{file.name}</a> <button className={button} disabled={busy} onClick={() => recover('bind', { itemId: file.itemId, eTag: file.eTag })}>Verify this copy</button></div>)}{!recovery.canRetry && !recovery.canCancel && !recovery.candidates.length && <p>No verified copy or definite refusal was found. This remains on hold for investigation; selecting it again will not upload another copy.</p>}</section>}
      <details><summary>Approval history</summary><ul>{data.events.filter(x => ['release_approved', 'released', 'archived'].includes(x.action)).map((x, i) => <li key={i}>{new Date(x.at).toLocaleString()} — {x.details?.actorName || data.rows.find(row => row.requestId === x.details.requestId)?.receipt?.actorName || 'Recorded staff member'} — {x.action.replaceAll('_', ' ')} — {data.rows.find(row => row.requestId === x.details.requestId)?.receipt?.source.number || 'Writeup'}{x.details?.source?.versionId && ` — version ${x.details.source.versionId}`}</li>)}</ul></details>
    </>}
    {data?.configPending && caps?.isSuperuser && <button className={button} disabled={busy} onClick={() => act(() => api('/api/admin/board-writeup-cycles', { action: 'reconcileConfig', cycle }))}>Reconcile interrupted setup save</button>}
    {caps?.isSuperuser && settings && form && <details open={!data || !data.config.active}><summary className="cursor-pointer text-lg font-semibold">Admin: cycle setup and roles</summary><div className="mt-4 space-y-4 rounded border p-4">
      {['cso', 'grantsManager'].map(role => <label key={role} className="block">{role === 'cso' ? 'CSO' : 'Grants Manager'} <select className="ml-3 rounded border p-2" value={settings.roles[role].value?.systemUserId || ''} disabled={busy} onChange={e => { const value = e.target.value || null; act(async isCurrent => { const saved = await api('/api/admin/board-writeup-cycles', { action: 'role', role, value: { version: 1, systemUserId: value }, expectedRevision: settings.roles[role].revision }); if (isCurrent()) setSettings(old => ({ ...old, roles: { ...old.roles, [role]: saved } })); return { message: 'Role saved.' }; }); }}><option value="">Not assigned</option>{settings.staff.map(person => <option key={person.systemUserId} value={person.systemUserId}>{person.name}</option>)}</select></label>)}
      <label className="block">Admin email recipient <select className="ml-3 rounded border p-2" value={form.adminId || ''} onChange={e => change({ adminId: e.target.value || null })}><option value="">Not assigned</option>{settings.staff.filter(x => x.isSuperuser).map(x => <option key={x.systemUserId} value={x.systemUserId}>{x.name}</option>)}</select></label>
      <label className="block">Materials deadline for Allison <input className="ml-3 rounded border p-2" type="date" value={form.materialsDue || ''} onChange={e => change({ materialsDue: e.target.value || null })} /></label><label className="block">Board meeting end date <input className="ml-3 rounded border p-2" type="date" value={form.boardEnds || ''} onChange={e => change({ boardEnds: e.target.value || null })} /></label>
      <fieldset>{form.requestIds.filter(id => !settings.candidates.some(x => x.requestId === id)).map(id => <label className="block text-amber-800" key={id}><input type="checkbox" checked onChange={() => change({ requestIds: form.requestIds.filter(x => x !== id) })} /> {data?.rows.find(x => x.requestId === id)?.number || 'Previously selected proposal'} — no longer in the candidate list; review before removing.</label>)}<legend className="font-semibold">Expected proposals — {form.requestIds.length} selected{cycle === 'D26' ? ' of 23' : ''}</legend><label className="block py-2">Find proposal <input className="ml-2 rounded border p-2" value={candidateSearch} onChange={e => setCandidateSearch(e.target.value)} placeholder="Request number or institution" /></label>{settings.candidates.filter(x => `${x.number} ${x.institution}`.toLowerCase().includes(candidateSearch.toLowerCase())).map(x => <label className="block" key={x.requestId}><input type="checkbox" checked={form.requestIds.includes(x.requestId)} onChange={e => change({ requestIds: e.target.checked ? [...form.requestIds, x.requestId] : form.requestIds.filter(id => id !== x.requestId) })} /> {x.number} — {x.institution}</label>)}</fieldset>
      <label className="block"><input type="checkbox" checked={form.rosterConfirmed} onChange={e => change({ rosterConfirmed: e.target.checked })} /> Staff has confirmed this expected proposal list</label><label className="block"><input type="checkbox" checked={form.active} onChange={e => change({ active: e.target.checked })} /> Activate this cycle</label>
      <button className={button} disabled={busy} onClick={() => { const reason = settings.cycle.value?.rosterConfirmed ? window.prompt('Explain any change to the confirmed proposal list (or leave blank if unchanged).') : ''; act(async isCurrent => { const saved = await api('/api/admin/board-writeup-cycles', { action: 'save', cycle, value: form, expectedRevision: settings.cycle.revision, reason }); if (isCurrent()) setSettings(old => ({ ...old, cycle: saved })); return { message: 'Cycle setup saved.' }; }, 'setup'); }}>{busy && messageScope === 'setup' ? 'Saving setup…' : 'Save setup'}</button>
      {messageScope === 'setup' && feedback}
    </div></details>}
  </div>;
}
