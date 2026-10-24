/** Content-free preparation queue. Every completion is lease-fenced; unknown paid attempts require explicit recovery. */
import crypto from 'node:crypto';
import { db } from '@vercel/postgres';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
export const PREPARATION_STEPS = Object.freeze(['source','transcripts','presentation_summary','discussion_summary','video']);
const summaryType = kind => kind === 'presentation_summary' ? 100000007 : kind === 'discussion_summary' ? 100000010 : null;
const conflict = () => new ServiceHttpError('Preparation changed. Refresh before continuing.', {httpStatus:409,code:'preparation_changed'});
const safeCode = code => /^[a-z0-9_]{1,80}$/.test(code || '') ? code : 'preparation_failed';
const guid = value => { if(!isGuid(value)) throw new TypeError('invalid_preparation_identity'); return value; };
export function createPreparationStore(database) {
 async function transaction(fn) {
  const client=await database.connect();
  try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 }
 async function read(id, requestId, client=database) {
  guid(id);guid(requestId);
  const row=(await client.query('SELECT * FROM meeting_material_preparations WHERE id=$1 AND request_id=$2',[id,requestId])).rows[0];
  if(!row)return null;
  const steps=(await client.query('SELECT * FROM meeting_material_preparation_steps WHERE preparation_id=$1 ORDER BY kind',[id])).rows;
  const runs=(await client.query('SELECT id,state,generation_outcome FROM meeting_transcript_summary_drafts WHERE preparation_id=$1',[id])).rows;
  return {...row,steps:steps.map(step=>{
   const run=runs.find(item=>item.id===step.attempt_id);
   if(step.state==='blocked'&&run&&['reserved','dispatched','unknown'].includes(run.generation_outcome))return {...step,state:'unknown'};
   if(step.state==='succeeded'&&run&&['expired','discarded','superseded'].includes(run.state))return {...step,state:'blocked',failure_code:run.state==='expired'?'summary_draft_expired':'summary_draft_unavailable'};
   return step;
  })};
 }
 async function latest(requestId) {
  guid(requestId);
  const row=(await database.query(`SELECT p.id FROM meeting_material_preparations p WHERE p.request_id=$1
    ORDER BY EXISTS(SELECT 1 FROM meeting_transcript_summary_drafts d WHERE d.preparation_id=p.id AND d.generation_outcome IN ('reserved','dispatched','unknown')) DESC,p.created_at DESC,p.id DESC LIMIT 1`,[requestId])).rows[0];
  return row?read(row.id,requestId):null;
 }
 async function create({requestId,siteVisitId,fingerprint,input,profileId,actingUserSystemId}) {
  guid(requestId);guid(siteVisitId);guid(actingUserSystemId);
  if(!Number.isSafeInteger(profileId)||profileId<1||!/^[a-f0-9]{64}$/.test(fingerprint))throw new TypeError('invalid_preparation_actor');
  return transaction(async client=>{
   const inserted=(await client.query(`INSERT INTO meeting_material_preparations
    (request_id,site_visit_id,input_fingerprint,input,actor_profile_id,acting_user_system_id)
    VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(request_id,site_visit_id,input_fingerprint) DO NOTHING RETURNING id`,
   [requestId,siteVisitId,fingerprint,JSON.stringify(input),profileId,actingUserSystemId])).rows[0];
   const row=inserted||(await client.query('SELECT id FROM meeting_material_preparations WHERE request_id=$1 AND site_visit_id=$2 AND input_fingerprint=$3',[requestId,siteVisitId,fingerprint])).rows[0];
   if(inserted)for(const kind of PREPARATION_STEPS)await client.query('INSERT INTO meeting_material_preparation_steps(preparation_id,kind) VALUES($1,$2)',[row.id,kind]);
   return read(row.id,requestId,client);
  });
 }
 async function recoverExpired() {
  return transaction(async client=>{
   const rows=(await client.query(`SELECT s.*,p.request_id FROM meeting_material_preparation_steps s
    JOIN meeting_material_preparations p ON p.id=s.preparation_id
    WHERE s.state='running' AND s.lease_expires_at<=NOW() ORDER BY s.lease_expires_at LIMIT 20 FOR NO KEY UPDATE OF p,s SKIP LOCKED`)).rows;
   for(const row of rows){
    const paid=Boolean(summaryType(row.kind));
    let child=paid?(await client.query('SELECT state,generation_outcome,failure_code FROM meeting_transcript_summary_drafts WHERE id=$1 AND preparation_id=$2 FOR UPDATE',[row.attempt_id,row.preparation_id])).rows[0]:null;
    let safeToResume=paid&&!child;
    if(child?.generation_outcome==='reserved'){
     const retired=await client.query(`UPDATE meeting_transcript_summary_drafts SET state='failed',generation_outcome='failed',failure_code='preparation_worker_interrupted',version=version+1,updated_at=NOW()
      WHERE id=$1 AND preparation_id=$2 AND state='generating' AND generation_outcome='reserved' RETURNING id`,[row.attempt_id,row.preparation_id]);
     safeToResume=retired.rows.length===1;
     if(!safeToResume)child=(await client.query('SELECT state,generation_outcome,failure_code FROM meeting_transcript_summary_drafts WHERE id=$1 AND preparation_id=$2',[row.attempt_id,row.preparation_id])).rows[0];
    }
    const emptyDiscussion=child?.failure_code==='staff_discussion_not_recorded';
    const completed=emptyDiscussion||child?.generation_outcome==='completed'||(child&&['ready','published'].includes(child.state));
    const knownFailed=child?.generation_outcome==='failed'&&!safeToResume;
    const state=completed?'succeeded':safeToResume?(row.attempts>=3?'blocked':'pending'):knownFailed?'blocked':paid?'unknown':row.attempts>=3?'blocked':'pending';
    const failure=completed?null:knownFailed?child.failure_code:state==='unknown'?'summary_outcome_unknown':'preparation_worker_interrupted';
    await client.query(`UPDATE meeting_material_preparation_steps SET state=$2,lease_token=NULL,lease_expires_at=NULL,
     failure_code=$3,output=COALESCE($4::jsonb,output),attempt_id=COALESCE($5::uuid,attempt_id),version=version+1,updated_at=NOW() WHERE id=$1`,
    [row.id,state,failure?safeCode(failure):null,completed?JSON.stringify(emptyDiscussion?{discussionNotRecorded:true}:{draftId:row.attempt_id}):null,safeToResume?crypto.randomUUID():null]);
    if(state==='unknown')await client.query(`UPDATE meeting_transcript_summary_drafts SET generation_outcome='unknown',updated_at=NOW()
     WHERE id=$1 AND preparation_id=$2 AND state='generating' AND generation_outcome IN ('reserved','dispatched')`,[row.attempt_id,row.preparation_id]);
    await client.query('UPDATE meeting_material_preparations SET version=version+1,updated_at=NOW() WHERE id=$1',[row.preparation_id]);
   }return rows.length;
  });
 }
 async function claim({requestId=null}={}) {
  return transaction(async client=>{
   const row=(await client.query(`SELECT s.*,p.request_id,p.site_visit_id,p.input,p.source_artifact_id,p.source_fingerprint,COALESCE(s.execution_profile_id,p.actor_profile_id) AS actor_profile_id,COALESCE(s.execution_system_user_id,p.acting_user_system_id) AS acting_user_system_id
    FROM meeting_material_preparation_steps s JOIN meeting_material_preparations p ON p.id=s.preparation_id
    WHERE s.state='pending' AND s.next_attempt_at<=NOW() AND s.attempts<3 AND ($1::uuid IS NULL OR p.request_id=$1)
     AND NOT EXISTS(SELECT 1 FROM meeting_material_preparation_steps running WHERE running.preparation_id=p.id AND running.state='running')
     AND (s.kind='source' OR EXISTS(SELECT 1 FROM meeting_material_preparation_steps source WHERE source.preparation_id=p.id AND source.kind='source' AND source.state='succeeded'))
     AND (s.kind IN ('source','transcripts') OR EXISTS(SELECT 1 FROM meeting_material_preparation_steps t WHERE t.preparation_id=p.id AND t.kind='transcripts' AND t.state='succeeded'))
    ORDER BY p.created_at,s.kind LIMIT 1 FOR NO KEY UPDATE OF p,s SKIP LOCKED`,[requestId])).rows[0];
   if(!row)return null;
   // Fresh statement after the parent lock: a sibling claim may have committed after the selection snapshot.
   const running=await client.query("SELECT id FROM meeting_material_preparation_steps WHERE preparation_id=$1 AND state='running'",[row.preparation_id]);
   if(running.rows.length)return null;
   const token=crypto.randomUUID();
   const updated=(await client.query(`UPDATE meeting_material_preparation_steps SET state='running',attempts=attempts+1,
    lease_token=$2,lease_expires_at=NOW()+INTERVAL '330 seconds',version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *`,[row.id,token])).rows[0];
   return {...row,...updated};
  });
 }
 async function renew({id,leaseToken}) {
  return (await database.query(`UPDATE meeting_material_preparation_steps SET lease_expires_at=NOW()+INTERVAL '330 seconds'
   WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_expires_at>NOW() RETURNING id`,[guid(id),guid(leaseToken)])).rows[0]||null;
 }
 async function finish({id,leaseToken,state,output=null,failureCode=null,source=null}) {
  if(!['succeeded','blocked','unknown','pending'].includes(state))throw new TypeError('invalid_preparation_state');
  return transaction(async client=>{
   const row=(await client.query(`UPDATE meeting_material_preparation_steps SET state=$3,output=$4::jsonb,failure_code=$5,
    lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=NOW(),next_attempt_at=NOW()+INTERVAL '1 minute',
    attempts=CASE WHEN $3='pending' AND $5::text IS NULL THEN GREATEST(attempts-1,0) ELSE attempts END
    WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_expires_at>NOW() RETURNING *`,
   [guid(id),guid(leaseToken),state,output?JSON.stringify(output):null,failureCode?safeCode(failureCode):null])).rows[0];
   if(!row)return null;
   if(source){guid(source.id);if(!/^[a-f0-9]{64}$/.test(source.fingerprint))throw new TypeError('invalid_preparation_source');}
   await client.query(`UPDATE meeting_material_preparations SET source_artifact_id=COALESCE($2,source_artifact_id),
    source_fingerprint=COALESCE($3,source_fingerprint),version=version+1,updated_at=NOW() WHERE id=$1`,[row.preparation_id,source?.id||null,source?.fingerprint||null]);
   return row;
  });
 }
 async function retry({requestId,preparationId,stepId,expectedVersion,profileId,actingUserSystemId=null,resume=true,acknowledgePotentialDuplicateCharge=false,replaceDraft=null}) {
  return transaction(async client=>{
   const row=(await client.query(`SELECT s.*,p.request_id FROM meeting_material_preparation_steps s JOIN meeting_material_preparations p ON p.id=s.preparation_id
    WHERE s.id=$1 AND p.id=$2 AND p.request_id=$3 FOR NO KEY UPDATE OF p,s`,[guid(stepId),guid(preparationId),guid(requestId)])).rows[0];
   const expired=row&&summaryType(row.kind)&&row.state==='succeeded'
    ?(await client.query("SELECT id FROM meeting_transcript_summary_drafts WHERE id=$1 AND preparation_id=$2 AND state IN ('expired','discarded','superseded')",[row.attempt_id,preparationId])).rows.length>0:false;
   if(!row||Number(row.version)!==expectedVersion||(!['blocked','unknown'].includes(row.state)&&!expired))throw conflict();
   if(row.state==='unknown'&&acknowledgePotentialDuplicateCharge!==true)throw new ServiceHttpError('The first call may already have incurred a charge. Confirm before abandoning it.',{httpStatus:400,code:'preparation_charge_ack_required'});
   const type=summaryType(row.kind);
   if(type){
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`summary-draft:${requestId.toLowerCase()}:${type}`]);
    const child=(await client.query('SELECT generation_outcome FROM meeting_transcript_summary_drafts WHERE id=$1 AND preparation_id=$2 FOR UPDATE',[row.attempt_id,preparationId])).rows[0];
    if(child&&['reserved','dispatched','unknown'].includes(child.generation_outcome)&&acknowledgePotentialDuplicateCharge!==true)throw new ServiceHttpError('The summary outcome is uncertain. Confirm the possible duplicate charge before retrying.',{httpStatus:400,code:'preparation_charge_ack_required'});

    await client.query(`UPDATE meeting_transcript_summary_drafts SET state='failed',summary_text=NULL,generation_outcome='abandoned',
     failure_code='summary_attempt_abandoned',version=version+1,updated_at=NOW(),updated_by_profile_id=$3
     WHERE id=$1 AND preparation_id=$2 AND state='generating'`,[row.attempt_id,preparationId,profileId]);
   }
   await client.query('UPDATE meeting_material_preparations SET version=version+1,updated_at=NOW() WHERE id=$1',[preparationId]);
   return (await client.query(`UPDATE meeting_material_preparation_steps SET state=$6,attempts=0,attempt_id=$2,attempt_created_at=NOW(),
    options=$3::jsonb,execution_profile_id=CASE WHEN $5::uuid IS NULL THEN NULL ELSE $4::integer END,execution_system_user_id=$5,output=NULL,failure_code=CASE WHEN $6='blocked' THEN 'preparation_inputs_changed' ELSE NULL END,next_attempt_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *`,
   [stepId,crypto.randomUUID(),JSON.stringify(replaceDraft?{replaceDraft}:{}),profileId,actingUserSystemId,resume?'pending':'blocked'])).rows[0];
  });
 }
 return {read,latest,create,recoverExpired,claim,renew,finish,retry};
}
export const preparationStore=createPreparationStore(db);
