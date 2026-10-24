/** @jest-environment node */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { createEditionStore } from '../../lib/services/post-presentation-materials/edition-store.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE } from '../../shared/config/requestDocument.js';
const url = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (process.env.TEST_REQUEST_LEDGER_REQUIRE === '1' && !url) throw new Error('Isolated local Postgres required');
if (url && (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname) || url === process.env.POSTGRES_URL)) throw new Error('Only isolated loopback Postgres is allowed');
const uuid = () => crypto.randomUUID();
const members = requestId => [TYPE.PRESENTATION_TRANSCRIPT, TYPE.TRANSCRIPT_SUMMARY, TYPE.PRESENTATION_VIDEO].map(type => ({
  documentId: uuid(), requestId, type, driveId:'drive', itemId:uuid(), filename:type===TYPE.PRESENTATION_VIDEO?'cut.mp4':'summary.txt',
  contentType:type===TYPE.PRESENTATION_VIDEO?'video/mp4':'text/plain', size:10, eTag:'e1', sha256:'a'.repeat(64),
  splitId:type===TYPE.PRESENTATION_VIDEO?uuid():null, quickXorHash:type===TYPE.PRESENTATION_VIDEO?'hash':null,
}));
(url ? describe : describe.skip)('presentation editions (real isolated PostgreSQL)', () => {
  let admin, pool, schema, store;
  beforeAll(async () => {
    admin=new pg.Client({connectionString:url}); await admin.connect(); schema=`edition_test_${uuid().replace(/-/g,'')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});
    await pool.query('CREATE TABLE user_profiles (id INTEGER PRIMARY KEY)');
    await pool.query('INSERT INTO user_profiles VALUES (1),(2)');
    await pool.query(fs.readFileSync('lib/db/migrations/086_meeting_presentation_editions.sql','utf8'));
    store=createEditionStore(pool);
  });
  afterAll(async()=>{ if(pool)await pool.end();if(admin){if(schema)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}});
  function approval(requestId, expectedVersion=1) {return {requestId,profileId:1,expectedVersion,commandId:uuid(),revisionId:uuid(),endMs:9000,members:members(requestId),fingerprint:'a'.repeat(64)};}
  test('concurrent enrollment returns the same row without restamping',async()=>{
    const id=uuid();expect(await store.read(id)).toBeNull();
    const [a,b]=await Promise.all([store.enroll({requestId:id,profileId:1}),store.enroll({requestId:id,profileId:2})]);
    expect(a.version).toBe(1);expect(b.version).toBe(1);expect(a.enrolled_at).toEqual(b.enrolled_at);expect(a.enrolled_by).toBe(b.enrolled_by);
  });
  test('only one concurrent approval wins; withdrawn old approval cannot revive',async()=>{
    const id=uuid();await store.enroll({requestId:id,profileId:1});const a=approval(id),b=approval(id);
    const results=await Promise.allSettled([store.approve(a),store.approve(b)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const winner=results[0].status==='fulfilled'?a:b;
    const row=await store.read(id);expect(row.version).toBe(2);expect(row.members).toEqual(winner.members);
    expect((await store.approve(winner)).reused).toBe(true);expect((await store.read(id)).version).toBe(2);
    await store.withdraw({requestId:id,profileId:1,expectedVersion:2,expectedEditionId:row.active_edition_id});
    expect((await store.read(id)).active_edition_id).toBeNull();
    await expect(store.approve(winner)).rejects.toMatchObject({httpStatus:409});
    expect((await store.read(id)).version).toBe(3);
  });
  test('approval and withdrawal of the same version serialize; old members survive replacement',async()=>{
    const id=uuid();await store.enroll({requestId:id,profileId:1});await store.approve(approval(id));const old=await store.read(id);
    const results=await Promise.allSettled([store.approve(approval(id,2)),store.withdraw({requestId:id,profileId:1,expectedVersion:2,expectedEditionId:old.active_edition_id})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const retained=await pool.query('SELECT * FROM meeting_presentation_editions WHERE id=$1',[old.active_edition_id]);
    expect(retained.rows[0].members).toEqual(old.members);expect((await store.read(id)).version).toBe(3);
  });
  test('cross-request pointers are rejected by the database; no implicit enrollment',async()=>{
    const a=uuid(),b=uuid();await store.enroll({requestId:a,profileId:1});await store.enroll({requestId:b,profileId:1});
    await store.approve(approval(a));const row=await store.read(a);
    await expect(pool.query('UPDATE meeting_presentation_visibility SET active_edition_id=$2 WHERE request_id=$1',[b,row.active_edition_id])).rejects.toMatchObject({code:'23503'});
    await expect(store.approve(approval(uuid()))).rejects.toMatchObject({httpStatus:409});
  });
  test('invalid member/unknown internal type is refused before persistence',async()=>{
    const id=uuid();await store.enroll({requestId:id,profileId:1});const args=approval(id);args.members[0].type=TYPE.STAFF_DISCUSSION_TRANSCRIPT;
    await expect(store.approve(args)).rejects.toThrow('invalid_edition_members');expect((await store.read(id)).version).toBe(1);
  });
});
