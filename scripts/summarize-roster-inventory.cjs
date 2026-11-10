#!/usr/bin/env node
/** Offline aggregate analysis of private inventory; no personal data on stdout. */
const fs=require('node:fs');const path=require('node:path');
const dir=process.argv[2];if(!dir)throw Error('Private inventory directory required');
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const source=read('source.json'),pg=read('postgres-evidence.json');
const spec=require('../lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json');
const fields=['role','affiliation','orcid','preferred_email','primary_fields','keywords','subfields_specialties','methods_techniques','distinctions','expertise','keck_affiliation','keck_affiliation_details'];
const sizes=Object.fromEntries(fields.map(f=>{const limit=spec.attributes.find(a=>a.schemaName.toLowerCase()==='wmkf_'+f.replaceAll('_','')).maxLength;return [f,{max:Math.max(0,...source.rows.map(r=>typeof r[f]==='string'?r[f].length:0)),limit,oversized:source.rows.filter(r=>typeof r[f]==='string'&&r[f].length>limit).length}]}));
const ids=new Set(source.rows.map(r=>r.id));
const duplicates=key=>{const m=new Map();for(const r of source.rows){const v=key(r);if(v)m.set(v,[...(m.get(v)||[]),r.id]);}return [...m.values()].filter(v=>v.length>1);};
const refs={};
function collect(value,out){if(!value||typeof value!=='object')return;if(value.kind==='roster')out.push(value.rosterId);for(const v of Object.values(value))collect(v,out);}
for(const host of ['wmkf.crm.dynamics.com','orgd9e66399.crm.dynamics.com']){
 const dv=read(`dataverse-${host}.json`);refs[host]={};
 for(const [entity,rows]of Object.entries(dv.refs)){
  if(!Array.isArray(rows)){refs[host][entity]=rows;continue;}
  let nonempty=0,invalid=0,roster=[];
  for(const row of rows){if(!row.wmkf_attendeerefsjson)continue;nonempty++;try{collect(JSON.parse(row.wmkf_attendeerefsjson),roster);}catch{invalid++;}}
  refs[host][entity]={rows:rows.length,nonempty,invalidJson:invalid,rosterReferences:roster.length,rosterIds:[...new Set(roster)],absentSourceIds:[...new Set(roster.filter(id=>!ids.has(id)))]};
 }
}
const report={fieldSizes:sizes,duplicateNameGroups:duplicates(r=>r.name.trim().toLowerCase()),duplicateContactGroups:duplicates(r=>r.dataverse_contact_id),feedbackReferences:pg.feedback.length,feedbackMissingSourceIds:pg.feedback.filter(r=>!ids.has(r.consultant_roster_id)).map(r=>r.consultant_roster_id),references:refs,sourceDatabaseReadOnly:pg.identity.read_only,sourceDatabaseVersion:pg.identity.version,ownerConfirmationsPending:source.rows.length};
fs.writeFileSync(path.join(dir,'analysis.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
