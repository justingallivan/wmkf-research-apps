/** @jest-environment node */
const {createClient}=require('../../lib/dataverse/client.js');
const HOST='https://orgd9e66399.crm.dynamics.com';
const body={wmkf_name:'Synthetic\r\nPATCH /contacts HTTP/1.1',wmkf_creationkey:'app_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',statecode:1,statuscode:2,wmkf_role:''};
const response=(statuses)=>statuses.map((s,i)=>`--change\r\nContent-Type: application/http\r\nContent-ID: ${i+1}\r\n\r\nHTTP/1.1 ${s} Result\r\n\r\n`).join('')+'--change--\r\n';
let oldFetch, oldRandomUUID;
beforeEach(()=>{oldRandomUUID=global.crypto.randomUUID;global.crypto.randomUUID=require("node:crypto").randomUUID;oldFetch=global.fetch;global.fetch=jest.fn().mockResolvedValue({ok:true,status:200,text:async()=>response([204,204])});});
afterEach(()=>{global.fetch=oldFetch;global.crypto.randomUUID=oldRandomUUID;});
test('sends create and deactivation in one changeset with only Content-ID reference',async()=>{
 const client=createClient({resourceUrl:HOST,token:'synthetic'});
 await client.createInactiveExpertiseProfile(body,{timeoutMs:30000});
 expect(fetch).toHaveBeenCalledTimes(1);const [url,options]=fetch.mock.calls[0];
 expect(url).toBe(HOST+'/api/data/v9.2/$batch');expect(options.signal).toBeDefined();
 expect(options.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=batch_/);
 const wire=options.body;expect(wire).toContain(`POST ${HOST}/api/data/v9.2/wmkf_expertiseprofiles HTTP/1.1\r\n`);
 expect(wire).toContain('PATCH $1 HTTP/1.1\r\n');expect(wire.match(/^PATCH /gm)).toHaveLength(1);
 expect(wire).toContain(JSON.stringify({...body,statecode:0,statuscode:1}));
 expect(wire).toContain(JSON.stringify({statecode:1,statuscode:2}));
 expect(wire).not.toContain('\nPATCH /contacts');expect(body.statecode).toBe(1);
 const changes=wire.match(/boundary=(changeset_[^\r]+)/g);expect(changes).toHaveLength(1);
 const batch=options.headers['Content-Type'].split('boundary=')[1];
 const change=changes[0].slice('boundary='.length);
 expect(wire).toBe([
  `--${batch}`,`Content-Type: multipart/mixed; boundary=${change}`,'',
  `--${change}`,'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 1','',
  `POST ${HOST}/api/data/v9.2/wmkf_expertiseprofiles HTTP/1.1`,'Content-Type: application/json','',
  JSON.stringify({...body,statecode:0,statuscode:1}),
  `--${change}`,'Content-Type: application/http','Content-Transfer-Encoding: binary','Content-ID: 2','',
  'PATCH $1 HTTP/1.1','Content-Type: application/json','',JSON.stringify({statecode:1,statuscode:2}),
  `--${change}--`,`--${batch}--`,'',
 ].join('\r\n'));

});
test.each([[204],[204,400],[],[204,204,204]].map(statuses=>({statuses})))('refuses unconfirmed embedded response $statuses',async({statuses})=>{
 fetch.mockResolvedValue({ok:true,status:200,text:async()=>response(statuses)});
 await expect(createClient({resourceUrl:HOST,token:'synthetic'}).createInactiveExpertiseProfile(body)).rejects.toThrow(/unconfirmed/);
});
test('refuses outer failure even if embedded results look successful',async()=>{
 fetch.mockResolvedValue({ok:false,status:500,text:async()=>response([204,204])});
 await expect(createClient({resourceUrl:HOST,token:'synthetic'}).createInactiveExpertiseProfile(body)).rejects.toThrow(/unconfirmed/);
});
test.each(['https://wmkf.crm.dynamics.com','https://example.invalid'])('refuses non-sandbox %s before I/O',async resourceUrl=>{
 await expect(createClient({resourceUrl,token:'synthetic'}).createInactiveExpertiseProfile(body)).rejects.toThrow(/sandbox/);expect(fetch).not.toHaveBeenCalled();
});
test.each([{statecode:0,statuscode:1},{statecode:1,statuscode:1},{statecode:2,statuscode:2}])('refuses incorrect state %j before I/O',async state=>{
 await expect(createClient({resourceUrl:HOST,token:'synthetic'}).createInactiveExpertiseProfile({...body,...state})).rejects.toThrow(/state/);expect(fetch).not.toHaveBeenCalled();
});
test('raw cannot bypass JSON serialization using a sixth argument',async()=>{
 await createClient({resourceUrl:HOST,token:'synthetic'}).raw('POST','/wmkf_expertiseprofiles',{wmkf_name:'Safe'}, {},{},'unexpected wire body');
 expect(fetch.mock.calls[0][1].body).toBe('{"wmkf_name":"Safe"}');
});
test('marker fields remain refused before batch I/O',async()=>{
 await expect(createClient({resourceUrl:HOST,token:'synthetic'}).createInactiveExpertiseProfile({...body,wmkf_istestrequest:true})).rejects.toThrow(/marker/);expect(fetch).not.toHaveBeenCalled();
});
test('transport failure propagates for executor keyed recovery',async()=>{
 fetch.mockRejectedValue(new Error('lost response'));
 await expect(createClient({resourceUrl:HOST,token:'synthetic'}).createInactiveExpertiseProfile(body)).rejects.toThrow('lost response');
});
