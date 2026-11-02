/** @jest-environment node */
import handler from '../../pages/api/cron/refresh-retractions';
import { refreshRetractions } from '../../lib/services/retraction-refresh-service';
jest.mock('../../lib/services/retraction-refresh-service',()=>({refreshRetractions:jest.fn()}));
const old={...process.env};
beforeEach(()=>{process.env.NODE_ENV='production';process.env.CRON_SECRET='fixture-secret';process.env.VERCEL_ENV='production';process.env.RETRACTION_REFRESH_ENABLED='on';refreshRetractions.mockReset().mockResolvedValue({status:'published',published:true});});
afterEach(()=>{process.env= {...old};});
const req=(overrides={})=>({method:'GET',headers:{authorization:'Bearer fixture-secret'},query:{},...overrides});
const res=()=>({status:jest.fn().mockReturnThis(),json:jest.fn().mockReturnThis(),setHeader:jest.fn()});
test.each(['preview','development',undefined])('refuses %s even with valid secret and flag',async(env)=>{if(env)process.env.VERCEL_ENV=env;else delete process.env.VERCEL_ENV;const r=res();await handler(req(),r);expect(r.status).toHaveBeenCalledWith(503);expect(refreshRetractions).not.toHaveBeenCalled();});
test.each(['',undefined,'off','true'])('flag %s cannot activate worker',async(flag)=>{if(flag===undefined)delete process.env.RETRACTION_REFRESH_ENABLED;else process.env.RETRACTION_REFRESH_ENABLED=flag;const r=res();await handler(req(),r);expect(r.status).toHaveBeenCalledWith(503);expect(refreshRetractions).not.toHaveBeenCalled();});
test('development has no bearer bypass',async()=>{process.env.NODE_ENV='development';const r=res();await handler(req({headers:{}}),r);expect(r.status).toHaveBeenCalledWith(401);expect(refreshRetractions).not.toHaveBeenCalled();});
test('only explicit scalar dryRun and no source or connection input reach service',async()=>{const r=res();await handler(req({query:{dryRun:'1',sourceUrl:'https://evil.example',databaseUrl:'postgres://wrong'}}),r);expect(refreshRetractions).toHaveBeenCalledWith({dryRun:true});const bad=res();await handler(req({query:{dryRun:['1']}}),bad);expect(bad.status).toHaveBeenCalledWith(400);});
test('monthly enabled invocation publishes; busy is not success',async()=>{const r=res();await handler(req(),r);expect(refreshRetractions).toHaveBeenCalledWith({dryRun:false});refreshRetractions.mockResolvedValue({status:'busy',published:false});const busy=res();await handler(req(),busy);expect(busy.status).toHaveBeenCalledWith(202);expect(busy.json).toHaveBeenCalledWith(expect.objectContaining({success:false}));});

test('a local development process cannot impersonate production via VERCEL_ENV',async()=>{process.env.NODE_ENV='development';const r=res();await handler(req(),r);expect(r.status).toHaveBeenCalledWith(503);expect(refreshRetractions).not.toHaveBeenCalled();});
