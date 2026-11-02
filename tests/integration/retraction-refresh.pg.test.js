/** @jest-environment node */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { refreshRetractions, HEADERS } = require('../../lib/services/retraction-refresh-service');
const { readRetractionDataset } = require('../../lib/services/retraction-dataset');
const URL_VALUE = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (URL_VALUE && !['localhost','127.0.0.1','[::1]'].includes(new URL(URL_VALUE).hostname)) throw new Error('Isolated loopback Postgres only');
if (!URL_VALUE && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') throw new Error('Scratch database required');
const describeDb = URL_VALUE ? describe : describe.skip;
let mockPool, mockAfterMetadata;
jest.mock('@vercel/postgres',()=>({db:{connect:()=>mockPool.connect()},sql:async(parts,...values)=>{
  const text=parts.reduce((s,p,i)=>s+p+(i<values.length?`$${i+1}`:''),'');
  const result=await mockPool.query(text,values);
  if(text.includes('FROM retraction_dataset')&&mockAfterMetadata){const hook=mockAfterMetadata;mockAfterMetadata=null;await hook();}
  return result;
}}));
const { IntegrityService } = require('../../lib/services/integrity-service');
const makeRow = (id, overrides={}) => ({'Record ID':String(id),Title:`Study ${id}`,Author:'Smith, John; A Example',Journal:'Journal',Publisher:'Publisher',Subject:'Subject',Institution:'Example University',Country:'USA',RetractionDate:'2/28/2020 0:00',OriginalPaperDOI:`10.1000/${id}`,RetractionNature:'Correction',Reason:'Error; Image concern',URLS:'https://example.org/notice',...overrides});
const csv = rows=>HEADERS.join(',')+'\n'+rows.map(r=>HEADERS.map(k=>'"'+(r[k]||'').replace(/"/g,'""')+'"').join(',')).join('\n')+'\n';
const migrationPath=path.join(process.cwd(),'lib/db/migrations/092_retraction_dataset.sql');

describeDb('managed reference refresh (real isolated Postgres)',()=>{
  let admin,pool,dir,alert;
  const schema='retraction_refresh_'+crypto.randomBytes(5).toString('hex');
  async function file(name,rows){const p=path.join(dir,name);await fs.writeFile(p,csv(rows));return p;}
  const run=(csvFile,options={},deps={})=>refreshRetractions(options,{pool,csvFile,alert,...deps});
  const metadata=async()=> (await pool.query('SELECT * FROM retraction_dataset')).rows[0];
  beforeAll(async()=>{
    admin=new Pool({connectionString:URL_VALUE});await admin.query(`CREATE SCHEMA ${schema}`);
    pool=new Pool({connectionString:URL_VALUE,max:5,options:`-c search_path=${schema},public`});mockPool=pool;
    dir=await fs.mkdtemp(path.join(os.tmpdir(),'retraction-pg-proof-'));
    await pool.query(`CREATE TABLE retractions (
      id SERIAL PRIMARY KEY,record_id VARCHAR(50) UNIQUE,title TEXT NOT NULL,authors TEXT NOT NULL,authors_normalized TEXT[],
      journal VARCHAR(500),publisher VARCHAR(255),subject VARCHAR(255),institution TEXT,country TEXT,retraction_date DATE,
      original_paper_doi VARCHAR(100),retraction_nature VARCHAR(100),retraction_reasons TEXT[],urls TEXT,
      created_at TIMESTAMP DEFAULT NOW(),last_updated TIMESTAMP DEFAULT NOW());
      CREATE INDEX retraction_authors_gin_fixture ON retractions USING GIN(authors_normalized);
      CREATE INDEX retraction_date_fixture ON retractions(retraction_date DESC);
      CREATE TABLE system_alerts(id SERIAL PRIMARY KEY,alert_type TEXT,severity TEXT,title TEXT,message TEXT,metadata JSONB,source TEXT,auto_resolve_key TEXT,status TEXT DEFAULT 'active');
      CREATE TABLE maintenance_runs(id SERIAL PRIMARY KEY,job_name TEXT,status TEXT,records_processed INT,records_deleted INT,
      details JSONB,error_message TEXT,started_at TIMESTAMP DEFAULT NOW(),completed_at TIMESTAMP,duration_ms INT);`);
    await pool.query(await fs.readFile(migrationPath,'utf8'));
    await pool.query(await fs.readFile(migrationPath,'utf8'));
    IntegrityService.serpApiKey=null;
  });
  beforeEach(async()=>{alert=jest.fn();mockAfterMetadata=null;await pool.query('TRUNCATE retractions,retraction_dataset,maintenance_runs,system_alerts RESTART IDENTITY');});
  afterAll(async()=>{await pool?.end();await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin?.end();if(dir)await fs.rm(dir,{recursive:true,force:true});});
  test('dry-run leaves corpus/metadata untouched; publish is complete, stable-id and repeat-safe',async()=>{
    const a=await file('a.csv',[makeRow(1,{Title:'Study, with\n"quotes"',Publisher:'p'.repeat(500),Subject:'s'.repeat(263)}),makeRow(2)]);
    const dry=await run(a,{dryRun:true});expect(dry).toMatchObject({status:'dry_run',published:false,count:2,inserted:2});expect(await metadata()).toBeUndefined();
    const published=await run(a);expect(published).toMatchObject({status:'published',published:true,generation:'1',auditRecorded:true});
    const rows=(await pool.query('SELECT * FROM retractions ORDER BY record_id')).rows;
    expect(rows[0].title).toBe('Study, with\n"quotes"');expect(rows[0].authors_normalized).toEqual(['john smith','a example']);expect(rows[0].retraction_reasons).toEqual(['Error','Image concern']);
    const first=await metadata();await new Promise(r=>setTimeout(r,5));
    const unchanged=await run(a);expect(unchanged.status).toBe('unchanged');const second=await metadata();
    expect(second.generation).toBe(first.generation);expect(second.published_at).toEqual(first.published_at);expect(second.last_checked_at.getTime()).toBeGreaterThanOrEqual(first.last_checked_at.getTime());
    const b=await file('b.csv',[makeRow(1,{Title:'Changed'}),makeRow(3)]);await run(b);
    expect((await pool.query("SELECT id,title FROM retractions WHERE record_id='1'")).rows[0]).toEqual({id:rows[0].id,title:'Changed'});
    expect((await pool.query("SELECT 1 FROM retractions WHERE record_id='2'")).rows).toEqual([]);
    expect((await metadata()).generation).toBe('2');
  });
  test('same bytes with changed derivation are refused with explicit counts',async()=>{
    const a=await file('drift.csv',[makeRow(1)]);await run(a);await pool.query("UPDATE retractions SET authors_normalized=ARRAY['old normalization']");
    expect(await run(a,{dryRun:true})).toMatchObject({status:'dry_run',sourceUnchanged:true,changed:1,inserted:0,removed:0});
    await expect(run(a)).rejects.toMatchObject({code:'retraction_derived_corpus_differs',details:{changed:1,inserted:0,removed:0}});expect((await metadata()).generation).toBe('1');
  });
  test('rollback before commit preserves all prior data and metadata; duplicate/malformed inputs cannot publish',async()=>{
    const a=await file('a.csv',[makeRow(1)]);await run(a);const before=await metadata();
    const b=await file('b.csv',[makeRow(2)]);
    await expect(run(b,{}, {beforeCommit:async()=>{throw new Error('injected failure');}})).rejects.toThrow();
    expect(await metadata()).toEqual(before);expect((await pool.query('SELECT record_id FROM retractions')).rows).toEqual([{record_id:'1'}]);
    await expect(run(await file('duplicate.csv',[makeRow(1),makeRow(1)]))).rejects.toMatchObject({code:'invalid_or_duplicate_retraction_record'});
    expect(await metadata()).toEqual(before);
  });
  test('a large row drop is refused even in dry-run; reference-bearing deletions are refused',async()=>{
    await run(await file('large.csv',Array.from({length:20},(_,i)=>makeRow(i+1))));
    const small=await file('small.csv',[makeRow(1)]);await expect(run(small,{dryRun:true})).rejects.toMatchObject({code:'retraction_row_count_drop_requires_review'});
    await pool.query('CREATE TABLE linked_reference(id INT REFERENCES retractions(id) ON DELETE CASCADE)');
    try { await expect(run(await file('remove.csv',Array.from({length:19},(_,i)=>makeRow(i+1))))).rejects.toMatchObject({code:'retraction_removals_have_references'}); }
    finally {await pool.query('DROP TABLE linked_reference');}
    expect((await metadata()).row_count).toBe(20);
  });
  test('concurrent writer lock has no staging collision and is never reported as success',async()=>{
    const f=await file('concurrent.csv',[makeRow(1)]);const client=await pool.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1),0)',['retraction-watch-refresh']);
    try {expect(await run(f)).toMatchObject({status:'busy',published:false});expect(await metadata()).toBeUndefined();expect((await pool.query("SELECT status FROM maintenance_runs ORDER BY id DESC LIMIT 1")).rows[0].status).toBe('failed');}
    finally {await client.query('ROLLBACK');client.release();}
    expect((await run(f)).status).toBe('published');
  });
  test('post-commit audit failure remains a published success with a warning and alert',async()=>{
    const facade={connect:()=>pool.connect(),query:(text,...values)=>text.startsWith("UPDATE maintenance_runs SET status='completed'")?Promise.reject(new Error('audit unavailable')):pool.query(text,...values)};
    const result=await run(await file('audit.csv',[makeRow(1)]),{}, {pool:facade});
    expect(result).toMatchObject({status:'published',published:true,auditRecorded:false});expect(await metadata()).toBeTruthy();expect(alert).toHaveBeenCalledWith(expect.stringContaining('logging failed'), 'audit-failed');
  });
  test('actual A→B→A publication during a screen invalidates whole-run provenance and matches',async()=>{
    const a=await file('generation-a.csv',[makeRow(1)]),b=await file('generation-b.csv',[makeRow(2)]);await run(a);
    mockAfterMetadata=async()=>{await run(b);await run(a);};
    let completed;
    for await(const event of IntegrityService.screenApplicants([{name:'John Smith'},{name:'A Example'}],'fixture-only',null,null,{strictSourceErrors:true}))if(event.type==='complete')completed=event;
    expect((await metadata()).generation).toBe('3');
    for(const person of completed.results){expect(person.sources.retraction_watch.dataset.status).toBe('unverified');expect(person.sources.retraction_watch.error).toContain('dataset changed');expect(person.sources.retraction_watch.matches).toEqual([]);}
  });
  test('unchanged managed metadata is read as recorded; schema migration matches the fresh-install widths',async()=>{
    await run(await file('schema.csv',[makeRow(1)]));const tag=(parts,...values)=>pool.query(parts.reduce((s,p,i)=>s+p+(i<values.length?`$${i+1}`:''),''),values);
    expect(await readRetractionDataset(tag)).toMatchObject({status:'recorded',generation:'1',rowCount:1});
    const columns=await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='retractions' AND column_name IN ('publisher','subject')",[schema]);
    expect(columns.rows.map(r=>r.data_type)).toEqual(['text','text']);
  });
  test('missing migration and narrow columns fail before publication with safe diagnostics',async()=>{
    const f=await file('wide.csv',[makeRow(1,{Publisher:'p'.repeat(500)})]);
    await pool.query('ALTER TABLE retraction_dataset RENAME TO unpublished_schema_fixture');
    try {await expect(run(f)).rejects.toMatchObject({code:'retraction_schema_not_ready'});}
    finally {await pool.query('ALTER TABLE unpublished_schema_fixture RENAME TO retraction_dataset');}
    await pool.query('ALTER TABLE retractions ALTER COLUMN publisher TYPE VARCHAR(255)');
    try {await expect(run(f,{dryRun:true})).rejects.toMatchObject({code:'retraction_schema_width_mismatch',details:{widthViolations:[{column:'publisher',limit:255,observed:500}]}});}
    finally {await pool.query('ALTER TABLE retractions ALTER COLUMN publisher TYPE TEXT');}
    expect(await metadata()).toBeUndefined();
  });
  test('an open ordinary failure cannot suppress uncertain-publication or audit-failure alerts',async()=>{
    await pool.query("INSERT INTO system_alerts(auto_resolve_key) VALUES ('retraction-refresh-failure')");
    const facade={query:(...args)=>pool.query(...args),connect:async()=>{const client=await pool.connect();return {query:(...args)=>args[0]==='COMMIT'?client.query(...args).then(()=>{throw new Error('lost ack');}):client.query(...args),release:()=>client.release()};}};
    await expect(run(await file('alert.csv',[makeRow(1)]),{}, {pool:facade,alert:undefined})).rejects.toMatchObject({code:'retraction_publication_uncertain'});
    const auditFacade={connect:()=>pool.connect(),query:(text,...args)=>text.startsWith("UPDATE maintenance_runs SET status='completed'")?Promise.reject(new Error('audit unavailable')):pool.query(text,...args)};
    expect(await run(await file('alert-next.csv',[makeRow(2)]),{}, {pool:auditFacade,alert:undefined})).toMatchObject({published:true,auditRecorded:false});
    expect((await pool.query('SELECT auto_resolve_key FROM system_alerts ORDER BY id')).rows.map(r=>r.auto_resolve_key)).toEqual(['retraction-refresh-failure','retraction-refresh-publication-uncertain','retraction-refresh-audit-failed']);
  });
  test('a lost commit acknowledgement is uncertain, never a claim that old data was preserved',async()=>{
    const facade={query:(...args)=>pool.query(...args),connect:async()=>{const client=await pool.connect();return {
      query:(...args)=>args[0]==='COMMIT'?client.query(...args).then(()=>{throw new Error('acknowledgement lost');}):client.query(...args),
      release:()=>client.release(),
    };}};
    await expect(run(await file('commit.csv',[makeRow(1)]),{}, {pool:facade})).rejects.toMatchObject({code:'retraction_publication_uncertain'});
    expect((await metadata()).generation).toBe('1');expect(alert).toHaveBeenCalledWith(expect.stringContaining('committed=unknown'), 'publication-uncertain');
  });
  if(process.env.RETRACTION_FULL_CSV) test('full official source rehearsal publishes and validates unchanged check',async()=>{
    const started=Date.now();const result=await run(process.env.RETRACTION_FULL_CSV);expect(result.count).toBeGreaterThan(60000);expect(result.status).toBe('published');
    const unchanged=await run(process.env.RETRACTION_FULL_CSV);expect(unchanged.status).toBe('unchanged');
    console.log('FULL_RETRACTION_REHEARSAL',JSON.stringify({count:result.count,bytes:result.bytes,checksum:result.checksum,publishMs:result.durationMs,totalMs:Date.now()-started,rss:process.memoryUsage().rss}));
  },120000);
});
