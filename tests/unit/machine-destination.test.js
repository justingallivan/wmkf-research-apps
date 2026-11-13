/** @jest-environment node */
import { authorizedTitleDestination, policyDestinationField, validateDestinationGrant, validateDestinationMetadata } from '../../lib/services/prompt-jobs/machine-destination';
import { buildMachineTitleDefinition, MACHINE_TITLE_FIELD } from '../../lib/services/prompt-jobs/machine-title-contract';
import { parseExecutionSpec } from '../../lib/services/prompt-jobs/profile';
import { validateTaskCapability } from '../../lib/services/prompt-jobs/capabilities';
const field='wmkf_testtitle';
const grant={field,type:'Memo',maxLength:2000};
function row(destinationField){const {task}=buildMachineTitleDefinition({destinationField});return {wmkf_ai_promptname:task.name,wmkf_ai_promptbody:task.body,wmkf_ai_systemprompt:task.systemPrompt,wmkf_ai_promptvariables:task.variables,wmkf_ai_promptoutputschema:task.outputSchema,wmkf_ai_model:task.model,wmkf_ai_maxtokens:task.maxTokens,wmkf_ai_temperature:task.temperature};}
const metadata=()=>({LogicalName:field,AttributeType:'Memo',MaxLength:10000,Format:'Text',SourceType:0,AttributeOf:null,RequiredLevel:{Value:'None'},IsValidForRead:true,IsValidForUpdate:true,IsSecured:false});
test('legacy mapping remains exact and explicit mapping needs its own exact grant',()=>{
 expect(authorizedTitleDestination(row(),{})).toBe(MACHINE_TITLE_FIELD);
 expect(policyDestinationField({})).toBe(MACHINE_TITLE_FIELD);
 expect(()=>authorizedTitleDestination(row(),{destinationGrant:grant})).toThrow();
 expect(()=>authorizedTitleDestination(row(field),{})).toThrow();
 expect(authorizedTitleDestination(row(field),{destinationGrant:grant})).toBe(field);
 expect(()=>authorizedTitleDestination(row(field),{destinationGrant:{...grant,field:'wmkf_other'}})).toThrow();
 expect(validateTaskCapability(row(field),null,{definitionOnly:true}).destinationField).toBe(field);
});
test.each(['WMKF_testtitle',' wmkf_testtitle','ownerid','wmkf_layabstract','wmkf_x/Attributes','constructor','wmkf_testtitle\n'])('field %j cannot become a reservation key',field=>{
 expect(()=>validateDestinationGrant({...grant,field})).toThrow();expect(()=>row(field)).toThrow();
});
test.each([{maxLength:100},{type:'Lookup'},{type:'Integer'},{maxLength:2000.5},{maxLength:Infinity},{extra:true}])('malformed grant %# rejected',patch=>expect(()=>validateDestinationGrant({...grant,...patch})).toThrow());
test('other profiled tasks cannot acquire Request targets by editing metadata',()=>{
 const r={...row(field),wmkf_ai_promptname:'proposal.executive-summary'};expect(()=>parseExecutionSpec(r)).toThrow('invalid output target');
});
test('jsonPath and extra target keys are refused',()=>{
 for(const patch of [{jsonPath:'$.title'},{entity:'akoya_request'},{kind:'account'}]){
  const r=row(field),s=JSON.parse(r.wmkf_ai_promptoutputschema);Object.assign(s.outputs[0].target,patch);r.wmkf_ai_promptoutputschema=JSON.stringify(s);
  expect(()=>parseExecutionSpec(r)).toThrow();
 }
});
test.each([{LogicalName:'wmkf_other'},{AttributeType:'Integer'},{IsSecured:true},{IsValidForRead:false},{IsValidForUpdate:false},{RequiredLevel:{Value:'ApplicationRequired'}},{AttributeOf:'wmkf_parent'},{SourceType:1},{SourceType:null},{Format:'RichText'},{MaxLength:1999},{MaxLength:undefined}])('metadata incompatibility %# fails closed',patch=>{
 expect(()=>validateDestinationMetadata({...metadata(),...patch},grant)).toThrow();
});
test('plain text compatible metadata passes without changing the grant',()=>expect(validateDestinationMetadata(metadata(),grant)).toBe(true));

test('legacy definition serializes exactly as the pre-extension publication',()=>{
 expect(buildMachineTitleDefinition().task.outputSchema).toBe('{"parseMode":"raw","outputs":[{"name":"edited_title","target":{"kind":"none"},"maxChars":2000}]}');
});
