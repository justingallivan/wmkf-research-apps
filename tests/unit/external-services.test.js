/** @jest-environment node */
import { validateService, validateReview, serviceStatus, COST_MODES, reviewToday, nextReviewDate, defaultCadence } from '../../lib/services/external-services/model';
import seed from '../../lib/services/external-services/seed.json';
import handler from '../../pages/api/admin/external-services';
import { requireSuperuser } from '../../lib/utils/auth';
import { listServices, listReviews, saveService } from '../../lib/services/external-services/store';
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn() }));
jest.mock('../../lib/services/external-services/store', () => ({ listServices: jest.fn(), listReviews: jest.fn(), saveService: jest.fn() }));
const assembly = seed.services.find(s => s.id === 'assemblyai');
const response = () => { const res = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); return res; };
beforeEach(() => { jest.clearAllMocks(); requireSuperuser.mockResolvedValue({ profileId: 42 }); });
test('all inventory records and completed AssemblyAI review satisfy the write contract', () => {
  for (const row of seed.services) expect(validateService(row.data, row.id)).toEqual(row.data);
  expect(validateReview(seed.assemblyAIReview)).toEqual(seed.assemblyAIReview);
  expect(seed.assemblyAIReview.status).toBe('Implemented');
});
test('corporate cost exclusions cannot be removed', () => {
  for (const id of ['microsoft','github','zoom']) {
    const item=seed.services.find(s=>s.id===id);
    expect(item.data.costTracking).toBe(COST_MODES[1]);
    expect(()=>validateService({...item.data,costTracking:COST_MODES[0]},id)).toThrow('corporate-managed');
  }
});
test.each(['javascript:alert(1)','http://example.com','https://user:password@example.com'])('rejects unsafe reference %s', href => {
  expect(()=>validateService({...assembly.data,links:[{label:'Unsafe',href}]},assembly.id)).toThrow('HTTPS');
});
test('rejects invalid dates and enumerations; strips unknown identity fields', () => {
  expect(()=>validateService({...assembly.data,nextReviewOn:'2026-02-30'},assembly.id)).toThrow('date');
  expect(()=>validateReview({...seed.assemblyAIReview,status:'done'})).toThrow('status');
  expect(validateReview({...seed.assemblyAIReview,created_by:999})).not.toHaveProperty('created_by');
});
test('status covers unreviewed, due, action-needed and current independently of cost exclusion', () => {
  expect(serviceStatus({...assembly,lastReviewedOn:null},'2026-11-20')).toBe('Review due');
  expect(serviceStatus({...assembly,lastReviewedOn:'2026-11-20'},'2026-12-20')).toBe('Review due');
  expect(serviceStatus({...assembly,lastReviewedOn:'2026-11-20'},'2026-11-20')).toBe('Current');
  expect(serviceStatus({...assembly,data:{...assembly.data,actionNeeded:true}},'2026-11-20')).toBe('Action needed');
});
test.each(['GET','PUT'])('denied %s never reaches storage',async method=>{
  requireSuperuser.mockResolvedValue(null);await handler({method,query:{},body:{}},response());
  expect(listServices).not.toHaveBeenCalled();expect(saveService).not.toHaveBeenCalled();expect(listReviews).not.toHaveBeenCalled();
});
test('writes attribute to authenticated actor and disable caching',async()=>{
  const res=response();saveService.mockResolvedValue({ok:true});
  await handler({method:'PUT',body:{id:'assemblyai',profileId:999}},res);
  expect(saveService).toHaveBeenCalledWith({id:'assemblyai',profileId:999},42);
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control','private, no-store');
});
test('stale edits return conflict and unexpected errors do not expose details',async()=>{
  const res=response();saveService.mockRejectedValue(Object.assign(new Error('Reload'),{status:409}));
  await handler({method:'PUT',body:{}},res);expect(res.status).toHaveBeenCalledWith(409);
  const spy=jest.spyOn(console,'error').mockImplementation(()=>{});listServices.mockRejectedValue(new Error('secret connection URL'));
  await handler({method:'GET',query:{}},res);expect(res.status).toHaveBeenCalledWith(503);expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret connection');spy.mockRestore();
});
test('unsupported methods advertise the supported methods without storage access',async()=>{
  const res=response();await handler({method:'DELETE',query:{}},res);
  expect(res.status).toHaveBeenCalledWith(405);expect(res.setHeader).toHaveBeenCalledWith('Allow','GET, PUT');
  expect(listServices).not.toHaveBeenCalled();expect(saveService).not.toHaveBeenCalled();
});

test('Pacific calendar date is consistent through UTC midnight and DST',()=>{
  expect(reviewToday(new Date('2026-11-21T02:30:00Z'))).toBe('2026-11-20');
  expect(reviewToday(new Date('2026-07-21T02:30:00Z'))).toBe('2026-07-20');
  expect(reviewToday(new Date('2026-11-21T08:00:00Z'))).toBe('2026-11-21');
  expect(nextReviewDate('2026-03-07',30)).toBe('2026-04-06');
  expect(nextReviewDate('2026-10-31',30)).toBe('2026-11-30');
  expect(nextReviewDate('2028-02-28',1)).toBe('2028-02-29');
});
test('future-date validation and due status use the Foundation calendar',()=>{
  jest.useFakeTimers().setSystemTime(new Date('2026-11-21T02:30:00Z'));
  try {
    expect(()=>validateReview({...seed.assemblyAIReview,reviewedOn:'2026-11-21'})).toThrow('future');
    expect(validateReview({...seed.assemblyAIReview,reviewedOn:'2026-11-20'}).reviewedOn).toBe('2026-11-20');
    expect(serviceStatus({...assembly,lastReviewedOn:'2026-11-19',data:{...assembly.data,nextReviewOn:'2026-11-21'}})).toBe('Current');
  } finally { jest.useRealTimers(); }
});
test('cadence defaults and corporate exclusions also cover newly added provider records',()=>{
  expect(defaultCadence('AI')).toBe(30);expect(defaultCadence('Hosting & storage')).toBe(90);
  expect(()=>validateService({...assembly.data,provider:' Microsoft '},'new-corporate-id')).toThrow('corporate-managed');
});
