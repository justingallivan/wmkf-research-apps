/** @jest-environment node */
const { publish, headKey } = require('../../lib/prompt-publication/transaction-core');
const { hashSnapshot } = require('../../lib/prompt-publication/fingerprint');
const { POLICY_ARTIFACT } = require('../../lib/prompt-publication/template-policy');
const clone = v => JSON.parse(JSON.stringify(v));
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12,'0');
const actor = {organizationId:id(1),initiatingUserId:id(2),effectiveUserId:id(3)};
const catalog = {title:'Title',description:'Description',groupKey:'reviews',sectionKey:null,usedBy:'Staff',usageCategory:'application'};
const absentCatalog = Object.fromEntries(Object.keys(catalog).map(k=>[k,null]));
function fixture(name='pa.new-prompt', first=false) {
  const c = POLICY_ARTIFACT.policy.consumerContracts[name];
  const definition = c ? {name,systemPrompt:c.systemExact??c.systemIncludes.join('\n'),body:c.body||JSON.parse(c.variablesJson).variables.map(v=>'{{'+v.name+'}}').join('\n'),variables:c.variablesJson,outputSchema:c.outputJson,model:'claude-sonnet-5',temperature:0.3,maxTokens:8000}
    : {name,systemPrompt:'',body:'Summarize {{text}}',variables:'{"variables":[{"name":"text","source":{"kind":"override"}}]}',outputSchema:'{"parseMode":"raw","outputs":[{"name":"text","target":{"kind":"none"}}]}',model:'sonnet',temperature:0.3,maxTokens:8000};
  const snapshot = {definitionFormatVersion:1,definition,catalog:clone(catalog)};
  const current = first ? null : {id:id(8),version:2,etag:'W/"8"'};
  const request = {contractVersion:1,definitionFormatVersion:1,policyRevision:POLICY_ARTIFACT.policy.policyVersion,policyArtifactHash:POLICY_ARTIFACT.hash,requestId:id(4),operation:'publish',promptKey:name,draftId:id(9),draftEtag:'W/"9"',expectedHeadRevision:'0',expectedCurrent:current,metadataBaseline:{schemaVersion:1,current:current?{id:current.id,etag:current.etag}:null,catalog:clone(first?absentCatalog:catalog),headRevision:'0'},snapshotHash:hashSnapshot(snapshot).hash};
  const row = {id:id(9),name,version:null,etag:'W/"9"',status:682090000,isCurrent:false,catalog:clone(catalog)};
  const head = first ? null : {keyHash:headKey(name),key:name,originalKey:name,revision:'0',etag:'W/"1"',highWaterVersion:7,current:{id:current.id,version:current.version}};
  return {request, state:{head,draftBaseline:clone(request.metadataBaseline),rows:[...(current?[{id:current.id,name,version:2,etag:current.etag,status:682090001,isCurrent:true,catalog:clone(catalog)}]:[]),row],snapshot,receipts:{},control:{schemaVersion:1,revision:'0',etag:'W/"1"',policyRevision:1,policyArtifactHash:'a'.repeat(64)},budgets:{schemaVersion:1,currentVersion:0,latestRevision:0,budgets:clone(POLICY_ARTIFACT.policy.budgetRegistry.defaults),warnings:[]}}};
}
function error(code) {return Object.assign(new Error(code),{code});}
/** Models all-or-nothing commit; deliberately not a Dataverse emulator. */
function port(initial) {
  let state=clone(initial), counter=20;
  const events=[], failAt={value:null}, options={unknownAfterCommit:false,unknownBeforeCommit:false};
  const bump = ()=>'W/"'+(++counter)+'"';
  const event = n => {events.push(n);if(failAt.value===n)throw error('publication_conflict');};
  const server = {
    events,failAt,options,read:()=>clone(state),set:fn=>fn(state),
    authorize:jest.fn(async()=>{event('authorize');return actor;}),
    readReceipt:jest.fn(async key=>{event('outer-receipt');return state.receipts[key]||null;}),
    withTransaction:jest.fn(async callback=>{
      const work=clone(state);
      const tx={
        isInTransaction:true,
        readReceipt:async key=>{event('inner-receipt');return work.receipts[key]||null;},
        readBudgetControl:async()=>{event('control');return work.control;},
        fenceBudget:async f=>{event('budget-cas');if(f.expectedEtag!==work.control.etag||f.expectedRevision!==work.control.revision)throw error('publication_conflict');work.control={...work.control,revision:f.nextRevision,etag:bump(),policyRevision:f.policyRevision,policyArtifactHash:f.policyArtifactHash};return work.control;},
        readBudgetState:async()=>{event('budgets');return work.budgets;},
        readHead:async()=>{event('head');return work.head;},
        createHead:async h=>{event('create-head');if(work.head)throw error('publication_conflict');work.head={...h,etag:bump()};return work.head;},
        fenceHead:async f=>{event('head-cas');if(work.head.etag!==f.expectedEtag||work.head.revision!==f.expectedRevision)throw error('publication_conflict');work.head={...work.head,revision:f.nextRevision,etag:bump()};return work.head;},
        readInventory:async()=>{event('inventory');return {complete:true,rows:work.rows};},
        readDraft:async key=>{event('draft');const r=work.rows.find(r=>r.id===key);return {id:r.id,name:r.name,version:r.version,etag:r.etag,status:r.status,isCurrent:r.isCurrent,snapshot:work.snapshot,metadataBaseline:work.draftBaseline};},
        validateCatalogAssignments:async()=>{event('catalog-assignments');return true;},
        now:async()=>'2026-10-30T18:00:00.000Z',
        promoteDraft:async f=>{event('promote');const r=work.rows.find(r=>r.id===f.id);if(r.etag!==f.expectedEtag)throw error('publication_conflict');Object.assign(r,{version:f.version,isCurrent:true,status:682090001,etag:bump()});if(f.clearMetadataBaseline)work.draftBaseline=null;return {id:r.id,version:r.version,etag:r.etag};},
        clearPrevious:async f=>{event('clear');const r=work.rows.find(r=>r.id===f.id);if(r.etag!==f.expectedEtag)throw error('publication_conflict');r.isCurrent=false;r.etag=bump();},
        finishHead:async f=>{event('finish-head');if(work.head.etag!==f.expectedEtag)throw error('publication_conflict');Object.assign(work.head,{revision:f.revision,current:f.current,highWaterVersion:f.highWaterVersion,etag:bump()});},
        createReceipt:async receipt=>{event('receipt-create');if(work.receipts[receipt.request.requestId])throw error('publication_conflict');work.receipts[receipt.request.requestId]=receipt;},
      };
      if(options.transformTx)options.transformTx(tx,work);
      const result=await callback(tx);
      if(options.unknownBeforeCommit)throw error('publication_outcome_unknown');
      state=work;
      if(options.unknownAfterCommit)throw error('publication_outcome_unknown');
      return result;
    }),
  };
  return server;
}

test.each([false,true])('publication commits the exact draft and receipt together, first=%s',async first=>{
  const f=fixture(undefined,first), p=port(f.state), result=await publish(f.request,p), s=p.read();
  expect(result.replayed).toBe(false);expect(result.receipt.published).toMatchObject({id:f.request.draftId,version:first?1:8});
  expect(s.head.current.id).toBe(f.request.draftId);expect(s.head.revision).toBe('1');expect(s.draftBaseline).toBe(null);expect(s.rows.filter(r=>r.isCurrent)).toHaveLength(1);
  expect(s.receipts[f.request.requestId]).toEqual(result.receipt);expect(s.snapshot).toEqual(f.state.snapshot);
});
test('authenticated historical replay precedes policy and live-head validation',async()=>{
  const f=fixture(), p=port(f.state);await publish(f.request,p);
  p.set(s=>{s.head=null;s.rows=[];});p.events.length=0;
  expect((await publish(f.request,p)).replayed).toBe(true);expect(p.events).toEqual(['authorize','outer-receipt']);
  const historical=clone(f.request);historical.policyRevision=1;historical.policyArtifactHash='a'.repeat(64);
  const receipt=clone(p.read().receipts[f.request.requestId]);receipt.request=historical;
  receipt.requestFingerprint=require('../../lib/prompt-publication/fingerprint').publicationFingerprint(historical,actor).hash;
  p.set(s=>{s.receipts[historical.requestId]=receipt;});expect((await publish(historical,p)).replayed).toBe(true);
});
test('replay cannot be reused with another actor or changed request',async()=>{
  const f=fixture(),p=port(f.state);await publish(f.request,p);
  p.authorize.mockResolvedValueOnce({...actor,effectiveUserId:id(5)});
  await expect(publish(f.request,p)).rejects.toMatchObject({code:'publication_request_id_reused'});
  await expect(publish({...f.request,snapshotHash:'a'.repeat(64)},p)).rejects.toMatchObject({code:'publication_request_id_reused'});
});
test.each(['budget-cas','create-head','head-cas','promote','clear','finish-head','receipt-create'])('fault at %s rolls back every modeled mutation',async stage=>{
  const f=fixture(stage==='budget-cas'?'initial-assessment.generate':undefined,stage==='create-head'),p=port(f.state);p.failAt.value=stage;
  await expect(publish(f.request,p)).rejects.toMatchObject({code:'publication_conflict'});expect(p.read()).toEqual(f.state);
});
test('budget CAS precedes head; validation rejection rolls back its revision',async()=>{
  const f=fixture('initial-assessment.generate'),p=port(f.state);await publish(f.request,p);
  expect(p.events.indexOf('budget-cas')).toBeLessThan(p.events.indexOf('head-cas'));
  expect(p.events.indexOf('budget-cas')).toBeLessThan(p.events.indexOf('budgets'));
  const bad=fixture('initial-assessment.generate');bad.state.snapshot.definition.maxTokens=999999;
  const q=port(bad.state);await expect(publish(bad.request,q)).rejects.toMatchObject({code:'invalid_publication_snapshot'});expect(q.read()).toEqual(bad.state);
});
test.each([
  ['incomplete read', (tx)=>{tx.readInventory=async()=>({complete:false,rows:[]});},'incomplete_publication_inventory'],
  ['current Draft', (_,w)=>{w.rows[0].status=682090000;},'invalid_publication_inventory'],
  ['duplicate current', (_,w)=>{w.rows.push({...w.rows[0],id:id(12),version:3});},'publication_conflict'],
  ['duplicate version', (_,w)=>{w.rows.push({...w.rows[0],id:id(12),isCurrent:false});},'duplicate_publication_history'],
  ['case alias', (_,w)=>{w.rows[0].name='PA.New-Prompt';},'invalid_publication_inventory'],
  ['stale catalog',(_,w)=>{w.rows[0].catalog.title='Changed';},'catalog_baseline_conflict'],
  ['history above high-water',(_,w)=>{w.rows.push({...w.rows[0],id:id(12),version:11,isCurrent:false});},'uninitialized_publication_head'],
  ['missing draft baseline',(_,w)=>{w.draftBaseline=null;},'draft_baseline_reconciliation_required'],
  ['changed draft baseline',(_,w)=>{w.draftBaseline.catalog.title='Earlier title';},'draft_baseline_reconciliation_required'],
  ['invalid catalog assignment',tx=>{tx.validateCatalogAssignments=async()=>false;},'invalid_catalog_assignment'],
  ['stale draft',(_,w)=>{w.rows[1].etag='W/"30"';},'publication_conflict'],
  ['no transaction',tx=>{tx.isInTransaction=false;},'publication_transaction_required'],
])('%s fails closed and leaves no partial lifecycle',async(_,transform,code)=>{
  const f=fixture(),p=port(f.state);p.options.transformTx=transform;
  await expect(publish(f.request,p)).rejects.toMatchObject({code});expect(p.read()).toEqual(f.state);
});
test('unknown committed outcome returns original durable receipt; unknown uncommitted outcome retains UUID',async()=>{
  const f=fixture(),p=port(f.state);p.options.unknownAfterCommit=true;
  const result=await publish(f.request,p);expect(result.replayed).toBe(true);expect(result.receipt.request.requestId).toBe(f.request.requestId);expect(p.withTransaction).toHaveBeenCalledTimes(1);
  const q=port(f.state);q.options.unknownBeforeCommit=true;
  await expect(publish(f.request,q)).rejects.toMatchObject({code:'publication_outcome_unknown'});expect(q.read()).toEqual(f.state);expect(q.withTransaction).toHaveBeenCalledTimes(1);
});
test('unknown receipt lookup is not absence or permission to write',async()=>{
  const f=fixture(),p=port(f.state);p.readReceipt.mockRejectedValueOnce(new Error('unavailable'));
  await expect(publish(f.request,p)).rejects.toThrow('unavailable');expect(p.withTransaction).not.toHaveBeenCalled();
});

test('a racing same-UUID winner is recovered after a failed transaction without retrying writes',async()=>{
  const f=fixture(),winner=port(f.state),receipt=(await publish(f.request,winner)).receipt;
  const loser=port(f.state);loser.failAt.value='receipt-create';
  loser.readReceipt.mockResolvedValueOnce(null).mockResolvedValueOnce(receipt);
  expect(await publish(f.request,loser)).toEqual({receipt,replayed:true});
  expect(loser.withTransaction).toHaveBeenCalledTimes(1);expect(loser.read()).toEqual(f.state);
});
test('a winner visible inside transaction is replayed before policy or mutations',async()=>{
  const f=fixture(),winner=port(f.state),receipt=(await publish(f.request,winner)).receipt;
  const p=port(f.state);p.options.transformTx=(_,w)=>{w.receipts[f.request.requestId]=receipt;};
  expect((await publish(f.request,p)).replayed).toBe(true);
  expect(p.events).toEqual(['authorize','outer-receipt','inner-receipt']);
});
test('failed authorization never reads a receipt or opens a transaction',async()=>{
  const f=fixture(),p=port(f.state);p.authorize.mockRejectedValueOnce(error('forbidden'));
  await expect(publish(f.request,p)).rejects.toMatchObject({code:'forbidden'});
  expect(p.readReceipt).not.toHaveBeenCalled();expect(p.withTransaction).not.toHaveBeenCalled();
});
test('mutation of the caller request during authorization cannot switch UUID or draft',async()=>{
  const f=fixture(),p=port(f.state);p.authorize.mockImplementationOnce(async()=>{f.request.requestId=id(20);f.request.draftId=id(21);return actor;});
  const result=await publish(f.request,p);expect(result.receipt.request.requestId).toBe(id(4));expect(result.receipt.published.id).toBe(id(9));
});
test('unknown recovery lookup stays unknown, never returns an edit conflict',async()=>{
  const f=fixture(),p=port(f.state);p.failAt.value='promote';p.readReceipt.mockResolvedValueOnce(null).mockRejectedValueOnce(error('unavailable'));
  await expect(publish(f.request,p)).rejects.toMatchObject({code:'publication_outcome_unknown'});expect(p.withTransaction).toHaveBeenCalledTimes(1);
});
test.each([
  ['collision',s=>{s.head.originalKey='different.key';},'invalid_publication_head'],
  ['exhaustion',s=>{s.head.highWaterVersion=2147483647;},'publication_version_exhausted'],
  ['malformed draft snapshot',s=>{s.snapshot=null;},'publication_conflict'],
])('%s rejects before activation',async(_,mutate,code)=>{
  const f=fixture();mutate(f.state);const p=port(f.state);
  await expect(publish(f.request,p)).rejects.toMatchObject({code});expect(p.read()).toEqual(f.state);expect(p.events).not.toContain('promote');
});
test('first publication above reserved Draft versions uses seeded high-water and preserves history',async()=>{
  const f=fixture(undefined,true);f.state.head={keyHash:headKey(f.request.promptKey),key:f.request.promptKey,originalKey:f.request.promptKey,revision:'0',etag:'W/"1"',highWaterVersion:7,current:null};
  f.state.rows.push({...f.state.rows[0],id:id(13),version:7});
  const p=port(f.state);expect((await publish(f.request,p)).receipt.published.version).toBe(8);expect(p.read().rows.find(r=>r.id===id(13))).toEqual(f.state.rows[1]);
});
test('unseeded historical name cannot silently create a zero high-water head',async()=>{
  const f=fixture(undefined,true);f.state.rows.push({...f.state.rows[0],id:id(13),version:7});
  const p=port(f.state);await expect(publish(f.request,p)).rejects.toMatchObject({code:'uninitialized_publication_head'});expect(p.read()).toEqual(f.state);
});

test('a returned unchanged budget control cannot masquerade as a successful CAS',async()=>{
  const f=fixture('initial-assessment.generate'),p=port(f.state);
  p.options.transformTx=(tx,w)=>{tx.fenceBudget=async()=>w.control;};
  await expect(publish(f.request,p)).rejects.toMatchObject({code:'invalid_budget_fence_result'});expect(p.read()).toEqual(f.state);expect(p.events).not.toContain('head-cas');
});
test('failed first head CAS rolls back the just-created head',async()=>{
  const f=fixture(undefined,true),p=port(f.state);p.failAt.value='head-cas';
  await expect(publish(f.request,p)).rejects.toMatchObject({code:'publication_conflict'});expect(p.read()).toEqual(f.state);expect(p.events).toContain('create-head');
});
