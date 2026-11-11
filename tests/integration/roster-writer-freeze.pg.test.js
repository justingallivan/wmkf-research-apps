/** @jest-environment node */
// Opt-in bounded maintenance-lock probe. Both connections always roll back;
// explicit synthetic IDs avoid advancing the live fixture's roster sequence.
import fs from 'node:fs';
import dotenv from 'dotenv';
import {Client} from 'pg';
const {assertTarget}=require('../../lib/services/expertise-finder/roster-rehearsal-target.cjs');
const run=process.env.ROSTER_LIVE_SQL_TEST_ENV?describe:describe.skip;
run('populated local roster fixture writer freeze and release',()=>{
 test('a legacy writer is blocked during the lock and resumes after rollback without retained changes',async()=>{
  const env=dotenv.parse(fs.readFileSync(process.env.ROSTER_LIVE_SQL_TEST_ENV));
  const {connectionString}=assertTarget(env);
  const owner=new Client({connectionString,query_timeout:5000});
  const writer=new Client({connectionString,options:'-c lock_timeout=500ms -c statement_timeout=2000ms'});
  let ownerConnected=false,writerConnected=false;
  try {
   await owner.connect();ownerConnected=true;
   await writer.connect();writerConnected=true;
   const snapshot=async()=>({
    counts:(await owner.query('SELECT (SELECT count(*) FROM expertise_roster) roster,(SELECT count(*) FROM expertise_roster_identity) identities,(SELECT count(*) FROM expertise_roster_binding) bindings,(SELECT count(*) FROM consultant_feedback) feedback')).rows,
    sequence:(await owner.query('SELECT last_value,is_called FROM expertise_roster_id_seq')).rows,
    fks:(await owner.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='consultant_feedback'::regclass AND contype='f' ORDER BY conname")).rows,
   });
   const before=await snapshot();
   await owner.query('BEGIN');await owner.query('SET LOCAL lock_timeout = \'2s\'');
   await owner.query('LOCK TABLE expertise_roster IN ACCESS EXCLUSIVE MODE');
   await writer.query('BEGIN');
   const insert="INSERT INTO expertise_roster(id,name,role_type) VALUES(-2147483648,'Synthetic rolled-back lock probe','Consultant')";
   await expect(writer.query(insert)).rejects.toMatchObject({code:'55P03'});
   await writer.query('ROLLBACK');await owner.query('ROLLBACK');
   await writer.query('BEGIN');await writer.query(insert);await writer.query('ROLLBACK');
   expect(await snapshot()).toEqual(before);
   expect((await owner.query('SELECT count(*)::int count FROM expertise_roster WHERE id=-2147483648')).rows[0].count).toBe(0);
  } finally {
   await Promise.allSettled([[writer,writerConnected],[owner,ownerConnected]].map(async([connection,connected])=>{
    try{if(connected)await connection.query('ROLLBACK');}finally{await connection.end();}
   }));
  }
 });
});
