#!/usr/bin/env node
/** Reviewed JS acceptance oracle for production .NET port. No external IO. */
const fs=require('node:fs'),path=require('node:path');
const {validateDefinition}=require('../lib/prompt-publication/definition-schema');
const {policy}=require('../lib/prompt-publication/policy-v1.json');
const clone=v=>JSON.parse(JSON.stringify(v));const vectors=[];const codes=new Set();
const add=(label,input)=>{const result=validateDefinition(input);for(const e of result.errors)codes.add(e.code);vectors.push({label,json:JSON.stringify(input),valid:result.valid});};
const generic={name:'pa.example',systemPrompt:'Useful instructions.',body:'Read {{input}}',variables:JSON.stringify({variables:[{name:'input',source:{kind:'override'}}]}),outputSchema:JSON.stringify({parseMode:'raw',outputs:[{name:'result',target:{kind:'none'}}]}),model:'sonnet',temperature:0.2,maxTokens:8000};
add('generic',generic);
for(const field of Object.keys(generic)){for(const bad of [null,true,{},[],17,''])add(field+' type',{...generic,[field]:bad});const d=clone(generic);delete d[field];add(field+' missing',d);}
add('extra bypass',{...generic,force:true});
const mutateMemo=(d,field,mutate,label)=>{const v=JSON.parse(d[field]);mutate(v);add(label,{...d,[field]:JSON.stringify(v)});};
for(const [name,c] of Object.entries(policy.consumerContracts)){
 const output=JSON.parse(c.outputJson);const vars=JSON.parse(c.variablesJson);
 const d={name,systemPrompt:c.systemExact??c.systemIncludes.join('\n'),body:c.body||vars.variables.map(v=>'{{'+v.name+'}}').join('\n'),variables:c.variablesJson,outputSchema:c.outputJson,model:output?.generationMode==='native-json-schema'?'claude-sonnet-5':'sonnet',temperature:null,maxTokens:c.rowMaxTokens||8000};
 add(name,d);add(name+' no system',{...d,systemPrompt:''});add(name+' no variables',{...d,variables:null});add(name+' no output',{...d,outputSchema:null});add(name+' high tokens',{...d,maxTokens:2147483647});
 mutateMemo(d,'variables',v=>{v.variables[0].source={kind:'override',default:{unexpected:true}};},name+' unsafe default');
 mutateMemo(d,'variables',v=>{v.variables=v.variables.map(x=>Object.fromEntries(Object.entries(x).reverse()));},name+' property ordering');
 if(output)mutateMemo(d,'outputSchema',v=>{v.outputs[0].target={kind:'akoya_request',field:'name'};},name+' changed target');
}
for(const source of [{kind:'override',default:'text'},{kind:'override',default:1},{kind:'dynamics',table:'akoya_request',field:'name'},{kind:'dynamics',table:'wrong',field:'name'},{kind:'sharepoint',pattern:'*.pdf',preprocess:'pdf_to_text',maxChars:4096},{kind:'other'}])mutateMemo(generic,'variables',v=>{v.variables[0].source=source;},'source '+JSON.stringify(source));
for(const space of [' ','\t','\n','\u0085','\u00a0','\ufeff','\u2028','\u2003']){
 add('placeholder space '+space.charCodeAt(0),{...generic,body:'Read {{'+space+'input'+space+'}}'});
 add('A7 space '+space.charCodeAt(0),{...generic,body:'Read {{input}} [['+space+'/'+space+'WMKF-hello'});
}
const nodes=[{type:'string',maxLength:0,default:''},{type:'string',enum:['a','b'],coerceEnum:true,default:'a'},{type:'string',enum:['a','a']},{type:'string',forbidPattern:'x'},{type:'integer',min:-3,max:4,default:2},{type:'number',min:0.1,max:0.8,default:0.5},{type:'integer',min:1.1},{type:'number',min:4,max:1},{type:'boolean',default:false},{type:'array',of:{type:'string'},default:[]},{type:'array',of:{type:'string'},default:['unchecked']},{type:'object',fields:{x:{type:'string'}}},{type:'record',of:{type:'integer'},keys:{maxLength:4,enum:['x']}},{type:'record',of:{type:'string'},keys:{pattern:'x'}},{type:'unknown'},{type:'string',nullable:true,default:null}];
for(const node of nodes){const output={parseMode:'json',outputs:[{name:'result',target:{kind:'none'}}],validationSchema:{type:'object',fields:{result:node}}};add('local schema '+JSON.stringify(node),{...generic,outputSchema:JSON.stringify(output)});for(const field of Object.keys(node))add('local malformed '+field,{...generic,outputSchema:JSON.stringify({...output,validationSchema:{type:'object',fields:{result:{...node,[field]:{bad:true}}}}})});}
for(const native of [true,false])for(const schema of [{type:'string'},{type:'string',maxLength:4},{type:'array',items:{type:'string'},minItems:1},{type:'array',items:{type:'string'},minItems:2},{type:'object',properties:{x:{type:'string'}},required:['x'],additionalProperties:false},{type:['string','null']},{type:'object',additionalProperties:{type:'string'}},{type:'number',minimum:2,maximum:1},{type:'string',pattern:'x'},{$ref:'https://invalid'}]){
 const output={parseMode:'json',outputs:[{name:'result',target:{kind:'none'}}],jsonSchema:{type:'object',properties:{result:schema},required:['result'],additionalProperties:false},...(native?{generationMode:'native-json-schema'}:{})};
 add('native '+native+' '+JSON.stringify(schema),{...generic,model:native?'claude-sonnet-5':'sonnet',outputSchema:JSON.stringify(output)});
}
for(const target of [{kind:'none'},{kind:'akoya_request',field:'name'},{kind:'akoya_request',field:'memo',jsonPath:'$.item'},{kind:'akoya_request',field:'memo',jsonPath:'$.__proto__'},{kind:'none',field:'name'},{kind:'wrong'}])for(const count of [1,2])add('target '+count+' '+JSON.stringify(target),{...generic,outputSchema:JSON.stringify({parseMode:'json',outputs:Array.from({length:count},(_,i)=>({name:'result'+i,target}))})});
for(const memo of ['{','[]','{"variables":[],"variables":[]}','{"variables":[{"name":"\\ud800"}]}','{"variables":[{"name":"input","source":{"kind":"override","default":9007199254740992}}]}'])add('memo parse complement',{...generic,variables:memo});
for(const name of ['bad.name','bad name',''])mutateMemo(generic,'variables',v=>{v.variables[0].name=name;},'invalid variable name');
add('template cap',{...generic,body:'x'.repeat(65537)});
// Complements that previously had no measured oracle coverage.
for(const model of ['SONNET','unreviewed-model','claude-sonnet-4','sonnet',null]){
 add('model identity '+model,{...generic,model});
 add('native model '+model,{...generic,model,outputSchema:JSON.stringify({parseMode:'json',generationMode:'native-json-schema',outputs:[{name:'result',target:{kind:'none'}}],jsonSchema:{type:'object',properties:{result:{type:'string'}},required:['result'],additionalProperties:false}})});
}
add('pending consumer',{...generic,name:'phase-i.checkin'});
add('memo cap',{...generic,variables:'x'.repeat(1000001)});
add('DTO cap',{...generic,body:'x'.repeat(1048577)});
for(const name of ['reviewer-finder.analyze','reviewer-finder.score-candidates','pre-site-visit.proposal-core.generate']){
 const c=policy.consumerContracts[name],d={name,systemPrompt:c.systemExact??c.systemIncludes.join('\n'),body:c.body||JSON.parse(c.variablesJson).variables.map(v=>'{{'+v.name+'}}').join('\n'),variables:c.variablesJson,outputSchema:c.outputJson,model:'claude-sonnet-5',temperature:0.2,maxTokens:c.rowMaxTokens||8000};
 add(name+' missing labels',{...d,body:d.body.replace(/[A-Z_]+:/g,'REMOVED')});
 add(name+' missing placeholders',{...d,body:d.body.replace(/\{\{[\s\S]*?\}\}/g,'omitted'),systemPrompt:d.systemPrompt.replace(/\{\{[\s\S]*?\}\}/g,'omitted')});
 add(name+' exact body altered',{...d,body:d.body+' altered'});
}
for(const change of [v=>v.variables.push(clone(v.variables[0])),v=>{v.variables[0].untrusted=true;},v=>{v.variables[0].dataClass='text';},v=>{v.variables[0].placement='bad';},v=>{v.variables[0].maxChars=-1;},v=>{v.variables[0].name='__proto__';},v=>{v.variables[0].source={kind:'dynamics',field:'bad.field'};}])mutateMemo(generic,'variables',change,'variable complement');
const raw=JSON.parse(generic.outputSchema);
for(const parseMode of ['bad',null,0])add('parse mode complement',{...generic,outputSchema:JSON.stringify({...raw,parseMode})});
for(const change of [s=>s.outputs.push({name:'other',target:{kind:'none'}}),s=>{s.jsonSchema={type:'object'};},s=>{s.generationMode='native-json-schema';},s=>{s.generationMode='bad';},s=>{s.rawOutputRetention='bad';},s=>{s.outputs[0].name='__proto__';},s=>{s.outputs[0].name='bad.name';},s=>{s.outputs[0].guard='bad';},s=>{s.outputs[0].type='bad';},s=>{s.outputs=[];}]){const s=clone(raw);change(s);add('output complement',{...generic,outputSchema:JSON.stringify(s)});}
for(const schema of [{type:'string'},{type:'object',properties:{result:{type:'array'}}},{type:'object',properties:{result:{type:'string'}},required:['missing']},{type:'object',properties:{result:{type:'string'}},items:{type:'string'}},{type:'object',properties:{wrong:{type:'string'}},required:['wrong'],additionalProperties:false}])for(const native of [false,true])add('root schema complement',{...generic,model:'claude-sonnet-5',outputSchema:JSON.stringify({parseMode:'json',outputs:[{name:'result',target:{kind:'none'}}],jsonSchema:schema,...(native?{generationMode:'native-json-schema'}:{})})});
add('duplicate output name',{...generic,outputSchema:JSON.stringify({parseMode:'json',outputs:[{name:'x',target:{kind:'none'}},{name:'x',target:{kind:'none'}}]})});
for(const jsonPath of ['not-a-path','$.bad.path',null])add('invalid path',{...generic,outputSchema:JSON.stringify({parseMode:'json',outputs:[{name:'result',target:{kind:'akoya_request',field:'memo',jsonPath}}]})});
const output=JSON.stringify({version:1,rejectionCodes:[...codes].sort(),vectors},null,2)+'\n';const target=path.resolve(__dirname,'../tests/fixtures/prompt-publication/definitions-sdk-v1.json');
if(process.argv[2]==='--check'){if(fs.readFileSync(target,'utf8')!==output)throw new Error('Definition vectors drift');console.log('Definition SDK vectors match JS.');}else if(process.argv.length===2)fs.writeFileSync(target,output);else throw new Error('Only --check supported');
