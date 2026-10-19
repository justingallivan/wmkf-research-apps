import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useBoardUnsavedChanges from './useBoardUnsavedChanges';
import { Button } from '../Layout';
import { requestEnvelope } from '../../utils/api-request';
const PROGRAM = 'c247b11a-a7cb-ee11-9078-000d3a341e8f';
const field = 'min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-500';
const emptySetup = cycle => ({ version: 1, cycle, programId: PROGRAM, active: false, rosterConfirmed: false, requestIds: [], materialsDue: null, boardEnds: null, adminId: null });
const dateLabel = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not set';
async function api(url, body, signal) {
  const result = await requestEnvelope(url, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal });
  if (!result.ok) throw Object.assign(new Error(result.data?.error || 'The operation could not be completed.'), { code: result.data?.code });
  return result.data;
}
export default function BoardWriteups({ initialCycle = 'D26', mode = 'dashboard' }) {
  const isSetup = mode === 'setup';
  const [cycleInput, setCycleInput] = useState(initialCycle), [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false), [reload, setReload] = useState(0);
  const [cycle, setCycle] = useState(initialCycle), [caps, setCaps] = useState(null), [data, setData] = useState(null);
  const [settings, setSettings] = useState(null), [form, setForm] = useState(null), [report, setReport] = useState(null);
  const [candidateSearch, setCandidateSearch] = useState(''), [rowFilter, setRowFilter] = useState('all');
  const [recovery, setRecovery] = useState(null);
  const [selected, setSelected] = useState([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success'), [messageScope, setMessageScope] = useState('page');
  const feedbackRef = useRef(null);
  useEffect(() => {
    if (message && messageType !== 'success') {
      feedbackRef.current?.focus({ preventScroll: true });
      feedbackRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [message, messageScope, messageType]);
  const generation = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  useEffect(() => {
    const controller = new AbortController(), seq = ++generation.current;
    api('/api/workbench/board-writeups', null, controller.signal).then(async permissions => {
      if (seq !== generation.current) return;
      setCaps(permissions);
      if (isSetup ? !permissions.canArchive : !permissions.canRelease && !permissions.canArchive) throw new Error(isSetup ? 'Cycle setup is available to system administrators and the assigned Grants Manager.' : 'This dashboard is for the CSO, Grants Manager and system administrators.');
      const state = await api(`/api/workbench/board-writeups?cycle=${cycle}`, null, controller.signal).catch(e => { if (e.code !== 'board_cycle_unconfigured') throw e; return null; });
      if (seq !== generation.current) return;
      setData(state);
      if (isSetup) {
        const setup = await api(`/api/admin/board-writeup-cycles?cycle=${cycle}`, null, controller.signal);
        if (seq !== generation.current) return;
        setSettings(setup); setForm(setup.cycle.value || emptySetup(cycle));
      }
    }).catch(e => { if (seq === generation.current && !controller.signal.aborted) { setMessageType('error'); setMessageScope('page'); setMessage(e.message); setLoadFailed(true); } }).finally(() => { if (seq === generation.current && !controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cycle, isSetup, reload]);
  async function act(fn, scope = 'page') {
    const seq = generation.current;
    let actionSucceeded = false;
    setBusy(true); setMessage(''); setMessageScope(scope); setMessageType('success');
    try {
      const result = await fn(() => mounted.current && generation.current === seq);
      if (!mounted.current || generation.current !== seq) return;
      actionSucceeded = true;
      setMessage(result?.message || 'Saved.');
      const current = await api(`/api/workbench/board-writeups?cycle=${cycle}`).catch(e => { if (e.code === 'board_cycle_unconfigured') return null; throw e; });
      if (mounted.current && generation.current === seq) { setData(current); setSelected([]); }
    } catch (e) { if (mounted.current && generation.current === seq) { setMessageType(actionSucceeded ? 'refresh-error' : 'error'); setMessage(e.message); } }
    finally { if (mounted.current && generation.current === seq) setBusy(false); }
  }
  async function release() {
    const rows = data.rows.filter(row => selected.includes(row.requestId));
    if (rows.some(row => row.source.earlyDraft) && !window.confirm('This writeup is still in drafting. Release the current version to the President?')) return;
    if (!window.confirm(`Release ${rows.length} writeup(s) to the President? Existing Board copies will not be replaced.`)) return;
    await act(async () => {
      const result = await api('/api/workbench/board-writeups', { cycle, selections: rows.map(row => ({ requestId: row.requestId, documentId: row.source.documentId, eTag: row.source.eTag, versionId: row.source.versionId, draftConfirmed: row.source.earlyDraft })) });
      return { message: result.results.map(x => `${rows.find(r => r.requestId === x.requestId)?.source.number}: ${x.status}${x.message ? ` — ${x.message}` : ''}`).join('; ') + (result.results.some(x => x.status === 'queued') ? '. Copies are queued; refresh to check progress. The President will receive one email from the CSO after the batch finishes.' : '') };
    });
  }
  async function checkFiles() {
    const seq = generation.current;
    await act(async () => {
      const value = await api(`/api/admin/board-writeup-cycles?cycle=${cycle}&action=reconcile`);
      if (mounted.current && seq === generation.current) setReport(value);
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
  const feedback = message && <div ref={feedbackRef} tabIndex={-1} role={messageType !== 'success' ? 'alert' : 'status'} className={`rounded border p-3 ${messageType !== 'success' ? 'border-red-300 bg-red-50 text-red-900' : 'border-green-300 bg-green-50 text-green-900'}`}><p className="font-semibold">{messageType === 'refresh-error' ? 'Saved, but status could not refresh' : messageType === 'error' ? (messageScope.startsWith('role:') ? 'Role could not be saved' : messageScope === 'setup' ? 'Setup could not be saved' : 'Action could not be completed') : 'Success'}</p><p>{message}</p>{messageType === 'error' && messageScope === 'setup' && <p className="mt-1">Your entries are still here. Resolve the issue and try Save setup again.</p>}</div>;
  const change = patch => setForm(current => ({ ...current, ...patch }));
  const ready = Boolean(data?.config.active && data.config.rosterConfirmed && data.progress.expected > 0 && !data.configPending);
  const visibleRows = (data?.rows || []).filter(row => rowFilter === 'all' || (rowFilter === 'released' ? Boolean(row.receipt?.releasedAt) : row.expected !== false && !row.receipt?.releasedAt));
  const dirty = isSetup && form && JSON.stringify(form) !== JSON.stringify(settings?.cycle.value || emptySetup(cycle));
  const discardChanges = () => !dirty || window.confirm('Discard your unsaved cycle setup changes?');
  useBoardUnsavedChanges(Boolean(dirty));
  function switchCycle(event) {
    event.preventDefault();
    const next = cycleInput.trim().toUpperCase();
    if (!/^[JD]\d{2}$/.test(next)) { setMessageType('error'); setMessageScope('page'); setMessage('Enter a cycle such as D26 or J27.'); return; }
    if (next === cycle || !discardChanges()) return;
    generation.current += 1; setLoadFailed(false); setLoading(true); setBusy(false); setData(null); setCaps(null); setRecovery(null); setSettings(null); setForm(null); setReport(null); setSelected([]); setMessage(''); setRowFilter('all'); setCandidateSearch(''); setCycleInput(next); setCycle(next);
  }
  return <div className="space-y-6 py-6 text-gray-900">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">{isSetup ? 'Board cycle setup' : 'Board writeups'}</h1><p className="mt-1 max-w-2xl text-gray-600">{isSetup ? 'Prepare the cycle for the CSO and manage the final copies after the meeting.' : 'Review writeups and send approved copies to the Board folder.'}</p></div>
      <form onSubmit={switchCycle} className="flex items-end gap-2"><label className="text-sm font-medium">Cycle<input aria-label="Cycle" className={`${field} ml-2 w-24`} value={cycleInput} maxLength={3} onChange={e => setCycleInput(e.target.value.toUpperCase())} /></label><Button type="submit" variant="outline" size="sm">Open cycle</Button></form>
    </header>
    <nav aria-label="Board workflow" className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
      <div className="flex flex-wrap gap-5"><Link className={!isSetup ? 'font-semibold underline underline-offset-8' : 'text-gray-600 underline underline-offset-4'} onClick={event => { if (busy) event.preventDefault(); }} aria-current={!isSetup ? 'page' : undefined} href={`/board-writeups?cycle=${cycle}`}>CSO dashboard</Link>{caps?.canArchive && <Link className={isSetup ? 'font-semibold underline underline-offset-8' : 'text-gray-600 underline underline-offset-4'} onClick={event => { if (busy) event.preventDefault(); }} aria-current={isSetup ? 'page' : undefined} href={`/board-cycle-setup?cycle=${cycle}`}>Cycle setup &amp; maintenance</Link>}</div>
      <Button variant="link" disabled={busy || loading} onClick={() => { if (!discardChanges()) return; setLoading(true); setLoadFailed(false); setMessage(''); setReload(n => n + 1); }}>Refresh status</Button>
    </nav>
    {messageScope === 'page' && feedback}
    {loading && <p role="status" className="rounded-lg bg-gray-100 p-6">Loading {cycle} {isSetup ? 'cycle setup' : 'writeups'}…</p>}
    {loadFailed && <Button variant="outline" size="sm" onClick={() => { if (!discardChanges()) return; setLoading(true); setLoadFailed(false); setMessage(''); setReload(n => n + 1); }}>Try again</Button>}
    {!loading && !loadFailed && !isSetup && <>
      {!ready ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-6"><h2 className="text-lg font-semibold text-amber-950">This cycle isn’t ready for release yet</h2><p className="mt-2 max-w-2xl text-amber-900">{!data || !data.progress.expected ? 'No proposals have been selected for this cycle.' : data.configPending ? 'A previous setup save needs reconciliation.' : !data.config.rosterConfirmed ? 'The proposal list still needs confirmation.' : 'This cycle is inactive.'} The Grants Manager or a system administrator needs to finish cycle setup before writeups can be released.</p>{caps?.canArchive && <Link className="mt-4 inline-block font-semibold text-amber-950 underline underline-offset-4" href={`/board-cycle-setup?cycle=${cycle}`}>Complete cycle setup</Link>}</section>
      : <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-6 py-4"><div><h2 className="text-lg font-semibold">{data.progress.released} of {data.progress.expected} released to the President</h2><p className="mt-1 text-sm text-gray-600">{data.archiveCompletedAt ? 'Final copies archived' : data.archiveStartedAt ? 'Archival in progress — releases closed' : 'Select the approved writeups to release in this batch.'}</p></div><p className="text-sm">Materials deadline <span className="ml-2 font-semibold">{dateLabel(data.config.materialsDue)}</span></p></section>}
      {!caps?.canRelease && <p className="text-sm text-gray-600">You’re viewing the CSO dashboard. Only the assigned CSO can release writeups; working drafts remain restricted to the CSO.</p>}
    </>}
    {!loading && !loadFailed && isSetup && data?.configPending && caps?.canArchive && <Button variant="outline" size="sm" disabled={busy} onClick={() => act(async isCurrent => { const saved = await api('/api/admin/board-writeup-cycles', { action: 'reconcileConfig', cycle }); if (isCurrent()) { setSettings(old => ({ ...old, cycle: saved })); if (!dirty) setForm(saved.value || emptySetup(cycle)); } return { message: 'Setup save reconciled.' }; })}>Reconcile interrupted setup save</Button>}
    {!loading && !loadFailed && isSetup && caps?.canArchive && settings && form && <section aria-label="Cycle setup" className="space-y-6 rounded-xl border border-gray-200 bg-white p-6"><div><h2 className="text-lg font-semibold">Shared staff assignments</h2><p className="mt-1 text-sm text-gray-600">These roles apply across Board cycles. Each assignment saves immediately.</p></div>
      <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 font-semibold">Staff roles</legend>{['president', 'cso', 'grantsManager'].map(role => <div key={role}><label className="block">{{ president: 'President', cso: 'CSO', grantsManager: 'Grants Manager' }[role]} <select className={`${field} mt-2 block w-full`} value={settings.roles[role].value?.systemUserId || ''} aria-disabled={busy} disabled={busy && messageScope !== `role:${role}`} onChange={e => { if (busy) return; const value = e.target.value || null; act(async isCurrent => { const saved = await api('/api/admin/board-writeup-cycles', { action: 'role', role, value: { version: 1, systemUserId: value }, expectedRevision: settings.roles[role].revision }); if (isCurrent()) setSettings(old => ({ ...old, roles: { ...old.roles, [role]: saved } })); return { message: 'Role saved.' }; }, `role:${role}`); }}><option value="">Not assigned</option>{settings.staff.map(person => <option key={person.systemUserId} value={person.systemUserId}>{person.name}</option>)}</select></label>{messageScope === `role:${role}` && feedback}</div>)}
      </fieldset><div className="border-t border-gray-200 pt-6"><h2 className="text-lg font-semibold">Cycle settings</h2><p className="mt-1 text-sm text-gray-600">Save the admin recipient, dates, proposal list and activation together.</p></div><fieldset disabled={busy}>
      <label className="block">Admin email recipient <select className={`${field} mt-2 block w-full`} value={form.adminId || ''} onChange={e => change({ adminId: e.target.value || null })}><option value="">Not assigned</option>{settings.staff.filter(x => x.isSuperuser).map(x => <option key={x.systemUserId} value={x.systemUserId}>{x.name}</option>)}</select></label>
      </fieldset><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 font-semibold">Cycle dates</legend><label className="block">Materials deadline for the President <input className={`${field} mt-2 block w-full`} type="date" value={form.materialsDue || ''} onChange={e => change({ materialsDue: e.target.value || null })} /></label><label className="block">Board meeting end date <input className={`${field} mt-2 block w-full`} type="date" value={form.boardEnds || ''} onChange={e => change({ boardEnds: e.target.value || null })} /></label>
      </fieldset><details key={`roster-${cycle}`} open={!settings.cycle.value?.rosterConfirmed}><summary className="min-h-11 cursor-pointer py-2 font-semibold">Proposal list — {form.requestIds.length} selected{form.rosterConfirmed ? ' · Confirmed' : ' · Needs confirmation'}</summary><fieldset disabled={busy} className="space-y-2">{form.requestIds.filter(id => !settings.candidates.some(x => x.requestId === id)).map(id => <label className="block text-amber-800" key={id}><input type="checkbox" checked onChange={() => change({ requestIds: form.requestIds.filter(x => x !== id) })} /> {data?.rows.find(x => x.requestId === id)?.number || 'Previously selected proposal'} — no longer in the candidate list; review before removing.</label>)}<legend className="font-semibold">Expected proposals — {form.requestIds.length} selected{cycle === 'D26' ? ' of 23' : ''}</legend><label className="block py-2">Find proposal <input className="ml-2 rounded border p-2" value={candidateSearch} onChange={e => setCandidateSearch(e.target.value)} placeholder="Request number or institution" /></label>{settings.candidates.filter(x => `${x.number} ${x.institution}`.toLowerCase().includes(candidateSearch.toLowerCase())).map(x => <label className="flex min-h-11 items-center gap-3" key={x.requestId}><input className="h-5 w-5 shrink-0" type="checkbox" checked={form.requestIds.includes(x.requestId)} onChange={e => change({ requestIds: e.target.checked ? [...form.requestIds, x.requestId] : form.requestIds.filter(id => id !== x.requestId) })} /> {x.number} — {x.institution}</label>)}</fieldset>
      <label className="flex min-h-11 items-center gap-3"><input className="h-5 w-5 shrink-0" type="checkbox" checked={form.rosterConfirmed} onChange={e => change({ rosterConfirmed: e.target.checked })} /> Staff has confirmed this expected proposal list</label></details><label className="flex min-h-11 items-center gap-3"><input className="h-5 w-5 shrink-0" type="checkbox" checked={form.active} onChange={e => change({ active: e.target.checked })} /> Activate this cycle</label>
      <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white py-3"><p className={`mb-2 text-sm font-medium ${dirty ? 'text-amber-900' : 'text-gray-600'}`} role="status">{dirty ? 'Unsaved cycle changes' : 'No unsaved cycle changes'}</p><Button className="min-h-11" size="sm" disabled={busy} onClick={() => { const reason = settings.cycle.value?.rosterConfirmed ? window.prompt('Explain any change to the confirmed proposal list (or leave blank if unchanged).') : ''; act(async isCurrent => { const saved = await api('/api/admin/board-writeup-cycles', { action: 'save', cycle, value: form, expectedRevision: settings.cycle.revision, reason }); if (isCurrent()) setSettings(old => ({ ...old, cycle: saved })); return { message: 'Cycle setup saved.' }; }, 'setup'); }}>{busy && messageScope === 'setup' ? 'Saving setup…' : 'Save setup'}</Button>
      {messageScope === 'setup' && feedback}</div>
    </section>}
    {!loading && !loadFailed && data && <>
      {!isSetup && data.rows.length > 0 && <section aria-label="Writeup queue" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><label className="text-sm font-medium">Show <select value={rowFilter} onChange={e => setRowFilter(e.target.value)} className={`${field} ml-2`}><option value="all">All writeups</option><option value="outstanding">Outstanding</option><option value="released">Released</option></select></label>
      {data.canRelease && ready && <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-gray-600">{selected.length} selected</span><Button size="sm" disabled={busy || !selected.length} onClick={release}>Release selected to the President</Button></div>}</div>
      {data.canRelease && ready && <p className="text-sm text-gray-600">After the batch finishes copying, the President receives one email from the CSO listing the released proposals and linking to the Board folder.</p>}
      {!visibleRows.length ? <p className="rounded-lg bg-gray-100 p-6">No writeups match this filter. Choose All writeups to see the proposal list.</p> :
      <div><table role="table" className="block w-full text-left md:table"><thead role="rowgroup" className="sr-only md:not-sr-only md:table-header-group"><tr role="row">{[...(data.canRelease && ready ? ['Select'] : []), 'Request', 'Institution', 'Lead PD', 'Stage', 'Delivery', 'Documents'].map(x => <th role="columnheader" scope="col" key={x} className="border-b p-2">{x}</th>)}</tr></thead><tbody role="rowgroup" className="block space-y-4 md:table-row-group md:space-y-0">{visibleRows.map(row => <tr role="row" className="block rounded-xl border border-gray-200 bg-white p-4 md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0" key={row.requestId}>
        {data.canRelease && ready && <td role="cell" className="block break-words py-2 md:table-cell md:border-b md:p-2">{row.expected !== false && row.source && !row.receipt?.releasedAt && (!row.receipt || ['failed', 'cancelled'].includes(row.receipt.state)) && <label className="flex min-h-11 min-w-11 cursor-pointer items-center gap-3"><span className="md:sr-only">Select writeup</span><input className="h-5 w-5" aria-label={`Select ${row.source.number}`} type="checkbox" checked={selected.includes(row.requestId)} onChange={e => setSelected(old => e.target.checked ? [...old, row.requestId] : old.filter(x => x !== row.requestId))} /></label>}</td>}
        <td role="cell" className="block break-words py-2 md:table-cell md:border-b md:p-2"><span aria-hidden="true" className="mr-2 font-semibold md:hidden">Request:</span>{row.source?.number || row.receipt?.source.number || row.number || 'Unavailable'}</td><td role="cell" className="block break-words py-2 md:table-cell md:border-b md:p-2"><span aria-hidden="true" className="mr-2 font-semibold md:hidden">Institution:</span>{row.source?.institution || row.receipt?.source.institution || row.institution}</td><td role="cell" className="block break-words py-2 md:table-cell md:border-b md:p-2"><span aria-hidden="true" className="mr-2 font-semibold md:hidden">Lead PD:</span>{row.source?.leadPD || row.leadPD || 'Not assigned'}</td><td role="cell" className="block break-words py-2 md:table-cell md:border-b md:p-2"><span aria-hidden="true" className="mr-2 font-semibold md:hidden">Stage:</span>{row.expected === false ? 'Removed from expected list' : row.source?.stage || '—'}</td><td role="cell" className="block break-words py-2 md:table-cell md:border-b md:p-2"><span aria-hidden="true" className="mr-2 font-semibold md:hidden">Delivery:</span>{({ queued: 'Queued for copying', delivering: 'Copying to Board folder', released: 'Released', held: 'Needs investigation', failed: 'Copy failed', cancelled: 'Cancelled' }[row.receipt?.state] || (row.receipt ? 'Needs investigation' : null)) || (row.error ? 'Needs attention' : row.source ? 'Not released' : data.canRelease ? 'No available writeup' : 'Not released')}{row.receipt?.error && <p className="text-sm">Needs administrator investigation</p>}</td>
        <td role="cell" className="block py-2 md:table-cell md:border-b md:p-2"><div className="flex flex-wrap gap-x-3">{row.source?.webUrl && <a className="inline-flex min-h-11 items-center underline" href={row.source.webUrl} target="_blank" rel="noreferrer">Working draft</a>}{row.receipt?.destination?.webUrl && <a className="inline-flex min-h-11 items-center underline" href={row.receipt.destination.webUrl} target="_blank" rel="noreferrer">Board copy</a>}{row.archive?.destination?.webUrl && <a className="inline-flex min-h-11 items-center underline" href={row.archive.destination.webUrl} target="_blank" rel="noreferrer">Archived writeup</a>}</div></td>
      </tr>)}</tbody></table></div>}
      </section>}
      {isSetup && data.isSuperuser && data.cleanup && <section id="discussion-cleanup" className="space-y-3 rounded border p-4">
        <h2 className="text-lg font-semibold">Staff-discussion cleanup</h2>
        <p>{data.cleanup.completedAt
          ? `Cleanup marked complete by ${data.cleanup.completedBy || 'an administrator'} on ${new Date(data.cleanup.completedAt).toLocaleDateString()}. Reminders have stopped.`
          : data.cleanup.dueDate
            ? `Daily email reminders to the cycle's admin recipient start ${dateLabel(data.cleanup.dueDate)} at 9 a.m. Pacific, seven days after the Board meeting ends.`
            : 'Set the Board meeting end date to schedule the cleanup reminder.'}</p>
        {!data.config.active && !data.cleanup.completedAt && <p>Reminders are paused while this cycle is inactive.</p>}
        <p>Review the staff-discussion materials and carry out any cleanup you decide is appropriate. Marking complete records your decision and stops reminders; it does not delete files or records.</p>
        {data.cleanup.canComplete && <Button variant="outline" size="sm" disabled={busy} onClick={() => {
          if (window.confirm('Mark staff-discussion cleanup complete for this cycle and stop its daily reminders?')) act(async () => {
            await api('/api/admin/board-writeup-cycles', { action: 'completeCleanup', cycle });
            return { message: 'Cleanup marked complete. Daily cleanup reminders have stopped.' };
          });
        }}>Mark cleanup complete</Button>}
      </section>}
      {isSetup && data.canArchive && <details className="rounded-xl border border-gray-200 bg-white p-6"><summary className="cursor-pointer text-lg font-semibold">After the Board meeting</summary><div className="mt-4 space-y-3"><Button variant="outline" size="sm" disabled={busy} onClick={checkFiles}>Check Board writeups</Button>{report && <><ul>{report.rows.map(row => <li key={row.requestId} className="py-2">{row.number} — {row.institution}: {row.status} {row.status === 'moved' && <span>Restore this file to the cycle folder in SharePoint, then check again. </span>} {['missing', 'moved'].includes(row.status) && <Button variant="outline" size="sm" disabled={busy} onClick={() => { const reason = window.prompt('Why should this missing writeup be excluded?'); if (reason) act(() => api('/api/admin/board-writeup-cycles', { action: 'resolve', cycle, resolution: { action: 'exclude', requestId: row.requestId, reason } })); }}>Record exclusion</Button>}{['missing', 'moved'].includes(row.status) && report.extras.length > 0 && <select aria-label={`Reconnect ${row.number}`} value="" disabled={busy} onChange={e => { const file = report.extras.find(x => x.itemId === e.target.value); const reason = window.prompt(`Confirm that ${file.name} is the restored Board writeup for ${row.number}. Explain the evidence.`); if (reason) act(async isCurrent => { await api('/api/admin/board-writeup-cycles', { action: 'resolve', cycle, resolution: { action: 'reconnect', requestId: row.requestId, itemId: file.itemId, eTag: file.eTag, confirmed: true, reason } }); if (isCurrent()) setReport(null); return { message: 'Restored copy reconnected. Check files again.' }; }); }}><option value="">Reconnect a restored copy…</option>{report.extras.map(file => <option key={file.itemId} value={file.itemId}>{file.name}</option>)}</select>}</li>)}</ul>{report.extras.length > 0 && <p>Unmatched files: {report.extras.map(x => x.name).join(', ')}. Resolve these files in SharePoint, then check again.</p>}<Button variant="outline" size="sm" disabled={busy || Boolean(data.archiveStartedAt) || report.extras.length > 0 || report.rows.some(x => !['present', 'excluded'].includes(x.status))} onClick={() => { if (window.confirm('Confirm that editing is finished and these are the versions used for the Board?')) act(() => api('/api/admin/board-writeup-cycles', { action: 'archive', cycle, expectedRevision: report.revision })); }}>Confirm and start archival</Button></>}</div></details>}
      {isSetup && data.canArchive && data.rows.some(row => ['held', 'failed'].includes(row.receipt?.state) || row.archive?.state === 'held') && <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-6"><h2 className="font-semibold">Writeups needing investigation</h2>{data.rows.filter(row => ['held', 'failed'].includes(row.receipt?.state) || row.archive?.state === 'held').map(row => <div key={row.requestId} className="flex flex-wrap items-center gap-3"><span>{row.number || row.receipt?.source?.number} — {row.institution || row.receipt?.source?.institution}</span>{['held', 'failed'].includes(row.receipt?.state) && <Button variant="outline" size="sm" disabled={busy} onClick={() => inspectRecovery(row.requestId, 'release')}>Investigate release</Button>}{row.archive?.state === 'held' && <Button variant="outline" size="sm" disabled={busy} onClick={() => inspectRecovery(row.requestId, 'archive')}>Investigate archive</Button>}</div>)}</section>}
      {isSetup && recovery && <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">Recover interrupted {recovery.operation}</h2><p>Recovery verifies the existing copy. It never replaces a file that has been edited.</p>{recovery.canExclude && <Button variant="outline" size="sm" disabled={busy} onClick={() => { if (window.confirm('Exclude this writeup from the final archive? The reason and original release remain in the history.')) recover('exclude'); }}>Record archive exclusion</Button>}{recovery.canCancel && <Button variant="outline" size="sm" disabled={busy} onClick={() => recover('cancel')}>Cancel release with no committed copy</Button>}{recovery.canRetry && <Button variant="outline" size="sm" disabled={busy} onClick={() => recover('retry')}>Verify and resume</Button>}{recovery.canRefreeze && recovery.eTag && <Button variant="outline" size="sm" disabled={busy} onClick={() => { if (window.confirm('Confirm that the current edited Board copy is the final version to archive?')) recover('refreeze', { eTag: recovery.eTag }); }}>Confirm current Board version</Button>}{recovery.candidates.map(file => <div key={file.itemId}><a href={file.webUrl} target="_blank" rel="noreferrer" className="underline">{file.name}</a> <Button variant="outline" size="sm" disabled={busy} onClick={() => recover('bind', { itemId: file.itemId, eTag: file.eTag })}>Verify this copy</Button></div>)}{!recovery.canRetry && !recovery.canCancel && !recovery.candidates.length && <p>No verified copy or definite refusal was found. This remains on hold for investigation; selecting it again will not upload another copy.</p>}</section>}
      {data.events.length > 0 && <details><summary className="cursor-pointer font-medium">Approval history</summary><ul>{data.events.filter(x => ['release_approved', 'released', 'archived'].includes(x.action)).map((x, i) => <li key={i}>{new Date(x.at).toLocaleString()} — {x.details?.actorName || data.rows.find(row => row.requestId === x.details.requestId)?.receipt?.actorName || 'Recorded staff member'} — {x.action.replaceAll('_', ' ')} — {data.rows.find(row => row.requestId === x.details.requestId)?.receipt?.source.number || 'Writeup'}{x.details?.source?.versionId && ` — version ${x.details.source.versionId}`}</li>)}</ul></details>}
    </>}

  </div>;
}
