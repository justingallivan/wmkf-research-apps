/** @jest-environment node */
jest.mock('../../lib/services/cycle-dossier-store', () => ({
  dossierError: (message,httpStatus=409)=>Object.assign(new Error(message),{httpStatus}),
  claimDossierRun:jest.fn(), mutateDossierRun:jest.fn(), readDossierRun:jest.fn(), assertDossierActor:jest.fn(),
  getDossierEntry:jest.fn(), finishDossierEntry:jest.fn(), reserveDossierEdition:jest.fn(), publishDossierEdition:jest.fn(),
  releaseDossierRun:jest.fn(), stopRevokedDossierRun:jest.fn(),
  readDossierControl:jest.fn(),
}));
jest.mock('../../lib/services/cycle-dossier-service', () => ({
  dossierPool: async(items,fn)=>Promise.all(items.map(fn)), loadDossierRoster:jest.fn(),
}));
jest.mock('../../lib/services/cycle-dossier-generation', () => ({generateResearch:jest.fn(),generateEntry:jest.fn()}));
jest.mock('../../lib/services/cycle-dossier-documents', () => ({renderDossierDocuments:jest.fn()}));
jest.mock('../../lib/services/cycle-dossier-storage', () => ({
  dossierDigest: value=>JSON.stringify(value), readDossierJSON:jest.fn(), storeDossierJSON:jest.fn(),
  storeDossierFile:jest.fn(),readDossierFile:jest.fn(),assertDossierStorageConfigured:jest.fn(),
}));
jest.mock('../../lib/services/cycle-dossier-sharepoint',()=>({resolveDossierDestination:jest.fn()}));
jest.mock('../../lib/services/graph-service',()=>({GraphService:{ensureFolderPath:jest.fn(),uploadFile:jest.fn(),getFileMetadataByPath:jest.fn(),downloadFile:jest.fn()}}));
import * as store from '../../lib/services/cycle-dossier-store';
import {loadDossierRoster} from '../../lib/services/cycle-dossier-service';
import {generateResearch,generateEntry} from '../../lib/services/cycle-dossier-generation';
import {renderDossierDocuments} from '../../lib/services/cycle-dossier-documents';
import * as storage from '../../lib/services/cycle-dossier-storage';
import {drainCycleDossiers} from '../../lib/services/cycle-dossier-worker';

let run; const clone=x=>JSON.parse(JSON.stringify(x));
const queued=(id='a')=>({requestId:id,requestNumber:id,revisionId:`rev-${id}`,status:'queued',inputRef:{pathname:'input'},estimate:{highUsd:2},programDirector:'Justin'});
beforeEach(()=>{
  jest.clearAllMocks();
  process.env.CYCLE_DOSSIER_ENABLED = 'true';
  delete process.env.CYCLE_DOSSIER_OPERATOR_STOP;
  run={id:'run',dossier_id:'dossier',owner_profile_id:7,status:'running',lease_token:'token',locked_until:new Date(Date.now()+270000).toISOString(),
    data:{items:[queued()],budgetUsd:null,spentUsd:0,reservedUsd:0,cutCounter:0,cutPending:false,config:{}}};
  store.claimDossierRun.mockImplementation(async()=>clone(run));
  store.mutateDossierRun.mockImplementation(async(id,fn)=>{const next=clone(run);await fn(next,{});run=next;return clone(run);});
  store.readDossierRun.mockImplementation(async()=>clone(run));
  store.assertDossierActor.mockResolvedValue({profileId:7,actingUserSystemId:null});
  store.readDossierControl.mockResolvedValue({ stop_requested: false });
  loadDossierRoster.mockImplementation(async()=>run.data.items.map(i=>({requestId:i.requestId})));
  storage.readDossierJSON.mockResolvedValue({narrative:{text:'proposal'},entry:{references:[]}});
  storage.storeDossierJSON.mockImplementation(async(path)=>({pathname:path}));
  generateResearch.mockImplementation(async(input,config,options)=>{await options.beforePaidCall({stage:'research-plan'});return {research:{evidence:['paper']},costUsd:0.25};});
  generateEntry.mockImplementation(async(input,research,config,options)=>{await options.beforePaidCall({stage:'entry'});return {payload:{entry:{references:[]}},costUsd:0.5};});
  store.getDossierEntry.mockImplementation(async id=>({id,revision:1,ready:true,data:{payloadRef:{pathname:'payload'}}}));
  store.reserveDossierEdition.mockImplementation(async(current,key,data)=>({id:`edition-${key}`,dossier_id:'dossier',owner_profile_id:7,ready:false,data}));
  renderDossierDocuments.mockResolvedValue({combined:{docx:Buffer.from('word'),pdf:Buffer.from('%PDF-')}});
  storage.storeDossierFile.mockImplementation(async path=>({pathname:path}));
});
afterEach(() => {
  delete process.env.CYCLE_DOSSIER_ENABLED;
  delete process.env.CYCLE_DOSSIER_OPERATOR_STOP;
});
test('one research stage checkpoints and leaves entry generation for a later invocation',async()=>{
  await drainCycleDossiers();
  expect(generateResearch).toHaveBeenCalledTimes(1);expect(generateEntry).not.toHaveBeenCalled();
  expect(run.data.items[0]).toMatchObject({status:'queued',stage:'research',paidInFlight:false});
  expect(run.data.items[0].researchRef.pathname).toContain('/research-');
  expect(run.data.spentUsd).toBe(0.25);expect(run.data.reservedUsd).toBe(1.75);
});
test('saved research is reused for a later entry stage',async()=>{
  run.data.items[0].researchRef={pathname:'saved-research'};
  await drainCycleDossiers();
  expect(generateResearch).not.toHaveBeenCalled();expect(generateEntry).toHaveBeenCalledTimes(1);
  expect(run.data.items[0]).toMatchObject({status:'queued',stage:'entry'});
});
test('three concurrent jobs share one budget; only the affordable first call starts',async()=>{
  run.data.items=[queued('a'),queued('b'),queued('c')];run.data.budgetUsd=2;
  // Serialize fixture mutations just as the production row lock serializes transactions.
  let tail=Promise.resolve();
  store.mutateDossierRun.mockImplementation((id,fn)=>{
    const task=tail.then(async()=>{const next=clone(run);await fn(next,{});run=next;return clone(run);});
    tail=task.catch(()=>{});return task;
  });
  let paid=0;
  generateResearch.mockImplementation(async(input,config,options)=>{await options.beforePaidCall({stage:'research-plan'});paid++;return {research:{evidence:['p']},costUsd:0.2};});
  await drainCycleDossiers();
  expect(paid).toBe(1);expect(run.status).toBe('paused');
  expect(run.data.reservedUsd+run.data.spentUsd).toBeLessThanOrEqual(2);
});
test('ambiguous provider failure is terminal for that attempt and preserves its reservation',async()=>{
  generateResearch.mockImplementation(async(input,config,options)=>{await options.beforePaidCall({stage:'research-plan'});throw new Error('connection lost');});
  await drainCycleDossiers();
  expect(run.data.items[0]).toMatchObject({status:'failed',paidInFlight:true,reservationUsd:2});
  expect(run.data.reservedUsd).toBe(2);expect(run.status).toBe('failed');
  expect(store.publishDossierEdition).not.toHaveBeenCalled();
});
test('operator stop after claim prevents the next paid stage and leaves the item queued', async()=>{
  store.readDossierControl.mockReset()
    .mockResolvedValueOnce({ stop_requested: false })
    .mockResolvedValueOnce({ stop_requested: true });
  generateResearch.mockImplementation(async(input,config,options)=>{
    await options.beforePaidCall({stage:'research-plan'});
    return {research:{evidence:['should-not-save']},costUsd:0.2};
  });
  await drainCycleDossiers();
  expect(generateResearch).toHaveBeenCalledTimes(1);
  expect(storage.storeDossierJSON).not.toHaveBeenCalled();
  expect(run.data.items[0].status).toBe('queued');
  expect(run.data.items[0].stage).toBeUndefined();
});
test('operator stop before assembly prevents rendering and private artifact writes', async()=>{
  run.data.items=[{...queued('a'),status:'ready',reuseId:'existing'}];
  run.data.cutPending=true;
  store.readDossierControl.mockResolvedValue({ stop_requested: true });
  await drainCycleDossiers();
  expect(renderDossierDocuments).not.toHaveBeenCalled();
  expect(storage.storeDossierFile).not.toHaveBeenCalled();
  expect(store.publishDossierEdition).not.toHaveBeenCalled();
});
test('partial edition pins a successful foreign-superuser entry and an older failed-rewrite fallback',async()=>{
  run.data.items=[{...queued('a'),status:'ready',reuseId:'other-superuser-entry'}, {...queued('b'),status:'failed',fallbackId:'old-b',error:'Generation failed'}, {...queued('c'),status:'failed',error:'Missing narrative'}];
  await drainCycleDossiers();
  expect(generateResearch).not.toHaveBeenCalled();expect(generateEntry).not.toHaveBeenCalled();
  const data=store.publishDossierEdition.mock.calls[0][1];
  expect(data.entries.map(e=>e.id)).toEqual(['other-superuser-entry','old-b']);
  expect(data.fallback[0].requestId).toBe('b');expect(data.missing[0].requestId).toBe('c');expect(run.status).toBe('partial');
});
test('cancelled run publishes useful partial coverage and retains Cancelled status',async()=>{
  run.status='cancelled';run.data.cutPending=true;run.data.cutCounter=1;
  run.data.items=[{...queued('a'),status:'ready',reuseId:'existing'},queued('b')];
  await drainCycleDossiers();
  expect(store.publishDossierEdition).toHaveBeenCalled();expect(run.status).toBe('cancelled');expect(run.data.cutPending).toBe(false);
  expect(generateResearch).not.toHaveBeenCalled();
});
test('assembly retry reuses its exact manifest without LLM work or revision refresh',async()=>{
  run.data.items=[{...queued(),status:'ready',reuseId:'old'}];
  run.data.cut={id:'frozen-cut',ready:false,data:{entries:[{id:'old',revision:1,request:{requestId:'a',requestNumber:'a'},payloadRef:{pathname:'frozen'}}],missing:[],fallback:[],status:'complete'}};
  await drainCycleDossiers();
  expect(store.getDossierEntry).not.toHaveBeenCalled();expect(storage.readDossierJSON).toHaveBeenCalledWith({pathname:'frozen'});
  expect(store.publishDossierEdition.mock.calls[0][0].id).toBe('frozen-cut');expect(run.status).toBe('completed');
});
test('already-published cut replay settles run state without publishing it again',async()=>{
  run.data.items=[{...queued(),status:'ready',reuseId:'old'}];
  run.data.cut={id:'ready-cut',ready:true,data:{entries:[{id:'old'}],status:'complete'}};
  await drainCycleDossiers();
  expect(store.publishDossierEdition).not.toHaveBeenCalled();expect(run.status).toBe('completed');
});
test('revoked owner stops even when a real queued request exists',async()=>{
  store.assertDossierActor.mockRejectedValue(Object.assign(new Error('revoked'),{httpStatus:403}));
  await drainCycleDossiers();
  expect(generateResearch).not.toHaveBeenCalled();expect(store.stopRevokedDossierRun).toHaveBeenCalledWith('run','token');
});

const publishFixture=()=>{
  const {resolveDossierDestination}=require('../../lib/services/cycle-dossier-sharepoint');
  const {GraphService}=require('../../lib/services/graph-service');
  // Postgres JSONB returns object keys sorted by length then bytewise, so the
  // persisted destination never stringifies the way the live resolver's does.
  const live={library:'akoya_request',folder:'1001_GUID',siteId:'site',driveId:'drive',requestFolderId:'f'};
  const persisted={driveId:'drive',folder:'1001_GUID',siteId:'site',library:'akoya_request',requestFolderId:'f'};
  resolveDossierDestination.mockResolvedValue(live);
  const bytes=Buffer.from('word');
  storage.readDossierFile.mockResolvedValue(bytes);
  GraphService.ensureFolderPath.mockResolvedValue({siteId:'site',driveId:'drive'});
  GraphService.uploadFile.mockResolvedValue({id:'file',driveId:'drive'});
  GraphService.downloadFile.mockResolvedValue({buffer:bytes});
  const ref={pathname:'p',sha256:storage.dossierDigest(bytes),size:4};
  Object.assign(run.data.items[0],{stage:'rendered',revision:1,researchRef:{pathname:'research'},payloadRef:{pathname:'payload'},files:{docx:ref,pdf:ref},
    destination:persisted,destinationHash:storage.dossierDigest(live)});
  return {GraphService};
};
test('publish accepts a JSONB-reordered destination through its stored hash',async()=>{
  const {GraphService}=publishFixture();
  await drainCycleDossiers();
  expect(GraphService.uploadFile).toHaveBeenCalled();
  expect(run.data.items[0].sharepoint.docx).toBeTruthy();
});
test('publish refuses an item persisted without a destination hash before any SharePoint write',async()=>{
  const {GraphService}=publishFixture();
  delete run.data.items[0].destinationHash;
  await drainCycleDossiers();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  expect(run.data.items[0]).toMatchObject({status:'failed'});
  expect(run.data.items[0].error).toMatch(/destination changed/i);
});
