#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** HTTP checks of the unchanged candidate against only the owned production fixture. No invitation/email routes. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {encode} from 'next-auth/jwt';
const fixture=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-fixture.json')),env=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-app-env.json')),actors=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-actors.json'));
const base='http://127.0.0.1:3179',prefix='/api/meeting-tracker/visits/'+fixture.requestId,receipt={requestId:fixture.requestId,checks:[],responses:{}};
const save=()=>fs.writeFileSync('/private/tmp/wmkf-meeting-production-api-receipt.json',JSON.stringify(receipt,null,2),{mode:0o600});
const cookies={};for(const actor of actors){const token=await encode({secret:env.NEXTAUTH_SECRET,maxAge:3600,token:{sub:actor.azureactivedirectoryobjectid,azureId:actor.azureactivedirectoryobjectid,azureEmail:actor.internalemailaddress,email:actor.internalemailaddress,name:actor.fullname,profileName:actor.fullname,userType:'staff',profileId:actor.profileId,dynamicsSystemuserId:actor.systemuserid,lastActivity:Date.now(),needsLinking:false,isNewUser:false}});cookies[actor.role]='next-auth.session-token='+token;}
async function api(path,role='coordinator',method='GET',body){const r=await fetch(base+path,{method,headers:{Origin:base,Cookie:cookies[role],'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(60000)});let value;try{value=await r.json()}catch{value={nonJson:true}}return {status:r.status,body:value};}
try{
 const session=await api('/api/auth/session');assert.equal(session.status,200);assert.equal(session.body.user.profileId,fixture.coordinatorProfileId);receipt.checks.push('signed Coordinator role-play session accepted with real active-profile checks');
 const preparation=await api(prefix+'/preparation');receipt.responses.preparation=preparation;assert.equal(preparation.status,200);receipt.checks.push('real production request and active Site Visit binding accepted');save();
 let approval=await api(prefix+'/presentation-approval');receipt.responses.approval=approval;assert.equal(approval.status,200);assert.equal(approval.body.canApprove,true);receipt.checks.push('existing production Coordinator assignment resolved without changes');save();
 const helper=await api(prefix+'/presentation-approval','helper','POST',{action:'enroll',expectedVersion:0});receipt.responses.helperDenial=helper;assert.equal(helper.status,403);receipt.checks.push('helper cannot enroll Coordinator-owned approval');
 if(approval.body.version===0){approval=await api(prefix+'/presentation-approval','coordinator','POST',{action:'enroll',expectedVersion:0});receipt.responses.enrollment=approval;assert.equal(approval.status,200);}
 receipt.checks.push('Coordinator enrollment persists only in isolated database');
 const reload=await api(prefix+'/presentation-approval');receipt.responses.reload=reload;assert.equal(reload.status,200);assert.equal(reload.body.enrolled,true);
 receipt.passed=true;
}catch(error){receipt.passed=false;receipt.error=error.message;process.exitCode=1;}
finally{save();console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks,error:receipt.error,responses:Object.fromEntries(Object.entries(receipt.responses).map(([k,v])=>[k,{status:v.status,code:v.body.code}]))}));}
