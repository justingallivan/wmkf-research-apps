/** @jest-environment node */
import { checkMachineDestinationMetadata } from '../../lib/services/prompt-jobs/machine-destination-metadata';
import { createClient, getAccessToken } from '../../lib/dataverse/client';
jest.mock('../../lib/dataverse/client',()=>({createClient:jest.fn(),getAccessToken:jest.fn(async()=> 'synthetic-token')}));
const original={...process.env};
const policy={targetHost:'orgd9e66399.crm.dynamics.com',destinationGrant:{field:'wmkf_testtitle',type:'Memo',maxLength:2000}};
let get;
beforeEach(()=>{jest.clearAllMocks();process.env.DYNAMICS_URL='https://orgd9e66399.crm.dynamics.com';process.env.DATAVERSE_TARGET_INTERLOCK='on';get=jest.fn().mockResolvedValueOnce({ok:true,body:{LogicalName:'wmkf_testtitle',AttributeType:'Memo',SourceType:0,AttributeOf:null,IsSecured:false,RequiredLevel:{Value:'None'},IsValidForRead:true,IsValidForUpdate:true}}).mockResolvedValueOnce({ok:true,body:{Format:'Text',MaxLength:2000}});createClient.mockReturnValue({get});});
afterAll(()=>{process.env=original;});
test('only pinned sandbox metadata GETs; no row contents and no cache',async()=>{
 await checkMachineDestinationMetadata(policy);expect(get).toHaveBeenCalledTimes(2);expect(get.mock.calls.every(([path])=>path.startsWith("/EntityDefinitions(LogicalName='akoya_request')/Attributes(LogicalName='wmkf_testtitle')"))).toBe(true);
 expect(getAccessToken).toHaveBeenCalledWith(process.env.DYNAMICS_URL);
});
test('legacy needs no new metadata request',async()=>{await checkMachineDestinationMetadata({});expect(createClient).not.toHaveBeenCalled();});
test('production and ambient target mismatch deny before authentication',async()=>{await expect(checkMachineDestinationMetadata({...policy,targetHost:'wmkf.crm.dynamics.com'})).rejects.toThrow();expect(getAccessToken).not.toHaveBeenCalled();});
test('metadata transport failure cannot authorize delivery',async()=>{get.mockReset().mockResolvedValue({ok:false});await expect(checkMachineDestinationMetadata(policy)).rejects.toThrow('unavailable');});
