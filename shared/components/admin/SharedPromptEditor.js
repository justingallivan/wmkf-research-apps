/** Synthetic shared-document profiles and tasks; publication remains server-validated. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { requestEnvelope } from '../../utils/api-request';
import { newRequestId } from './prompt-editor-utils';

const INPUT = 'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:bg-gray-100';
const DEFAULT_LIMITS = {maxDocuments:1,maxDocumentBytes:262144,maxTotalDocumentBytes:262144,maxRecordBytes:16000};
const LABELS = {'synthetic.executive-summary':'Executive summary','synthetic.methodology':'Methodology'};
const validName = value => /^[a-z][a-z0-9_-]{0,63}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);
const names = value => value.split(',').map(item => item.trim()).filter(Boolean);
const id = publication => `${publication.profile.key}@${publication.profile.revision}`;
const emptyProfile = () => ({key:'',sharedInstructions:'',documentRoles:'proposal',recordNames:'',limits:{...DEFAULT_LIMITS}});
const asDraft = profile => ({key:profile.key,sharedInstructions:profile.sharedInstructions,documentRoles:profile.documentRoles.join(', '),recordNames:profile.recordNames.join(', '),limits:{...profile.limits}});
const newTask = () => ({body:'',model:'',maxTokens:'1024',profileId:''});
function safeMessage(envelope, fallback) {
  const status = envelope?.data?.status;
  if (status === 'concurrency_conflict' || status === 'version_conflict') return 'Another admin published a revision. Reload and review your draft before publishing.';
  if (status === 'idempotency_key_reuse') return 'This request differs from the previous attempt. Review the draft and try again.';
  return fallback;
}
function requestIdentity(ref, payload) {
  const payloadKey = JSON.stringify(payload);
  if (ref.current.payloadKey !== payloadKey) ref.current = {payloadKey,requestId:newRequestId()};
  return ref.current.requestId;
}

export default function SharedPromptEditor() {
  const [open,setOpen] = useState(false);
  const [opened,setOpened] = useState(false);
  return <section className="mb-5 rounded-lg border border-gray-200 bg-white" aria-label="Shared document tasks">
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><h3 className="text-sm font-semibold text-gray-900">Shared document tasks</h3><p className="mt-1 text-xs text-gray-600">Synthetic trial only. These tasks do not write to real Requests.</p></div>
      <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => { setOpened(true); setOpen(value => !value); }}>{open ? 'Hide editor' : 'Open editor'}</Button>
    </div>
    {opened && <div hidden={!open} className="border-t border-gray-200 p-4"><Editor /></div>}
  </section>;
}

function Editor() {
  const [catalog,setCatalog] = useState(null);
  const [models,setModels] = useState(null);
  const [profileDraft,setProfileDraft] = useState(emptyProfile);
  const [historyId,setHistoryId] = useState('');
  const [taskName,setTaskName] = useState('');
  const [task,setTask] = useState(newTask);
  const [taskState,setTaskState] = useState('idle');
  const [taskVersion,setTaskVersion] = useState(null);
  const [conflictCurrent,setConflictCurrent] = useState(null);
  const [preview,setPreview] = useState(null);
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [reload,setReload] = useState(0);
  const [taskRetry,setTaskRetry] = useState(0);
  const mounted = useRef(true), loadGeneration = useRef(0), taskGeneration = useRef(0), editGeneration = useRef(0);
  const profileRequest = useRef({}), taskRequest = useRef({}), taskDrafts = useRef({});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loadGeneration.current++; taskGeneration.current++; editGeneration.current++; }; }, []);
  useEffect(() => {
    const generation = ++loadGeneration.current;
    setError('');
    Promise.all([requestEnvelope('/api/admin/prompt-profiles'),requestEnvelope('/api/admin/models')]).then(([profiles, modelResponse]) => {
      if (!mounted.current || generation !== loadGeneration.current) return;
      if (!profiles.ok || !modelResponse.ok || !Array.isArray(profiles.data?.profiles) || !Array.isArray(profiles.data?.tasks)) throw new Error('load');
      setCatalog(profiles.data); setModels(modelResponse.data);
      setTaskName(current => current || profiles.data.tasks.find(item => Object.hasOwn(LABELS,item.name))?.name || '');
    }).catch(() => { if (mounted.current && generation === loadGeneration.current) setError('Could not load shared profiles and reviewed models. Try again.'); });
  }, [reload]);
  useEffect(() => {
    if (!taskName) return undefined;
    const generation = ++taskGeneration.current;
    setTaskState('loading'); setTask(newTask()); setTaskVersion(null); setConflictCurrent(null); setPreview(null); setError('');
    requestEnvelope(`/api/admin/prompts/${encodeURIComponent(taskName)}`).then(envelope => {
      if (!mounted.current || generation !== taskGeneration.current) return;
      const draft = taskDrafts.current[taskName];
      if (envelope.status === 404) {
        if (draft) setTask(draft.task);
        if (draft && draft.state !== 'new') { setTaskState('blocked'); setError('The published task is no longer available. Your draft is retained.'); }
        else setTaskState('new');
        return;
      }
      const current = envelope.data?.current;
      if (!envelope.ok || envelope.data?.invariantError || !current || !Number.isSafeInteger(current.version) || current.version < 1) { setTaskState('blocked'); setError('This task has no single current version. Resolve its history before editing.'); return; }
      let reference;
      try { reference = JSON.parse(current.variables).execution.profile; } catch { setTaskState('blocked'); setError('This task does not have a valid shared profile reference.'); return; }
      const publication = catalog?.profiles.find(item => item.profile.key === reference?.key && item.profile.revision === reference?.revision && item.sha256 === reference?.sha256);
      if (!publication || current.systemPrompt !== '') { setTaskState('blocked'); setError('This task references an unavailable profile or incompatible system prompt.'); return; }
      setTask(draft?.task || {body:current.body || '',model:current.model || '',maxTokens:String(current.maxTokens || ''),profileId:id(publication)});
      if (draft && (draft.state !== 'existing' || draft.baseVersion !== current.version)) {
        setTaskVersion(draft.baseVersion); setConflictCurrent(current); setTaskState('blocked');
        setError('The task changed while your draft was open. Compare the current instructions before using the latest version.');
      } else { setTaskVersion(current.version); setTaskState('existing'); }
    }).catch(() => { if (mounted.current && generation === taskGeneration.current) { setTaskState('blocked'); setError('Could not load this task. Try again.'); } });
    return () => { taskGeneration.current++; };
  }, [taskName, taskRetry]);
  const invalidate = () => { editGeneration.current++; setPreview(null); setNotice(''); };
  const updateProfile = (key,value) => { invalidate(); setProfileDraft(current => ({...current,[key]:value})); };
  const updateTask = (key,value) => { invalidate(); const next = {...task,[key]:value}; const prior = taskDrafts.current[taskName]; taskDrafts.current[taskName] = {task:next,baseVersion:prior?.baseVersion ?? taskVersion,state:prior?.state ?? taskState}; setTask(next); };
  const profiles = catalog?.profiles || [];
  const latest = profiles.filter(item => item.profile.key === profileDraft.key).reduce((max,item) => Math.max(max,item.profile.revision),0);
  const roles = names(profileDraft.documentRoles), records = names(profileDraft.recordNames);
  const caps = catalog?.profileLimits || {};
  const profileValid = validName(profileDraft.key) && profileDraft.sharedInstructions.trim() && profileDraft.sharedInstructions.length <= 16000 && !/\{\{/.test(profileDraft.sharedInstructions) && roles.length > 0 && roles.length <= 16 && records.length <= 16 && [...roles,...records].every(validName) && new Set(roles).size === roles.length && new Set(records).size === records.length && Object.entries(profileDraft.limits).every(([key,value]) => Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(caps[key]) && value <= caps[key]) && roles.length <= profileDraft.limits.maxDocuments;
  const selectedProfile = profiles.find(item => id(item) === task.profileId);
  const capability = catalog?.tasks.find(item => item.name === taskName && Object.hasOwn(LABELS,item.name));
  const modelOptions = Object.entries(models?.modelStatuses || {}).filter(([key,value]) => key.startsWith('claude-') && value?.ok === true && value?.capability?.provider === 'anthropic');
  const modelValid = modelOptions.some(([key]) => key === task.model);
  const tokenValue = Number(task.maxTokens);
  const placeholders = [...task.body.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1].trim());
  const placeholdersValid = !/\{\{|\}\}/.test(task.body.replace(/\{\{[^{}]+\}\}/g,'')) && placeholders.every(name => validName(name) && selectedProfile?.profile.recordNames.includes(name) && name !== 'proposal_context');
  const tokenCeiling = Math.min(catalog?.maxOutputTokens || 0, models?.modelStatuses?.[task.model]?.capability?.maxOutputTokens || 0);
  const taskValid = selectedProfile && capability && modelValid && task.body.trim() && placeholdersValid && /^\d+$/.test(task.maxTokens) && Number.isSafeInteger(tokenValue) && tokenValue > 0 && tokenValue <= tokenCeiling && ['new','existing'].includes(taskState);
  function taskPayload() {
    const declarations = [...new Set(placeholders)].map(name => ({name,source:{kind:'frozen_record'},required:false}));
    return {name:taskName,body:task.body,systemPrompt:'',variables:JSON.stringify({execution:{contractVersion:1,mode:'shared-document-task',profile:{key:selectedProfile.profile.key,revision:selectedProfile.profile.revision,sha256:selectedProfile.sha256}},variables:[{name:'proposal_context',source:{kind:'prepared_context'},required:true},...declarations]}),outputSchema:JSON.stringify({parseMode:'raw',outputs:[{name:capability.outputName,target:{kind:'none'},...(capability.maxWords ? {maxWords:capability.maxWords} : {}),...(capability.maxChars ? {maxChars:capability.maxChars} : {})}]}),model:task.model,maxTokens:tokenValue};
  }
  async function publishProfile() {
    if (!profileValid || busy) return;
    const payload = {profile:{key:profileDraft.key,revision:latest+1,wrapperVersion:1,sharedInstructions:profileDraft.sharedInstructions,documentRoles:roles,recordNames:records,limits:profileDraft.limits},expectedVersion:latest};
    const requestId = requestIdentity(profileRequest,payload), generation = editGeneration.current;
    setBusy('profile'); setError(''); setNotice('');
    try {
      const result = await requestEnvelope('/api/admin/prompt-profiles',{method:'PUT',body:{...payload,requestId}});
      if (!mounted.current || generation !== editGeneration.current) return;
      if (!result.ok || !['completed','already_published'].includes(result.data?.status) || !result.data.publication) { setError(safeMessage(result,'Could not publish the profile. Your draft is still here.')); return; }
      const publication = result.data.publication;
      setCatalog(current => ({...current,profiles:[...current.profiles.filter(item => id(item)!==id(publication)),publication]}));
      setHistoryId(id(publication)); setProfileDraft(asDraft(publication.profile)); setNotice(`Published ${publication.profile.key}, revision ${publication.profile.revision}.`);
    } catch { if (mounted.current && generation === editGeneration.current) setError('Could not publish the profile. Retry the same draft.'); }
    finally { if (mounted.current && generation === editGeneration.current) setBusy(''); }
  }
  async function previewTask() {
    if (!taskValid || busy) return;
    const payload = taskPayload(), generation = editGeneration.current;
    setBusy('preview'); setError(''); setPreview(null);
    try {
      const result = await requestEnvelope('/api/admin/prompt-profiles',{method:'POST',body:{task:payload}});
      if (!mounted.current || generation !== editGeneration.current) return;
      if (!result.ok || result.data?.sampleOnly !== true || !result.data?.preview || !['system','documentBlock','taskSuffix','prefixHash'].every(key => typeof result.data.preview[key] === 'string')) { setError('Could not build the sample preview. Review the task and try again.'); return; }
      setPreview({data:result.data.preview,payloadKey:JSON.stringify(payload)});
    } catch { if (mounted.current && generation === editGeneration.current) setError('Could not build the sample preview. Try again.'); }
    finally { if (mounted.current && generation === editGeneration.current) setBusy(''); }
  }
  async function publishTask() {
    if (!taskValid || busy || !preview || preview.payloadKey !== JSON.stringify(taskPayload())) return;
    const payload = taskPayload();
    const body = taskState === 'new' ? {...payload,catalog:{title:`${LABELS[taskName]} (synthetic trial)`,usage:'diagnostic'}} : {...payload,expectedVersion:taskVersion};
    if (taskState !== 'new') delete body.name;
    const requestId = requestIdentity(taskRequest,{name:taskName,body}), generation = editGeneration.current;
    setBusy('task'); setError(''); setNotice('');
    try {
      const result = await requestEnvelope(taskState === 'new' ? '/api/admin/prompts' : `/api/admin/prompts/${encodeURIComponent(taskName)}`,{method:taskState === 'new' ? 'POST' : 'PUT',body:{...body,requestId}});
      if (!mounted.current || generation !== editGeneration.current) return;
      if (!result.ok || !['completed','already_published'].includes(result.data?.status) || !Number.isSafeInteger(result.data?.version ?? result.data?.targetVersion)) { setError(safeMessage(result,'Could not publish the task. Your draft and preview are still here.')); return; }
      const version = result.data.version ?? result.data.targetVersion;
      delete taskDrafts.current[taskName]; setTaskVersion(version); setTaskState('existing'); setPreview(null); setNotice(`Published ${LABELS[taskName]}, version ${version}.`);
    } catch { if (mounted.current && generation === editGeneration.current) setError('Could not publish the task. Retry the same previewed draft.'); }
    finally { if (mounted.current && generation === editGeneration.current) setBusy(''); }
  }
  const setLimit = key => event => updateProfile('limits',{...profileDraft.limits,[key]:event.target.value === '' ? null : Number(event.target.value)});
  return <div className="space-y-6">
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error} {!catalog ? <Button type="button" variant="link" onClick={() => setReload(value => value+1)}>Retry</Button> : <Button type="button" variant="link" disabled={Boolean(busy)} onClick={() => { invalidate(); setReload(value => value+1); }}>Refresh profiles</Button>}</p>}
    {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
    {!catalog ? !error && <p className="text-sm text-gray-600">Loading shared profiles…</p> : <>
      <fieldset disabled={Boolean(busy)} className="space-y-3"><legend className="text-base font-semibold text-gray-900">Shared profile</legend>
        <p className="text-sm text-gray-600">Profiles define shared instructions and permitted inputs. Publishing creates a new immutable revision.</p>
        <label className="block text-sm font-medium text-gray-700">Published revisions<select className={INPUT} value={historyId} onChange={event => { const value=event.target.value; invalidate(); setHistoryId(value); setProfileDraft(value ? asDraft(profiles.find(item => id(item)===value).profile) : emptyProfile()); }}><option value="">New profile</option>{profiles.map(item => <option key={id(item)} value={id(item)}>{item.profile.key} — revision {item.profile.revision}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium text-gray-700">Profile key<input className={INPUT} value={profileDraft.key} onChange={event => updateProfile('key',event.target.value)} /></label><div className="self-end text-sm text-gray-600">Next revision: {latest+1}</div></div>
        <label className="block text-sm font-medium text-gray-700">Shared instructions<textarea className={INPUT} rows={5} value={profileDraft.sharedInstructions} onChange={event => updateProfile('sharedInstructions',event.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium text-gray-700">Document roles <span className="font-normal">(comma-separated)</span><input className={INPUT} value={profileDraft.documentRoles} onChange={event => updateProfile('documentRoles',event.target.value)} /></label><label className="block text-sm font-medium text-gray-700">Record names <span className="font-normal">(comma-separated)</span><input className={INPUT} value={profileDraft.recordNames} onChange={event => updateProfile('recordNames',event.target.value)} /></label></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['maxDocuments','Document count'],['maxDocumentBytes','Bytes per document'],['maxTotalDocumentBytes','Total document bytes'],['maxRecordBytes','Bytes per record']].map(([key,label]) => <label key={key} className="block text-sm font-medium text-gray-700">{label}<input className={INPUT} type="number" min="1" max={caps[key]} value={profileDraft.limits[key] ?? ''} onChange={setLimit(key)} /><span className="mt-1 block text-xs font-normal text-gray-600">Maximum {caps[key]?.toLocaleString() || 'unavailable'}</span></label>)}</div>
        {!profileValid && <p className="text-xs text-gray-600">Enter a lowercase key, shared instructions, at least one unique document role, and limits within the displayed maximums.</p>}
        <Button type="button" size="sm" disabled={!profileValid} onClick={publishProfile} loading={busy==='profile'}>Publish profile revision</Button>
      </fieldset>
      <fieldset disabled={Boolean(busy) || taskState==='loading'} className="space-y-3 border-t border-gray-200 pt-5"><legend className="sr-only">Synthetic task</legend><h4 className="text-base font-semibold text-gray-900">Synthetic task</h4>
        <p className="text-sm text-gray-600">Choose a published profile and preview with fabricated sample data before publishing. No model is called.</p>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium text-gray-700">Task<select className={INPUT} value={taskName} onChange={event => { invalidate(); setTaskName(event.target.value); }}>{catalog.tasks.filter(item => Object.hasOwn(LABELS,item.name)).map(item => <option key={item.name} value={item.name}>{LABELS[item.name]}</option>)}</select></label><label className="block text-sm font-medium text-gray-700">Published profile<select className={INPUT} value={task.profileId} onChange={event => updateTask('profileId',event.target.value)}><option value="">Choose a revision</option>{profiles.map(item => <option key={id(item)} value={id(item)}>{item.profile.key} — revision {item.profile.revision}</option>)}</select></label></div>
        {taskState==='loading' && <p className="text-sm text-gray-600">Loading task…</p>}
        {taskState==='blocked' && !conflictCurrent && <Button type="button" variant="link" onClick={() => setTaskRetry(value => value+1)}>Retry task load</Button>}
        {taskState==='existing' && error && <Button type="button" variant="link" onClick={() => { invalidate(); setTaskRetry(value => value+1); }}>Reload task version</Button>}
        {conflictCurrent && <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3"><details><summary className="cursor-pointer text-sm font-medium text-amber-900">Current version {conflictCurrent.version} instructions</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-800">{conflictCurrent.body}</pre></details><Button type="button" variant="outline" size="sm" onClick={() => { invalidate(); setTaskVersion(conflictCurrent.version); taskDrafts.current[taskName] = {task,baseVersion:conflictCurrent.version,state:'existing'}; setConflictCurrent(null); setTaskState('existing'); setError(''); }}>Use latest version with my draft</Button></div>}
        <p className="text-xs text-gray-600">{taskState==='new' ? 'New task; publishing creates version 1.' : taskState==='existing' ? `Editing version ${taskVersion}; publishing creates a new version.` : taskState==='blocked' ? 'Task editing is unavailable until its current version is resolved.' : ''}</p>
        <label className="block text-sm font-medium text-gray-700">Task instructions<textarea aria-label="Task instructions" className={INPUT} rows={6} value={task.body} onChange={event => updateTask('body',event.target.value)} /><span className="mt-1 block text-xs font-normal text-gray-600">Use {'{{record_name}}'} for a record declared by the selected profile. Missing values remain explicit.</span></label>
        {!placeholdersValid && <p className="text-sm text-red-700">Use only complete placeholders for record names in the selected profile.</p>}
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium text-gray-700">Reviewed Anthropic model<select className={INPUT} value={task.model} onChange={event => updateTask('model',event.target.value)}><option value="">Choose a model</option>{modelOptions.map(([key]) => <option key={key} value={key}>{key}</option>)}</select></label><label className="block text-sm font-medium text-gray-700">Maximum output tokens<input aria-label="Maximum output tokens" className={INPUT} type="number" min="1" max={tokenCeiling || undefined} value={task.maxTokens} onChange={event => updateTask('maxTokens',event.target.value)} /><span className="mt-1 block text-xs font-normal text-gray-600">Synthetic trial limit: {catalog.maxOutputTokens} tokens.</span></label></div>
        <p className="text-sm text-gray-600">Output: {capability?.outputName || '—'}{capability?.maxWords ? `, at most ${capability.maxWords} words` : capability?.maxChars ? `, at most ${capability.maxChars.toLocaleString()} characters` : ''}. The result has no direct write target.</p>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={!taskValid} onClick={previewTask} loading={busy==='preview'}>Preview sample</Button><Button type="button" size="sm" disabled={!taskValid || !preview || preview.payloadKey !== JSON.stringify(taskPayload())} onClick={publishTask} loading={busy==='task'}>Publish task</Button></div>
      </fieldset>
      {preview && <section aria-label="Sample preview" className="space-y-3 border-t border-gray-200 pt-5"><h4 className="text-base font-semibold text-gray-900">Sample preview</h4><p className="text-sm text-gray-600">Fabricated document and record values. Review these instructions before publishing.</p>{[['Shared instructions',preview.data.system],['Protected sample document',preview.data.documentBlock],['Task and output instructions',preview.data.taskSuffix]].map(([label,value]) => <div key={label}><h5 className="text-sm font-medium text-gray-800">{label}</h5><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-xs text-gray-800">{value}</pre></div>)}</section>}
    </>}
  </div>;
}
