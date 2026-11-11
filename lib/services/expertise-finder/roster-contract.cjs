/** Shared lossless roster DTO validation; no I/O. */
const spec=require('../../dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json');
const TEXT=['role','affiliation','orcid','preferred_email','primary_fields','keywords','subfields_specialties','methods_techniques','distinctions','expertise','keck_affiliation','keck_affiliation_details'];
const CATEGORIES=Object.fromEntries(spec.attributes.find(a=>a.schemaName==='wmkf_Category').options.map(o=>[o.label,o.value]));
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const column=k=>'wmkf_'+k.replaceAll('_','');
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function guid(v){return typeof v==='string'&&GUID.test(v);}
function normalize(input,current=null){
 const allowed=['name','role_type','is_active','lead_pd_eligible','dataverse_user_id','dataverse_contact_id',...TEXT];
 const out=current?{...current}:{name:'',role_type:'Consultant',is_active:true,lead_pd_eligible:false,dataverse_user_id:null,dataverse_contact_id:null,...Object.fromEntries(TEXT.map(k=>[k,null]))};
 for(const k of Object.keys(input))if(!allowed.includes(k))fail(`Unsupported roster field: ${k}`);else out[k]=input[k];
 if(typeof out.name!=='string'||!out.name.trim()||out.name.length>255)fail('Name is required (maximum 255 characters).');
 if(!Object.hasOwn(CATEGORIES,out.role_type))fail('Unknown roster category.');
 for(const k of ['is_active','lead_pd_eligible'])if(typeof out[k]!=='boolean')fail(`${k} must be a boolean.`);
 for(const k of ['dataverse_contact_id','dataverse_user_id']){if(out[k]==='')out[k]=null;if(out[k]!==null&&!guid(out[k]))fail(`${k} must be a canonical GUID or null.`);}
 const staff=out.role_type==='Research Program Staff';
 if((staff&&out.dataverse_contact_id)||(!staff&&out.dataverse_user_id))fail('Clear the incompatible person link when changing category.');
 if(out.lead_pd_eligible&&(!staff||!out.is_active||!out.dataverse_user_id))fail('Lead eligibility requires active staff with a User link.');
 // Dataverse reads exact empty optional text back as null. Canonicalize the
 // copied DTO, never the caller's original input; preserve whitespace/nonempty text.
 for(const k of TEXT){if(out[k]==='')out[k]=null;const v=out[k],limit=spec.attributes.find(a=>a.schemaName.toLowerCase()===column(k)).maxLength;if(v!==null&&(typeof v!=='string'||v.length>limit))fail(`${k} exceeds its text limit or has an invalid type.`);}
 if(out.preferred_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.preferred_email))fail('Preferred email is invalid.');
 if(out.dataverse_contact_id&&out.preferred_email&&(!current||out.preferred_email!==current.preferred_email))fail('Preferred email cannot be changed while linked to a Contact.');
 return out;
}
function encode(v){return {wmkf_name:v.name,wmkf_category:CATEGORIES[v.role_type],statecode:v.is_active?0:1,statuscode:v.is_active?1:2,wmkf_leadpdeligible:v.lead_pd_eligible,wmkf_contactguid:v.dataverse_contact_id,'wmkf_StaffUser@odata.bind':v.dataverse_user_id?`/systemusers(${v.dataverse_user_id})`:null,...Object.fromEntries(TEXT.map(k=>[column(k),v[k]]))};}
function decode(r){return {id:r.wmkf_expertiseprofileid,profile_guid:r.wmkf_expertiseprofileid,etag:r._etag,name:r.wmkf_name,role_type:Object.keys(CATEGORIES).find(k=>CATEGORIES[k]===r.wmkf_category)||null,is_active:r.statecode===0,lead_pd_eligible:r.wmkf_leadpdeligible===true,dataverse_user_id:r._wmkf_staffuser_value??null,dataverse_contact_id:r.wmkf_contactguid??null,updated_at:r.modifiedon,...Object.fromEntries(TEXT.map(k=>[k,r[column(k)]??null]))};}
module.exports={TEXT,CATEGORIES,column,guid,fail,normalize,encode,decode};
