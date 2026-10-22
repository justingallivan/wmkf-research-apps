import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAppAccess } from '../../context/AppAccessContext';
import { Button } from '../Layout';
import FinalWriteupMatrixAudiencesSection from '../admin/FinalWriteupMatrixAudiencesSection';
import { requestEnvelope } from '../../utils/api-request';
const roles = [['president', 'President'], ['cso', 'CSO'], ['grantsManager', 'Grants Manager'], ['programCoordinator', 'Program Coordinator']];
async function request(body, signal) {
  const result = await requestEnvelope('/api/workbench/staffing', { signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (!result.ok) throw new Error(result.data?.error || 'Staffing is unavailable. Try reloading.');
  return result.data;
}
function SharedRolesPanel() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0), [saving, setSaving] = useState(null), [feedback, setFeedback] = useState({});
  const generation = useRef(0);
  const [drafts, setDrafts] = useState({});
  function reloadAssignments() { setLoading(true); setError(''); setFeedback({}); setSaving(null); setDrafts({}); setReload(value => value + 1); }
  useEffect(() => {
    const controller = new AbortController(), current = ++generation.current;
    request(null, controller.signal).then(value => { if (generation.current === current) setData(value); })
      .catch(e => { if (!controller.signal.aborted && generation.current === current) setError(e.message); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => { controller.abort(); generation.current += 1; };
  }, [reload]);
  async function assign(role, systemUserId) {
    if (saving) return;
    const current = generation.current;
    setSaving(role); setFeedback(old => ({ ...old, [role]: null })); setDrafts(old => ({ ...old, [role]: systemUserId }));
    try {
      const saved = await request({ role, value: { version: 1, systemUserId: systemUserId || null }, expectedRevision: data.roles[role].revision });
      if (current !== generation.current) return;
      setData(old => ({ ...old, roles: { ...old.roles, [role]: saved } }));
      setDrafts(old => { const next = { ...old }; delete next[role]; return next; });
      setFeedback(old => ({ ...old, [role]: { text: 'Assignment saved.', success: true } }));
      // A departing Grants Manager may no longer have authority for another save.
      if (role === 'grantsManager' && !data.isSuperuser) reloadAssignments();
    } catch (e) { if (current === generation.current) setFeedback(old => ({ ...old, [role]: { text: e.message, success: false } })); }
    finally { if (current === generation.current) setSaving(null); }
  }
  if (loading) return <p role="status" className="rounded-lg bg-gray-100 p-6">Loading staffing assignments…</p>;
  if (error) return <div role="alert" className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900"><p>{error}</p><Button variant="outline" onClick={reloadAssignments}>Reload staffing</Button></div>;
  if (!data) return null;
  return <div className="space-y-8">
    <section aria-labelledby="shared-staffing-heading" className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="shared-staffing-heading" className="text-lg font-semibold">Shared roles</h2><p className="mt-1 max-w-2xl text-gray-600">These assignments apply across Board cycles. Each change saves immediately. System administrators and the assigned Grants Manager can edit them.</p></div><Button variant="link" disabled={Boolean(saving)} onClick={reloadAssignments}>Reload assignments</Button></div>
      <p className="mt-3 text-sm text-gray-600">The President can be any active, linked WMKF staff member. The CSO and Grants Manager require Workbench access.</p>
      <p className="mt-3 text-sm text-amber-900">Before changing the CSO, finish pending release batches. An unfinished batch approved by the previous CSO may require investigation before its email can be sent.</p>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">{roles.map(([role, label]) => {
        const value = drafts[role] ?? data.roles[role].value?.systemUserId ?? '';
        const message = feedback[role];
        const eligiblePeople = data.staff.filter(person => role === 'president' || role === 'programCoordinator' || person.canUseWorkbench === true);
        const unavailable = value && !eligiblePeople.some(person => person.systemUserId === value);
        return <div key={role}><label className="block font-medium" htmlFor={`staffing-${role}`}>{label}</label><select id={`staffing-${role}`} className="mt-2 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-500" value={value} disabled={Boolean(saving && saving !== role)} aria-disabled={Boolean(saving)} onChange={event => assign(role, event.target.value)}><option value="">Not assigned</option>{unavailable && <option value={value} disabled>Current assignee is unavailable — choose an eligible staff member</option>}{eligiblePeople.map(person => <option key={person.systemUserId} value={person.systemUserId}>{person.name}</option>)}</select>{saving === role && <p role="status" className="mt-2 text-sm">Saving assignment…</p>}{message && <p role={message.success ? 'status' : 'alert'} className={`mt-2 text-sm ${message.success ? 'text-green-800' : 'text-red-800'}`}>{message.text}</p>}{message && !message.success && <Button variant="outline" className="mt-2" disabled={Boolean(saving)} onClick={() => assign(role, value)}>Retry assignment</Button>}</div>;
      })}</div>
      <p className="mt-5 text-sm text-gray-600">Cycle dates, proposal lists and the cycle’s admin email recipient stay in <Link className="underline" href="/board-cycle-setup">Board cycle setup</Link>.</p>
    </section>
  </div>;
}

// Check Admin authority independently of shared Board staffing availability.
// Its own API remains superuser-only and its availability does not depend on Board staffing.
export default function StaffingPanel({ includeFinalWriteups = false }) {
  const { isSuperuser } = useAppAccess();
  return <div className="space-y-8">
    <SharedRolesPanel />
    {includeFinalWriteups && isSuperuser && <>
      <section id="final-writeup-matrix-audiences" aria-labelledby="final-staffing-heading" className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 id="final-staffing-heading" className="text-lg font-semibold">Final Writeup staffing</h2>
        <p className="mb-6 mt-1 text-gray-600">Assign staff responsibilities and program review audiences. This configuration is published separately by a system administrator.</p>
        <FinalWriteupMatrixAudiencesSection />
      </section>
      <section aria-label="Related staffing settings"><h2 className="font-semibold">Related assignments</h2><ul className="mt-2 space-y-2"><li><Link className="underline" href="/admin?workspace=workflows&view=proposal-ranking">Proposal Ranking facilitators</Link></li><li><Link className="underline" href="/admin?workspace=workflows&view=site-visits">Meeting attendees and Site Visit recipients</Link></li></ul></section>
    </>}
  </div>;
}
