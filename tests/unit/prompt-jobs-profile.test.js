import { parseExecutionSpec, validateProfile, hashProfile, validateProfileOutput } from '../../lib/services/prompt-jobs/profile';

const profile = {key:'proposal-analysis',revision:1,wrapperVersion:1,sharedInstructions:'Analyze the proposal.',documentRoles:['proposal'],recordNames:['pi_name'],limits:{maxDocuments:8,maxDocumentBytes:100000,maxTotalDocumentBytes:200000,maxRecordBytes:16000}};
const row = () => ({wmkf_ai_model:'claude-sonnet-4-6',wmkf_ai_systemprompt:'',wmkf_ai_promptbody:'Summarize.',wmkf_ai_promptvariables:JSON.stringify({execution:{contractVersion:1,mode:'shared-document-task',profile:{key:profile.key,revision:1,sha256:hashProfile(profile)}},variables:[{name:'proposal_context',source:{kind:'prepared_context'},required:true}]}),wmkf_ai_promptoutputschema:JSON.stringify({parseMode:'raw',outputs:[{name:'summary',target:{kind:'none'},maxWords:3}]})});
test('only explicit supported execution metadata opts in', () => {
  expect(parseExecutionSpec({wmkf_ai_promptvariables:'{"variables":[],"legacy":true}'})).toBeNull();
  expect(parseExecutionSpec(row()).mode).toBe('shared-document-task');
  expect(parseExecutionSpec({...row(),wmkf_ai_systemprompt:null}).mode).toBe('shared-document-task');
  expect(() => parseExecutionSpec({...row(),wmkf_ai_systemprompt:'Task-specific rules'})).toThrow('invalid prompt text');
  const r = row(), m = JSON.parse(r.wmkf_ai_promptvariables); m.execution.contractVersion=2; r.wmkf_ai_promptvariables=JSON.stringify(m);
  expect(() => parseExecutionSpec(r)).toThrow();
  expect(() => parseExecutionSpec({wmkf_ai_promptvariables:'{"variables":[{"source":{"kind":"prepared_context"}}]}'})).toThrow();
});
test('profile and declaration schemas reject unknowns, unsafe sources and model aliases', () => {
  expect(() => validateProfile({...profile, resolver:'http://example.com'})).toThrow();
  expect(hashProfile({...profile, revision:2})).not.toBe(hashProfile(profile));
  const r = row(), m = JSON.parse(r.wmkf_ai_promptvariables); m.variables.push({name:'pi_name',source:{kind:'dynamics'},required:true}); r.wmkf_ai_promptvariables=JSON.stringify(m);
  expect(() => parseExecutionSpec(r)).toThrow();
  expect(() => parseExecutionSpec({...row(),wmkf_ai_model:'sonnet'})).toThrow();
  expect(() => validateProfile(JSON.parse(JSON.stringify(profile).replace('"key":','"__proto__":{},"key":')))).toThrow();
});
test('raw and JSON output limits check actual values', () => {
  const schema = {outputs:[{name:'summary',maxWords:3,maxChars:30}]};
  expect(validateProfileOutput({summary:'one two three'},schema)).toEqual({summary:'one two three'});
  expect(() => validateProfileOutput({summary:'one two three four'},schema)).toThrow('maxWords');
  expect(() => validateProfileOutput({summary:'x'.repeat(31)},schema)).toThrow('maxChars');
  expect(() => validateProfileOutput({summary:4},schema)).toThrow();
});
