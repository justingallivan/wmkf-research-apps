import { useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { requestJson } from '../../utils/api-request';
import useAdminUnsavedChangesGuard from './useAdminUnsavedChangesGuard';
import { CATEGORIES, COST_MODES, UPDATE_MODES, DECISIONS, REVIEW_STATES, isCorporateService, serviceStatus, reviewToday, nextReviewDate, defaultCadence } from '../../../lib/services/external-services/model';

import ExternalServiceCheckResults, { readableEvidence } from './ExternalServiceCheckResults';

const API = '/api/admin/external-services';
const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500';
const today = reviewToday;
const blankService = () => ({ name: '', provider: '', category: 'AI', purpose: '', configuration: '', updateMode: 'Unknown', costTracking: 'Review costs', owner: 'Justin', cadenceDays: 30, nextReviewOn: today(), actionNeeded: false, notes: '', links: [] });
const blankReview = () => ({ reviewedOn: today(), trigger: '', changes: '', evidence: '', decision: 'Keep', rationale: '', status: 'Proposed', followUp: '', links: [] });
function Field({ label, value, onChange, options, multiline, type = 'text', required = true, disabled = false, maxLength = 6000 }) {
  return <label className="block text-sm font-medium text-gray-700">{label}
    {options ? <select className={`${inputClass} mt-1`} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>{options.map(option => <option key={option}>{option}</option>)}</select>
      : multiline ? <textarea className={`${inputClass} mt-1`} rows={3} value={value} onChange={e => onChange(e.target.value)} required={required} maxLength={maxLength} />
        : <input className={`${inputClass} mt-1`} type={type} value={value} onChange={e => onChange(e.target.value)} required={required} maxLength={maxLength} max={type === 'date' ? '9999-12-31' : undefined} />}
  </label>;
}
function LinkEditor({ links, onChange }) {
  return <div className="space-y-3"><p className="text-sm font-medium text-gray-700">Reference links</p>{links.map((link, index) => <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto]">
    <Field label={`Link ${index + 1} label`} value={link.label} maxLength={120} onChange={label => onChange(links.map((v, i) => i === index ? { ...v, label } : v))} />
    <Field label={`Link ${index + 1} URL`} value={link.href} type="url" maxLength={1000} onChange={href => onChange(links.map((v, i) => i === index ? { ...v, href } : v))} />
    <Button type="button" variant="link" onClick={() => onChange(links.filter((_, i) => i !== index))}>Remove link {index + 1}</Button>
  </div>)}<Button type="button" variant="link" disabled={links.length >= 12} onClick={() => onChange([...links, { label: '', href: '' }])}>Add reference link</Button></div>;
}
function References({ links }) {
  return <ul className="space-y-1 text-sm">{links.map((link, i) => <li key={i}><a className="text-blue-700 underline underline-offset-2 break-words" href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a></li>)}</ul>;
}

export default function ExternalServicesSection() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('All services');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [updateCheck, setUpdateCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [reviews, setReviews] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(null);
  const [review, setReview] = useState(null);
  const [reviewId, setReviewId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const newServiceId = useRef(null);
  const saveFailed = useRef(false);
  const nextDateEdited = useRef(false);
  useAdminUnsavedChangesGuard(!!editor);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    requestJson(API, { signal: controller.signal, fallbackMessage: 'Could not load services.' }).then(data => {
      if (!controller.signal.aborted) { setServices(data.services || []); setLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setError('Could not load services. Please retry.'); setLoading(false); } });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    setReviews([]); setReviewError(''); setUpdateCheck(null); setChecking(false); setCheckError('');
    if (selected) {
      setReviewLoading(true);
      requestJson(`${API}?id=${encodeURIComponent(selected)}`, { signal: controller.signal }).then(data => {
        if (!controller.signal.aborted) { setReviews(data.reviews || []); setUpdateCheck(data.check || null); setReviewLoading(false); }
      }).catch(() => { if (!controller.signal.aborted) { setReviewError('Could not load review history. Please retry.'); setReviewLoading(false); } });
    }
    return () => { controller.abort(); generation.current += 1; };
  }, [selected, reload]);

  const current = services.find(item => item.id === selected);
  const visible = services.filter(item => (filter === 'All services' || serviceStatus(item) === filter)
    && `${item.data.provider} ${item.data.name} ${item.data.purpose}`.toLowerCase().includes(search.toLowerCase()));
  function openEditor(kind, existingReview) {
    nextDateEdited.current = false;
    if (kind === 'new') newServiceId.current = `service-${crypto.randomUUID()}`;
    setDraft(current ? structuredClone(current.data) : blankService());
    setReview(kind === 'review' ? structuredClone(existingReview?.data || blankReview()) : null);
    setReviewId(existingReview?.id || null); setEditor(kind); setError(''); setNotice('');
    if (kind === 'review' && !existingReview) setDraft({ ...current.data, nextReviewOn: nextReviewDate(today(), current.data.cadenceDays) });
  }
  function closeEditor() {
    setEditor(null); setDraft(null); setReview(null); setReviewId(null); setError('');
    // A failed response does not prove the transaction failed. Re-read before
    // another edit or creation so committed results and current versions appear.
    if (saveFailed.current) {
      saveFailed.current = false; setLoading(true); setReload(v => v + 1);
    }
  }
  function back() { closeEditor(); setSelected(null); setNotice(''); }
  async function save(event) {
    event.preventDefault(); if (saving) return;
    const token = generation.current;
    const id = current?.id || newServiceId.current;
    setSaving(true); setError('');
    try {
      await requestJson(API, { method: 'PUT', body: { id, data: { ...draft, costTracking: isCorporateService(selected, draft.provider) ? COST_MODES[1] : draft.costTracking }, expectedVersion: current?.version || 0, ...(review ? { review, reviewId } : {}) }, fallbackMessage: 'Could not save the service.' });
      if (generation.current !== token) return;
      saveFailed.current = false;
      closeEditor(); setSelected(id); setNotice('Saved.'); setReload(v => v + 1);
    } catch (err) {
      if (generation.current === token) {
        saveFailed.current = true;
        setError(err.status === 409
          ? 'This record changed or may already have been saved. Copy any unsaved notes, then Cancel to reload saved records before trying again.'
          : err.status === 413 ? 'These notes are too large to save. Shorten the text or reference links and try again.'
            : err.status === 400 ? err.message
            : 'We could not confirm the save. Copy any unsaved notes, then Cancel to reload saved records and check whether it succeeded.');
      }
    } finally { if (generation.current === token) setSaving(false); }
  }
  async function checkUpdates() {
    if (checking) return;
    const token = generation.current;
    setChecking(true); setCheckError('');
    try {
      const result = await requestJson(API, { method:'POST', body:{action:'check',id:selected} });
      if (generation.current === token) setUpdateCheck(result.check);
    } catch (err) {
      if (generation.current === token) setCheckError([400,409].includes(err.status) ? err.message : 'Could not confirm the check. Reload results before retrying.');
    } finally { if (generation.current === token) setChecking(false); }
  }
  function reviewFromCheck() {
    openEditor('review');
    const sources = updateCheck.sources || [];
    setReview(previous=>({...previous, trigger:'Manual service update check',decision:'Investigate',
      changes:sources.map(s=>`${s.label}: ${s.status}. ${s.summary}\n${(s.lines||[]).map(readableEvidence).join('\n')}${s.retainedObservedAt ? `\nRetained from ${s.retainedObservedAt}; not a fresh observation.` : ''}`).join('\n\n').slice(0,6000),
      evidence:`Checked ${updateCheck.checkedAt}. Provider statements and account observations; not independently benchmarked. ${sources.filter(s=>s.status==='unavailable').map(s=>`${s.label} could not be checked.`).join(' ')}`,
      links:sources.map(s=>({label:s.label,href:s.url}))}));
  }
  const setField = (key, value) => {
    if (key === 'nextReviewOn') nextDateEdited.current = true;
    setDraft(previous => {
      const next = { ...previous, [key]: value };
      if (editor === 'new' && key === 'category' && Number(previous.cadenceDays) === defaultCadence(previous.category)) next.cadenceDays = defaultCadence(value);
      return next;
    });
  };
  const setReviewField = (key, value) => {
    setReview(previous => ({ ...previous, [key]: value }));
    if (key === 'reviewedOn' && value && !reviewId && !nextDateEdited.current) {
      // Date inputs can emit an incomplete or five-digit year while typing.
      // Keep that input for validation without throwing during React render.
      try {
        const suggested = nextReviewDate(value, draft.cadenceDays);
        setDraft(previous => ({ ...previous, nextReviewOn: suggested }));
      } catch { /* Preserve the existing suggestion until the date is valid. */ }
    }
  };

  return <section aria-labelledby="external-services-title" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="external-services-title" className="text-xl font-semibold text-gray-900">External services</h2><p className="mt-1 text-sm text-gray-600">Review what we use, what changed, and what needs a decision.</p></div>
      {!selected && !editor && <Button disabled={loading} onClick={() => openEditor('new')}>Add service</Button>}
    </div>
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {error && <div role="alert" className="text-sm text-red-700">{error} {!editor && <Button variant="link" onClick={() => setReload(v => v + 1)}>Retry</Button>}</div>}
    {loading && !editor ? <div role="status" className="animate-pulse space-y-3"><span className="sr-only">Loading services</span>{[1, 2, 3].map(n => <div key={n} className="h-14 rounded bg-gray-100" />)}</div> : editor ?
      <form onSubmit={save} className="space-y-5 rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-lg font-semibold">{editor === 'review' ? `${reviewId ? 'Update' : 'Record'} review: ${current?.data.name}` : editor === 'new' ? 'Add service' : `Edit ${current?.data.name}`}</h3>
        <fieldset disabled={saving} className="space-y-4">
          {review ? <>
            <div className="grid gap-4 sm:grid-cols-3"><Field label="Review date (Pacific time)" type="date" value={review.reviewedOn} onChange={v => setReviewField('reviewedOn', v)} /><Field label="Decision" options={DECISIONS} value={review.decision} onChange={v => setReviewField('decision', v)} /><Field label="Implementation status" options={REVIEW_STATES} value={review.status} onChange={v => setReviewField('status', v)} /></div>
            <Field label="What prompted this review?" value={review.trigger} onChange={v => setReviewField('trigger', v)} maxLength={1000} />
            <Field label="What changed / findings" multiline value={review.changes} onChange={v => setReviewField('changes', v)} />
            <Field label="Evidence and limitations" multiline value={review.evidence} onChange={v => setReviewField('evidence', v)} />
            <p className="text-xs text-gray-600">Distinguish vendor claims, independent benchmarks, and our own observations.</p>
            <Field label="Decision rationale" multiline value={review.rationale} onChange={v => setReviewField('rationale', v)} maxLength={4000} />
            <Field label="Follow-up / implementation notes" multiline required={false} value={review.followUp} onChange={v => setReviewField('followUp', v)} maxLength={4000} />
            <LinkEditor links={review.links} onChange={v => setReviewField('links', v)} />
          </> : <>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Service name" value={draft.name} onChange={v => setField('name', v)} maxLength={120} /><Field label="Provider" value={draft.provider} onChange={v => setField('provider', v)} maxLength={120} /></div>
            <Field label="Category" options={CATEGORIES} value={draft.category} onChange={v => setField('category', v)} />
            <Field label="Used for" multiline value={draft.purpose} onChange={v => setField('purpose', v)} maxLength={2000} />
            <Field label="Current model, API, or plan" multiline value={draft.configuration} onChange={v => setField('configuration', v)} maxLength={2000} />
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Update behavior" options={UPDATE_MODES} value={draft.updateMode} onChange={v => setField('updateMode', v)} /><Field label="Cost tracking" options={COST_MODES} disabled={isCorporateService(selected, draft.provider)} value={isCorporateService(selected, draft.provider) ? COST_MODES[1] : draft.costTracking} onChange={v => setField('costTracking', v)} /></div>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Owner" value={draft.owner} onChange={v => setField('owner', v)} maxLength={120} /><Field label="Review interval (days)" type="number" value={draft.cadenceDays} onChange={v => setField('cadenceDays', v)} /></div>
            <Field label="Private account notes" multiline required={false} value={draft.notes} onChange={v => setField('notes', v)} />
            <LinkEditor links={draft.links} onChange={v => setField('links', v)} />
          </>}
          <Field label="Next review date" type="date" value={draft.nextReviewOn} onChange={v => setField('nextReviewOn', v)} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.actionNeeded} onChange={e => setField('actionNeeded', e.target.checked)} />Action needed</label>
          <p className="text-xs text-gray-600">Saved notes are private to Admin. Do not enter passwords, API keys, or sample grant data. Saving a review does not change provider settings.</p>
          <div className="flex gap-3"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : review ? 'Save review' : 'Save service'}</Button><Button type="button" variant="link" onClick={closeEditor}>Cancel</Button></div>
        </fieldset>
      </form> : current ? <>
        <Button variant="link" onClick={back}>Back to services</Button>
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{current.data.provider} · {current.data.name}</h3><p className="text-sm text-gray-600">{serviceStatus(current)} · Owner: {current.data.owner}</p></div><div className="flex gap-3"><Button variant="outline" onClick={() => openEditor('edit')}>Edit service</Button><Button onClick={() => openEditor('review')}>Record review</Button></div></div>
          <p className="text-sm text-gray-700">{current.data.purpose}</p>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">{[['Current configuration', current.data.configuration], ['Update behavior', current.data.updateMode], ['Cost tracking', current.data.costTracking], ['Review schedule', `Every ${current.data.cadenceDays} days · Next: ${current.data.nextReviewOn}`], ['Last reviewed', current.lastReviewedOn || 'Not yet reviewed']].map(([label, value]) => <div key={label}><dt className="font-medium text-gray-600">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
          {current.data.notes && <div><h4 className="text-sm font-semibold">Account and service notes</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">{current.data.notes}</p></div>}
          <References links={current.data.links} />
        </div>
        {['assemblyai','anthropic','serpapi','openai','vercel-hosting','neon'].includes(selected) && <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Update checks</h3><Button disabled={checking || reviewLoading || updateCheck?.setupRequired} onClick={checkUpdates}>{checking ? 'Checking…' : 'Check for updates'}</Button></div>
          <p className="text-sm text-gray-600">Manual only. Reads official references or account metrics; no AI generation, purchases, or automatic changes. Checks within one minute reuse the saved result.</p>
          {checkError && <p role="alert" className="text-sm text-red-700">{checkError}</p>}
          <Button variant="link" disabled={checking} onClick={()=>setReload(v=>v+1)}>Reload check results</Button>
          <ExternalServiceCheckResults check={updateCheck} serviceVersion={current.version} onReview={reviewFromCheck} />
        </div>}
        <div className="space-y-3"><h3 className="text-lg font-semibold">Review history</h3>{reviewLoading && <p role="status">Loading reviews…</p>}{reviewError && <p role="alert">{reviewError} <Button variant="link" onClick={() => setReload(v => v + 1)}>Retry history</Button></p>}
          {!reviewLoading && !reviewError && !reviews.length && <p className="text-sm text-gray-600">No reviews yet. Record the first review when you have checked this service.</p>}
          {reviews.map(item => <details key={item.id} className="rounded-lg border border-gray-200 bg-white p-4"><summary className="cursor-pointer text-sm font-medium">{item.data.reviewedOn} · {item.data.decision} · {item.data.status}</summary><div className="mt-4 space-y-4">{[['Trigger', item.data.trigger], ['Findings', item.data.changes], ['Evidence and limitations', item.data.evidence], ['Rationale', item.data.rationale], ['Follow-up', item.data.followUp]].map(([label, value]) => <div key={label}><h4 className="text-sm font-semibold">{label}</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">{value || 'None recorded'}</p></div>)}<References links={item.data.links} /><Button variant="link" onClick={() => openEditor('review', item)}>Update review</Button></div></details>)}
        </div>
      </> : <>
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]"><Field label="Search services" required={false} value={search} onChange={setSearch} /><Field label="Show" options={['All services', 'Review due', 'Action needed', 'Current']} value={filter} onChange={setFilter} /></div>
        <p className="text-sm text-gray-600">{visible.length} services · Microsoft, GitHub, and Zoom costs are corporate-managed and excluded.</p>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-gray-600"><tr>{['Service', 'Configuration', 'Status', 'Next review'].map(label => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{visible.map(item => <tr key={item.id}><td className="px-4 py-3"><Button variant="link" onClick={() => { setSelected(item.id); setNotice(''); }}>{item.data.provider} · {item.data.name}</Button><p className="text-xs text-gray-600">{item.data.category}</p></td><td className="max-w-sm px-4 py-3 text-gray-600"><p className="line-clamp-2">{item.data.configuration}</p></td><td className="px-4 py-3 whitespace-nowrap">{serviceStatus(item)}</td><td className="px-4 py-3 whitespace-nowrap tabular-nums">{item.data.nextReviewOn}</td></tr>)}</tbody></table></div>
        {!visible.length && <p className="text-sm text-gray-600">No matching services. Clear the filters or add a service.</p>}
      </>}
  </section>;
}
