/** @jest-environment node */
jest.mock('../../lib/services/prompt-store.js',()=>({fetchCurrentPrompt:jest.fn(),interpolate:jest.fn()}));
jest.mock('../../lib/services/prompt-model-resolution.js',()=>({resolvePromptModel:jest.fn(()=>{throw new Error('model resolution reached');})}));
jest.mock('../../lib/dataverse/adapters/ai-run.js',()=>({create:jest.fn()}));
import { fetchCurrentPrompt } from '../../lib/services/prompt-store.js';
import { resolvePromptModel } from '../../lib/services/prompt-model-resolution.js';
import * as aiRun from '../../lib/dataverse/adapters/ai-run.js';
import { assertPreSitePromptTransitionOpen } from '../../lib/services/pre-site-visit/prompt-transition-gate';
import { generatePreSiteVisitArtifact } from '../../lib/services/pre-site-visit/artifact-service';
import { executePrompt } from '../../lib/services/execute-prompt';
const original = process.env.PRE_SITE_PROMPT_TRANSITION_PAUSE;
afterEach(()=>{if(original===undefined)delete process.env.PRE_SITE_PROMPT_TRANSITION_PAUSE;else process.env.PRE_SITE_PROMPT_TRANSITION_PAUSE=original;});
test.each([undefined,'','off'])('existing operation stays open at %p', value=>{
  if(value===undefined)delete process.env.PRE_SITE_PROMPT_TRANSITION_PAUSE;else process.env.PRE_SITE_PROMPT_TRANSITION_PAUSE=value;
  expect(()=>assertPreSitePromptTransitionOpen('pre-site-visit.proposal-core.generate')).not.toThrow();
});
test.each(['on','ON','false','0','typo'])('on and invalid values block %p',value=>{
  process.env.PRE_SITE_PROMPT_TRANSITION_PAUSE=value;
  expect(()=>assertPreSitePromptTransitionOpen('pre-site-visit.proposal-core.generate')).toThrow(expect.objectContaining({httpStatus:503,code:'pre_site_prompt_transition_paused'}));
  expect(()=>assertPreSitePromptTransitionOpen('PRE-SITE-VISIT.PROPOSAL-CORE.GENERATE')).toThrow();
  expect(()=>assertPreSitePromptTransitionOpen(' pre-site-visit.proposal-core.generate ')).toThrow();
  expect(()=>assertPreSitePromptTransitionOpen('initial-assessment.generate')).not.toThrow();
});
test('artifact generation and direct Executor calls pause before any read, claim or provider work',async()=>{
  process.env.PRE_SITE_PROMPT_TRANSITION_PAUSE='on';
  const deps=new Proxy({}, {get:()=>{throw new Error('dependency accessed before pause');}});
  await expect(generatePreSiteVisitArtifact({requestId:'10000000-0000-4000-8000-000000000001'},deps)).rejects.toMatchObject({code:'pre_site_prompt_transition_paused'});
  // No valid runSource or server credentials: only the pause can yield this
  // error before the Executor reaches validation, DAL/store or provider work.
  await expect(executePrompt({promptName:'pre-site-visit.proposal-core.generate'})).rejects.toMatchObject({code:'pre_site_prompt_transition_paused'});
});

test('resolved prompt identity is checked again before model resolution and failure-run writes',async()=>{
  delete process.env.PRE_SITE_PROMPT_TRANSITION_PAUSE;
  fetchCurrentPrompt.mockImplementationOnce(async()=>{
    process.env.PRE_SITE_PROMPT_TRANSITION_PAUSE='on';
    return {wmkf_ai_promptname:'pre-site-visit.proposal-core.generate'};
  });
  await expect(executePrompt({promptName:'reader-equivalent-alias',runSource:'Vercel Test'})).rejects.toMatchObject({code:'pre_site_prompt_transition_paused'});
  expect(fetchCurrentPrompt).toHaveBeenCalled();expect(resolvePromptModel).not.toHaveBeenCalled();expect(aiRun.create).not.toHaveBeenCalled();
});
