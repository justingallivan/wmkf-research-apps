/** @jest-environment node */
jest.mock('../../lib/services/dataverse-settings-service',()=>({getSettingStrict:jest.fn(async key=>({found:true,value:key,revision:'W/"1"'}))}));
const backend=require('../../lib/services/dataverse-settings-service');
const settings=require('../../lib/services/settings-service');
afterEach(()=>{delete global.window;});
test('server dispatch preserves metadata and passes the key to the traced backend',async()=>{
 await expect(settings.getSettingStrict('board_writeups.program_coordinator')).resolves.toEqual({found:true,value:'board_writeups.program_coordinator',revision:'W/"1"'});
 expect(backend.getSettingStrict).toHaveBeenCalledWith('board_writeups.program_coordinator');
});
test('browser dispatch is refused even when a prior server call warmed the backend',async()=>{
 await settings.getSettingStrict('warm');backend.getSettingStrict.mockClear();global.window={};
 await expect(settings.getSettingStrict('private')).rejects.toThrow('only available on the server');
 expect(backend.getSettingStrict).not.toHaveBeenCalled();
});
