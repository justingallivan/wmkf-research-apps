/** Operator-only extra fence. Install before starting the unchanged candidate; never loaded by normal application deployments. */
export function fencedMeetingFetch(original, scope) {
 const request=String(scope.requestId||'').toLowerCase(),visit=String(scope.visitId||'').toLowerCase();
 if(!/^[a-f0-9-]{36}$/.test(request)||!/^[a-f0-9-]{36}$/.test(visit)||!scope.folder||!scope.driveId)throw Error('rehearsal_scope_missing');
 const deny=()=>{throw Object.assign(Error('rehearsal_write_denied'),{code:'rehearsal_write_denied'});};
 const remember=id=>{if(!/^[a-f0-9-]{36}$/i.test(id||''))return;let grant;try{grant=JSON.parse(process.env.DATAVERSE_REHEARSAL_GRANT||'{}');}catch{return;}if(grant.purpose!==scope.purpose)return;grant.recordIds=[...new Set([...(grant.recordIds||[]),id.toLowerCase()])];process.env.DATAVERSE_REHEARSAL_GRANT=JSON.stringify(grant);};
 const observed=async(response,url)=>{if(url.hostname==='wmkf.crm.dynamics.com'&&/\/wmkf_requestdocuments(?:\(|$)/i.test(url.pathname)&&response.ok){const id=response.headers?.get('OData-EntityId')?.match(/\(([a-f0-9-]{36})\)/i)?.[1];if(id)remember(id);try{const j=await response.clone().json();for(const row of j.value||[j])if(row._wmkf_request_value?.toLowerCase()===request)remember(row.wmkf_requestdocumentid);}catch{}}return response;};
 const json=body=>{try{const j=JSON.parse(body);if(!j||Array.isArray(j)||Object.values(j).some(v=>v!==null&&typeof v==='object'))deny();return j;}catch{deny();}};
 const ownPath=p=>p.endsWith('/'+scope.folder)||p.includes('/'+scope.folder+'/');
 async function graphOwn(url,opts){
  const match=url.pathname.match(/^\/v1\.0\/drives\/([^/]+)\/items\/([^/:]+)(?:\/|:|$)/);
  if(!match||decodeURIComponent(match[1])!==scope.driveId)deny();
  const r=await original(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(scope.driveId)}/items/${match[2]}?$select=id,name,parentReference`,{headers:opts.headers});
  if(!r.ok)deny();const j=await r.json();if(!ownPath((j.parentReference?.path||'')+'/'+j.name))deny();
 }
 return async function guarded(input,opts={}){
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=String(opts.method||input?.method||'GET').toUpperCase();
  if(['GET','HEAD','OPTIONS'].includes(method))return observed(await original(input,opts),url);
  if(/sendmail|sendemail|\/emails(?:\(|\/|$)/i.test(url.pathname))deny();
  if(url.hostname==='wmkf.crm.dynamics.com'){
   const p=decodeURIComponent(url.pathname).replace(/\/$/,'');
   if(method==='POST'&&p==='/api/data/v9.2/wmkf_ai_runs'){
    const body=json(opts.body);if(String(body['wmkf_ai_Request@odata.bind']||'').toLowerCase()!==`/akoya_requests(${request})`)deny();
    for(const [key,value]of Object.entries(body).filter(([key])=>key.endsWith('@odata.bind')))if(key!=='wmkf_ai_Request@odata.bind'&&!(key==='wmkf_ai_Prompt@odata.bind'&&/^\/wmkf_ai_prompts\([a-f0-9-]{36}\)$/i.test(value)))deny();
   }else if(method==='POST'&&p==='/api/data/v9.2/wmkf_requestdocuments'){
    const body=json(opts.body);const binds=Object.entries(body).filter(([k])=>k.endsWith('@odata.bind'));
    if(!binds.some(([k,v])=>/^wmkf_request@odata.bind$/i.test(k)&&String(v).toLowerCase()===`/akoya_requests(${request})`))deny();
    for(const [,v]of binds){
     if(String(v).toLowerCase()===`/akoya_requests(${request})`||/^\/systemusers\([a-f0-9-]{36}\)$/i.test(v)||/^\/wmkf_ai_prompts\([a-f0-9-]{36}\)$/i.test(v))continue;
     const child=String(v).match(/^\/(wmkf_requestdocuments|wmkf_ai_runs)\(([a-f0-9-]{36})\)$/i);if(!child)deny();
     const field=child[1].toLowerCase()==='wmkf_ai_runs'?'_wmkf_ai_request_value':'_wmkf_request_value';
     const headers=new Headers(opts.headers);headers.delete('MSCRMCallerID');
     const parent=await original(url.origin+'/api/data/v9.2/'+child[1]+'('+child[2]+')?$select='+field,{headers});
     if(!parent.ok||(await parent.json())[field]?.toLowerCase()!==request)deny();
    }
   }else if(['PATCH','DELETE'].includes(method)&&/^\/api\/data\/v9\.2\/wmkf_requestdocuments\([a-f0-9-]{36}\)$/i.test(p)){
    const ownershipHeaders=new Headers(opts.headers);ownershipHeaders.delete('MSCRMCallerID');
    const r=await original(url.origin+p+'?$select=_wmkf_request_value',{headers:ownershipHeaders});if(!r.ok||(await r.json())._wmkf_request_value?.toLowerCase()!==request)deny();
    if(method==='PATCH'&&Object.keys(json(opts.body)).some(k=>k.endsWith('@odata.bind')))deny();
   }else if(method==='PATCH'&&p.toLowerCase()===`/api/data/v9.2/wmkf_sitevisits(${visit})`){
    const body=json(opts.body);if(Object.keys(body).some(k=>k.endsWith('@odata.bind')||!['wmkf_attendeerefsjson'].includes(k)))deny();
   }else deny();
  }else if(url.hostname==='vercel.com'&&/^\/api\/v[23]\/sandboxes(?:\/|$)/.test(url.pathname)){
   // Standard installed Sandbox SDK endpoint; credentials belong only to the isolated rehearsal project.
  }else if(url.hostname==='graph.microsoft.com'){
   const path=decodeURIComponent(url.pathname);
   if(!path.startsWith('/v1.0/drives/'+scope.driveId+'/'))deny();
   if(path.includes('/root:/')){
    const sub=path.split('/root:/')[1].replace(/:(?:\/.*)?$/,'');if(!ownPath('/'+sub))deny();
   }else await graphOwn(url,opts);
   if(method==='POST'){
    const body=json(opts.body);const name=body.name||body.item?.name;
    if(name&&(/[/\\]/.test(name)||['.','..'].includes(name)))deny();
    if(!path.endsWith('/children')&&!path.endsWith('/createUploadSession'))deny();
   }else if(method==='PUT'){if(!path.endsWith('/content')&&!path.endsWith(':/content'))deny();}else if(method!=='DELETE')deny();
  }else if(url.hostname==='ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech'||url.hostname==='ep-aged-dew-b7gtigyy.c-13.us-east-1.aws.neon.tech'||url.hostname==='api.c-13.us-east-1.aws.neon.tech'){
   const headers=new Headers(opts.headers);let db,host;try{const parsed=new URL(headers.get('Neon-Connection-String')||'');db=parsed.pathname;host=parsed.hostname;}catch{deny();}
   if(method!=='POST'||url.pathname!=='/sql'||db!=='/meeting_coord_rehearsal_20261023'||!['ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech','ep-aged-dew-b7gtigyy.c-13.us-east-1.aws.neon.tech'].includes(host))deny();
  }else{
   const hosts=['login.microsoftonline.com','api.anthropic.com','api.openai.com','generativelanguage.googleapis.com','api.assemblyai.com','api.eu.assemblyai.com','api.vercel.com','blob.vercel-storage.com'];
   if(!hosts.includes(url.hostname)&&!url.hostname.endsWith('.blob.vercel-storage.com'))deny();
  }
  return observed(await original(input,opts),url);
 };
}
