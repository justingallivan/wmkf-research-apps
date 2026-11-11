/** @jest-environment node */
const fs=require('fs'),os=require('os'),path=require('path');
jest.mock('pg',()=>({Client:jest.fn()}));
const {Client}=require('pg'),{main}=require('../../scripts/prepare-roster-full-import-rehearsal.cjs');
let dir,args,pg,source;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'roster-full-'));const url='postgres://roster_rehearsal:synthetic@127.0.0.1:55439/roster_rehearsal';const env={EXPERTISE_ROSTER_REHEARSAL:'on',DYNAMICS_URL:'https://orgd9e66399.crm.dynamics.com',DYNAMICS_SANDBOX_URL:'https://orgd9e66399.crm.dynamics.com',DATAVERSE_TARGET_INTERLOCK:'on',DATAVERSE_DAL_ENFORCEMENT:'on',POSTGRES_URL:url,DATABASE_URL:url,POSTGRES_URL_NON_POOLING:url,POSTGRES_PRISMA_URL:url};fs.writeFileSync(dir+'/env',Object.entries(env).map(([k,v])=>k+'='+v).join('\n'));source=structuredClone(require('../fixtures/expertise-roster/source.json'));Object.assign(source,{sequenceHighWater:39});Object.assign(source.rows[0],{created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z',created_by:2,updated_by:2});fs.writeFileSync(dir+'/source',JSON.stringify(source));fs.writeFileSync(dir+'/evidence',JSON.stringify({feedback:[{id:'7',consultant_roster_id:1}]}));args=[dir+'/env',dir+'/source',dir+'/evidence',dir+'/receipt'];pg={connect:jest.fn(),end:jest.fn(),query:jest.fn(async sql=>sql.includes('current_database')?{rows:[{database:'roster_rehearsal',username:'roster_rehearsal'}]}:sql==='SELECT * FROM expertise_roster ORDER BY id'?{rows:structuredClone(source.rows)}:{rows:[],rowCount:0})};Client.mockClear();Client.mockImplementation(()=>pg);});
afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('fresh fixture preserves IDs, source/audit data and sequence while feedback body is synthetic',async()=>{
 const before=fs.readFileSync(args[1],'utf8');await main(args);
 expect(pg.query).toHaveBeenCalledWith('INSERT INTO user_profiles(id) VALUES($1)',[2]);
 const insert=pg.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO expertise_roster('));expect(insert[1][0]).toBe(1);expect(insert[1]).toContain(2);
 expect(pg.query).toHaveBeenCalledWith("SELECT setval('expertise_roster_id_seq',$1,true)",[39]);
 expect(pg.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO consultant_feedback'))[1]).toEqual(['7',expect.any(String),1,expect.any(String)]);
 expect(insert[1].filter(v=>v instanceof Date)).toHaveLength(2);
 expect(pg.query).toHaveBeenCalledWith("SELECT setval('consultant_feedback_id_seq',$1,true)",['7']);
 expect(pg.query).toHaveBeenLastCalledWith('COMMIT');expect(fs.readFileSync(args[1],'utf8')).toBe(before);
 expect(JSON.parse(fs.readFileSync(args[3]))).toMatchObject({success:true,rosterRows:1,feedbackRows:1,feedbackContentSynthetic:true});
});
test('populated database refuses before BEGIN or DDL',async()=>{
 const base=pg.query.getMockImplementation();pg.query.mockImplementation(sql=>sql.includes('information_schema.tables')?{rowCount:1,rows:[{}]}:base(sql));
 await expect(main(args)).rejects.toThrow('Database is not empty');expect(pg.query.mock.calls.some(([sql])=>sql==='BEGIN'||sql.startsWith('CREATE'))).toBe(false);
});
test('wrong connected identity refuses before checking tables',async()=>{pg.query.mockResolvedValue({rows:[{database:'wrong',username:'roster_rehearsal'}]});await expect(main(args)).rejects.toThrow('identity mismatch');expect(pg.query).toHaveBeenCalledTimes(1);});
test('nonlocal env refuses before constructing client',async()=>{fs.appendFileSync(args[0],'\nPOSTGRES_URL=postgres://remote.invalid/db');await expect(main(args)).rejects.toThrow();expect(Client).not.toHaveBeenCalled();});
test.each(['missing','duplicate','highwater','unknown'])('invalid source %s fails before I/O',async kind=>{
 if(kind==='missing')delete source.rows[0].role;if(kind==='duplicate')source.rows.push(source.rows[0]);if(kind==='highwater')source.sequenceHighWater=0;if(kind==='unknown')source.rows[0].surprise='x';fs.writeFileSync(args[1],JSON.stringify(source));await expect(main(args)).rejects.toThrow();expect(Client).not.toHaveBeenCalled();
});
test('existing receipt cannot be overwritten',async()=>{fs.writeFileSync(args[3],'keep');await expect(main(args)).rejects.toThrow();expect(fs.readFileSync(args[3],'utf8')).toBe('keep');expect(Client).not.toHaveBeenCalled();});
test('lost COMMIT leaves unknown receipt and attempts rollback',async()=>{const base=pg.query.getMockImplementation();pg.query.mockImplementation(sql=>sql==='COMMIT'?Promise.reject(Error('lost COMMIT')):base(sql));await expect(main(args)).rejects.toThrow('lost COMMIT');expect(JSON.parse(fs.readFileSync(args[3]))).toMatchObject({success:false,commitUnknown:true,rollbackSucceeded:true});expect(pg.query).toHaveBeenLastCalledWith('ROLLBACK');});

test('seed readback mismatch rolls back before commit',async()=>{const base=pg.query.getMockImplementation();pg.query.mockImplementation(sql=>sql==='SELECT * FROM expertise_roster ORDER BY id'?{rows:[{...source.rows[0],name:'Corrupted'}]}:base(sql));await expect(main(args)).rejects.toThrow('parity mismatch');expect(pg.query).toHaveBeenLastCalledWith('ROLLBACK');expect(pg.query.mock.calls.some(([sql])=>sql==='COMMIT')).toBe(false);});
test('invalid source timestamps refuse before connecting',async()=>{source.rows[0].created_at='bad-date';fs.writeFileSync(args[1],JSON.stringify(source));await expect(main(args)).rejects.toThrow('Invalid source timestamp');expect(Client).not.toHaveBeenCalled();});
