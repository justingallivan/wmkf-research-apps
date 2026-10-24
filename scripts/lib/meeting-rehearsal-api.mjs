import fs from 'node:fs';import {encode} from 'next-auth/jwt';
export async function rehearsalApi(){
 const fixture=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-fixture.json')),env=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-app-env.json')),actors=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-actors.json'));
 const actor=actors.find(a=>a.role==='coordinator'),base='http://127.0.0.1:3179',prefix='/api/meeting-tracker/visits/'+fixture.requestId;
 const token=await encode({secret:env.NEXTAUTH_SECRET,maxAge:3600,token:{sub:actor.azureactivedirectoryobjectid,azureId:actor.azureactivedirectoryobjectid,azureEmail:actor.internalemailaddress,email:actor.internalemailaddress,name:actor.fullname,profileName:actor.fullname,userType:'staff',profileId:actor.profileId,dynamicsSystemuserId:actor.systemuserid,lastActivity:Date.now()}});
 async function api(path,method='GET',body){if(!path.startsWith(prefix+'/')&&!path.startsWith('/api/cron/drain-'))throw Error('rehearsal_route_denied');const headers={Origin:base,'Content-Type':'application/json',Cookie:'next-auth.session-token='+token};if(path.startsWith('/api/cron/'))headers.Authorization='Bearer '+env.CRON_SECRET;
 const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(180000)});let value;try{value=await r.json()}catch{value={nonJson:true}}return {status:r.status,body:value};}
 async function raw(path){if(!path.startsWith(prefix+'/'))throw Error('rehearsal_route_denied');return fetch(base+path,{headers:{Origin:base,Cookie:'next-auth.session-token='+token},redirect:'manual',signal:AbortSignal.timeout(60000)});}
 return {fixture,env,actor,prefix,api,raw};
}
