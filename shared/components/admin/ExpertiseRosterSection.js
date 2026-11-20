import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../Layout';
import RosterContactField from '../expertise-finder/RosterContactField';
import { requestJson } from '../../utils/api-request';

const ENDPOINT = '/api/admin/expertise-roster';
const CATEGORIES = ['Research Program Staff', 'Consultant', 'Board'];
const FIELDS = [
  ['role', 'Title'], ['affiliation', 'Affiliation'], ['orcid', 'ORCID'],
  ['primary_fields', 'Primary fields'], ['keywords', 'Keywords'],
  ['subfields_specialties', 'Specialties'], ['methods_techniques', 'Methods'],
  ['distinctions', 'Distinctions'], ['expertise', 'Expertise description'],
  ['keck_affiliation', 'Keck affiliation'], ['keck_affiliation_details', 'Keck affiliation details'],
];
const LONG = new Set(['subfields_specialties', 'methods_techniques', 'distinctions', 'expertise', 'keck_affiliation_details']);
const INPUT = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-500';
const EMPTY = { name: '', role_type: 'Consultant', is_active: true, lead_pd_eligible: false, dataverse_contact_id: null, dataverse_user_id: null, preferred_email: null };

export default function ExpertiseRosterSection() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [inactive, setInactive] = useState(false);
  const [editor, setEditor] = useState(null);
  const [notice, setNotice] = useState('');
  const searchId = useId();
  const categoryId = useId();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    requestJson(ENDPOINT + '?includeInactive=true', { signal: controller.signal }).then(result => {
      if (active) setData(result);
    }).catch(e => { if (active && e.name !== 'AbortError') setError(e.message || 'The roster could not be loaded.'); });
    return () => { active = false; controller.abort(); };
  }, [reload]);
  if (data?.backend === 'postgres') return <p role="status" className="text-sm">Roster editing is unavailable in this deployment. Ask your administrator to check the roster configuration.</p>;
  const members = (data?.members || []).filter(r => (inactive || r.is_active) && (!category || r.role_type === category)
    && `${r.name} ${r.affiliation || ''} ${r.expertise || ''} ${r.keywords || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5">
    {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    {error && <div role="alert" className="text-sm text-red-700">{error} <Button variant="link" onClick={() => { setError(''); setReload(x => x + 1); }}>Retry</Button></div>}
    {editor ? <RosterEditor key={editor.id || editor.mutation_id} initial={editor} users={data?.users || []}
      onCancel={() => { setEditor(null); setData(null); setReload(x => x + 1); }} onSaved={member => {
        setData(current => ({ ...current, members: [...current.members.filter(r => r.id !== member.id), member].sort((a, b) => a.name.localeCompare(b.name)) }));
        setEditor(null); setNotice('Roster member saved.');
      }} /> : <>
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={searchId} className="min-w-48 flex-1 text-sm font-medium">Search roster<input id={searchId} type="search" className={INPUT} value={search} onChange={e => setSearch(e.target.value)} /></label>
        <label htmlFor={categoryId} className="text-sm font-medium">Category<select id={categoryId} className={INPUT} value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} />Include inactive</label>
        <Button disabled={!data || Boolean(error)} onClick={() => { setNotice(''); setEditor({ ...EMPTY, mutation_id: crypto.randomUUID() }); }}>Add person</Button>
      </div>
      {!data && !error ? <div aria-label="Loading roster" className="space-y-3 animate-pulse">{[1, 2, 3].map(x => <div key={x} className="h-12 rounded bg-gray-100" />)}</div> : <ul className="divide-y divide-gray-200">
        {members.map(member => <li key={member.id} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0"><p className="font-medium break-words">{member.name}{!member.is_active && <span className="ml-2 text-xs font-normal text-gray-500">Inactive</span>}</p><p className="text-sm text-gray-600 break-words">{member.role_type}{member.affiliation ? ` · ${member.affiliation}` : ''}</p></div>
          <Button variant="outline" disabled={Boolean(error)} aria-label={`Edit ${member.name}`} onClick={() => { setNotice(''); setEditor(member); }}>Edit</Button>
        </li>)}
      </ul>}
      {data && !error && !members.length && <p className="py-4 text-sm text-gray-600">No people match these filters. Change the filters or add a person.</p>}
    </>}
  </div>;
}

export function RosterEditor({ initial, users, onSaved, onCancel }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const mounted = useRef(true);
  const prefix = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const set = (field, value) => setForm(old => ({ ...old, [field]: value }));
  const submit = async e => {
    e.preventDefault(); setSaving(true); setError('');
    const payload = Object.fromEntries(['id', 'etag', 'mutation_id', ...Object.keys(EMPTY), ...FIELDS.map(([k]) => k)]
      .filter(k => form[k] !== undefined).map(k => [k, form[k]]));
    try {
      const result = await requestJson(ENDPOINT, { method: initial.id ? 'PATCH' : 'POST', body: payload });
      if (mounted.current) onSaved(result.member);
    } catch (failure) { if (mounted.current) setError(failure.message || 'Save could not be confirmed. Retry with this form.'); }
    finally { if (mounted.current) setSaving(false); }
  };
  const reloadSaved = async () => {
    setSaving(true);
    try {
      const result = await requestJson(`${ENDPOINT}?id=${encodeURIComponent(initial.id)}`);
      if (mounted.current) { setForm(result.member); setError(''); }
    } catch (failure) { if (mounted.current) setError(failure.message || 'The saved version could not be loaded.'); }
    finally { if (mounted.current) setSaving(false); }
  };
  const selectedUser = users.find(u => u.id === form.dataverse_user_id);
  return <form onSubmit={submit} className="space-y-5">
    <h3 className="text-lg font-semibold">{initial.id ? `Edit ${initial.name}` : 'Add roster member'}</h3>
    {error && <div role="alert" className="text-sm text-red-700"><p>{error}</p>{initial.id && <Button type="button" variant="link" disabled={saving} onClick={reloadSaved}>Reload saved version (discard these edits)</Button>}</div>}
    <fieldset disabled={saving} className="space-y-5 disabled:opacity-70">
      <div className="grid gap-4 md:grid-cols-2">
        <label htmlFor={prefix + 'name'} className="text-sm font-medium">Name<input id={prefix + 'name'} required maxLength={255} className={INPUT} value={form.name} onChange={e => set('name', e.target.value)} /></label>
        <label htmlFor={prefix + 'category'} className="text-sm font-medium">Category<select id={prefix + 'category'} className={INPUT} value={form.role_type} onChange={e => setForm(old => ({ ...old, role_type: e.target.value, lead_pd_eligible: false, dataverse_user_id: e.target.value === 'Research Program Staff' ? old.dataverse_user_id : null }))}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
        {FIELDS.map(([key, label]) => <label key={key} htmlFor={prefix + key} className={`text-sm font-medium ${LONG.has(key) ? 'md:col-span-2' : ''}`}>{label}{LONG.has(key)
          ? <textarea id={prefix + key} rows={3} className={INPUT} value={form[key] || ''} onChange={e => set(key, e.target.value)} />
          : <input id={prefix + key} className={INPUT} value={form[key] || ''} onChange={e => set(key, e.target.value)} />}</label>)}
      </div>
      <RosterContactField endpoint={ENDPOINT} contactId={form.dataverse_contact_id} memberName={form.name}
        onSelect={contact => setForm(old => ({ ...old, dataverse_contact_id: contact.contactId, preferred_email: initial.id ? old.preferred_email : null }))} onClear={() => set('dataverse_contact_id', null)} />
      <label htmlFor={prefix + 'email'} className="block text-sm font-medium">Preferred email<input id={prefix + 'email'} type="email" className={INPUT} disabled={Boolean(form.dataverse_contact_id)} value={form.preferred_email || ''} onChange={e => set('preferred_email', e.target.value)} />{form.dataverse_contact_id && <span className="mt-1 block text-xs font-normal text-gray-600">Email comes from the linked Contact.</span>}</label>
      {form.role_type === 'Research Program Staff' && <div className="space-y-2">
        <label htmlFor={prefix + 'user'} className="block text-sm font-medium">Staff account<input id={prefix + 'user'} type="search" className={INPUT} value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search staff by name" /></label>
        {form.dataverse_user_id && <p className="text-sm">{selectedUser?.name || 'Linked staff account (not currently available)'} <Button type="button" variant="link" onClick={() => setForm(old => ({ ...old, dataverse_user_id: null, lead_pd_eligible: false }))}>Unlink staff account</Button></p>}
        {userSearch && <ul className="max-h-48 overflow-y-auto divide-y divide-gray-100">{users.filter(u => `${u.name} ${u.email}`.toLowerCase().includes(userSearch.toLowerCase())).map(u => <li key={u.id}><Button type="button" variant="link" onClick={() => { set('dataverse_user_id', u.id); setUserSearch(''); }}>{u.name} — {u.email}</Button></li>)}</ul>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!form.is_active || !form.dataverse_user_id} checked={form.lead_pd_eligible} onChange={e => set('lead_pd_eligible', e.target.checked)} />Eligible for future lead-PD recommendations</label>
      </div>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={e => setForm(old => ({ ...old, is_active: e.target.checked, lead_pd_eligible: e.target.checked && old.lead_pd_eligible }))} />Active roster member</label>
      <p className="text-xs text-gray-600">Inactive people remain in the roster and keep their historical references.</p>
      <div className="flex items-center gap-3"><Button type="submit">{saving ? 'Saving…' : 'Save person'}</Button><Button type="button" variant="link" onClick={onCancel}>Cancel</Button></div>
    </fieldset>
  </form>;
}
