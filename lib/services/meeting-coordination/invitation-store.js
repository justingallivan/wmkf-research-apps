/** Separate frozen presentation email receipts; unresolved transport intent never expires into a retry. */
import crypto from 'node:crypto';
import { db } from '@vercel/postgres';
export function createInvitationStore(database) {
 const query=(text,values=[])=>database.query(text,values);
 return {
  async create(input){
   const client=await database.connect();
   try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text,0))',[input.requestId]);
   const result=await client.query(`INSERT INTO meeting_presentation_invitations
    (id,request_id,site_visit_id,actor_profile_id,acting_user_system_id,from_email,source_hash,email_hash,envelope_hash,snapshot,subject,body_text,body_html,to_recipients,cc_recipients)
    SELECT $1,$2,$3,$4,$5,$6,$7,$14,$15,$8::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb
    WHERE (SELECT count(*) FROM meeting_presentation_invitations WHERE request_id=$2)<100 RETURNING *`,
    [input.id,input.requestId,input.siteVisitId,input.profileId,input.actingUserSystemId,input.fromEmail,input.sourceHash,JSON.stringify(input.snapshot),input.subject,input.bodyText,input.bodyHtml,JSON.stringify(input.to),JSON.stringify(input.cc),input.emailHash,input.envelopeHash]);
   await client.query('COMMIT');return result.rows[0]||null;
   }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  },
  async get(id,requestId){return (await query('SELECT * FROM meeting_presentation_invitations WHERE id=$1 AND request_id=$2',[id,requestId])).rows[0]||null;},
  async latest(requestId){return (await query(`SELECT * FROM meeting_presentation_invitations WHERE request_id=$1
    ORDER BY CASE WHEN state IN ('creating','activity_created','send_requested','unknown') THEN 0 ELSE 1 END,created_at DESC LIMIT 1`,[requestId])).rows[0]||null;},
  async claim(id,requestId,expectedVersion){
   const token=crypto.randomUUID();
   return (await query(`UPDATE meeting_presentation_invitations SET lease_token=$4,lease_expires_at=NOW()+INTERVAL '300 seconds',version=version+1,updated_at=NOW()
    WHERE id=$1 AND request_id=$2 AND version=$3 AND (lease_expires_at IS NULL OR lease_expires_at<NOW()) AND (state<>'prepared' OR preview_expires_at>NOW()) RETURNING *`,[id,requestId,expectedVersion,token])).rows[0]||null;
  },
  async renew(row){return (await query(`UPDATE meeting_presentation_invitations SET lease_expires_at=NOW()+INTERVAL '300 seconds',updated_at=NOW()
    WHERE id=$1 AND lease_token=$2 AND version=$3 AND lease_expires_at>NOW() RETURNING *`,[row.id,row.lease_token,row.version])).rows[0]||null;},
  async transition(row,state,{emailId=null,failureCode=null,release=false,emailVerified=false}={}){
   return (await query(`UPDATE meeting_presentation_invitations SET state=$4,dynamics_email_id=COALESCE($5,dynamics_email_id),failure_code=$6,email_verified_at=CASE WHEN $8 THEN COALESCE(email_verified_at,NOW()) ELSE email_verified_at END,
    lease_token=CASE WHEN $7 THEN NULL ELSE lease_token END,lease_expires_at=CASE WHEN $7 THEN NULL ELSE lease_expires_at END,version=version+1,updated_at=NOW()
    WHERE id=$1 AND lease_token=$2 AND version=$3 AND lease_expires_at>NOW() RETURNING *`,[row.id,row.lease_token,row.version,state,emailId,failureCode,release,emailVerified])).rows[0]||null;
  },
  async release(row){return (await query(`UPDATE meeting_presentation_invitations SET lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=NOW()
    WHERE id=$1 AND lease_token=$2 AND version=$3 RETURNING *`,[row.id,row.lease_token,row.version])).rows[0]||null;},
  async cleanup({requestId=null}={}){
   const deleted=await query(`DELETE FROM meeting_presentation_invitations WHERE id IN (SELECT id FROM meeting_presentation_invitations
    WHERE ($1::uuid IS NULL OR request_id=$1) AND ((state='prepared' AND (preview_expires_at<NOW() OR retention_expires_at<NOW())) OR (state IN ('sent','failed') AND retention_expires_at<NOW())) AND (lease_expires_at IS NULL OR lease_expires_at<NOW()) ORDER BY retention_expires_at LIMIT 100) RETURNING id`,[requestId]);
   const redacted=await query(`UPDATE meeting_presentation_invitations SET snapshot='{}'::jsonb,from_email='',subject='',body_text='',body_html='',to_recipients='[]'::jsonb,cc_recipients='[]'::jsonb,
    redacted_at=NOW(),version=version+1,updated_at=NOW() WHERE id IN (SELECT id FROM meeting_presentation_invitations WHERE ($1::uuid IS NULL OR request_id=$1) AND retention_expires_at<NOW() AND redacted_at IS NULL
    AND state IN ('creating','activity_created','send_requested','unknown') AND (lease_expires_at IS NULL OR lease_expires_at<NOW()) ORDER BY retention_expires_at LIMIT 100) RETURNING id`,[requestId]);
   return {deleted:deleted.rowCount,redacted:redacted.rowCount};
  },
 };
}
export const invitationStore=createInvitationStore(db);
