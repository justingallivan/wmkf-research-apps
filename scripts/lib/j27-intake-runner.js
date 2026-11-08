import { isDeepStrictEqual } from 'node:util';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request.js';
import { linkedCycleCode, linkedCycleExpand } from '../../lib/dataverse/adapters/operations-grant-cycle.js';
import { isGuid } from '../../lib/utils/guid.js';
import { executePrompt } from '../../lib/services/execute-prompt.js';
import { generateGranteeTitle, GRANTEE_TITLE_PROMPT_NAME } from '../../lib/services/grantee-title-service.js';
import { fetchCurrentPrompt } from '../../lib/services/prompt-store.js';
import { classifyTestRequestSnapshot } from '../../lib/services/test-requests/isolation.js';
import { parseJ27IntakeFitComparison, recordJ27IntakeFitComparison } from '../../lib/services/workbench/j27-intake-fit-comparison.js';
import { J27_INTAKE_FIT_COMPARISON_FIELD, OVERALL_FIT_LABELS } from '../../shared/config/j27FitComparison.js';
import * as p1 from '../../shared/config/prompts/grantee-title.js';
import * as p2 from '../../shared/config/prompts/j27-executive-summary.js';
import * as p3 from '../../shared/config/prompts/j27-methodology.js';
import * as p4 from '../../shared/config/prompts/j27-personnel.js';
import * as p5 from '../../shared/config/prompts/j27-intake-rationale.js';
import * as p6 from '../../shared/config/prompts/j27-fit-concerns.js';

export const INTAKE_PROMPTS = [{ ...p1, PROMPT_NAME: GRANTEE_TITLE_PROMPT_NAME }, p2, p3, p4, p5, p6];
const runSource = 'Vercel Test';
const select = [
  'akoya_title', 'wmkf_istestrequest', 'wmkf_testcreationrunid',
  'wmkf_wmkfprojectdescription', 'wmkf_ai_summary', 'wmkf_ai_fitassessment',
  'wmkf_ai_fitrationale', J27_INTAKE_FIT_COMPARISON_FIELD,
].join(',');
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0;

function validatePacket(packet, binding) {
  if (!nonblank(packet?.id) || !nonblank(packet.materialsVersion)
    || !nonblank(packet.applicantTitle) || !nonblank(packet.layAbstract)
    || !nonblank(packet.summaryFields) || !nonblank(packet.proposalText)
    || !/\[page \d+\]\s*\S/i.test(packet.proposalText)
    || !Array.isArray(packet.roster) || packet.roster[0]?.role !== 'PI'
    || packet.roster.some((person, index) => !nonblank(person?.name) || (index > 0 && person.role !== 'Co-PI'))
    || !nonblank(packet.biosketches)) {
    throw new Error('Packet needs page-marked proposal text, Summary answers, abstract, official roster, and matched biosketches.');
  }
  for (const [field, max] of Object.entries({
    materialsVersion: 250, applicantTitle: 600, layAbstract: 1800, summaryFields: 25000,
    proposalText: 100000, biosketches: 100000, otherSupport: 100000,
    keckAbstracts: 100000, externalAwards: 50000,
  })) {
    if (packet[field] != null && (typeof packet[field] !== 'string' || packet[field].length > max)) {
      throw new Error(`Invalid or oversized packet field: ${field}.`);
    }
  }
  if (JSON.stringify(packet.roster).length > 25000) throw new Error('Packet roster exceeds the P4 input limit.');

  const { ternary, requestId } = binding ?? {};
  if (!isGuid(requestId) || requestId !== requestId.trim() || binding.packetId !== packet.id
    || !isGuid(ternary?.runId) || ternary.materialsVersion !== packet.materialsVersion
    || !Object.hasOwn(OVERALL_FIT_LABELS, ternary.assessment)
    || !nonblank(ternary.rationale) || ternary.rationale.length > 8000) {
    throw new Error('Binding needs the matching packet, a sandbox request GUID, and a ternary receipt for that materials version.');
  }
}

async function readRequest(requestId) {
  return getById(requestId, { select, expand: linkedCycleExpand() });
}

function assertSyntheticRequest(request, packet) {
  if (!request?._etag || linkedCycleCode(request) !== 'J27'
    || classifyTestRequestSnapshot(request).kind !== 'synthetic'
    || request.akoya_title !== packet.applicantTitle) {
    throw new Error('The request must be a versioned, Factory-marked J27 test request with the exact packet title.');
  }
}

export async function preflightJ27Intake(packet, binding) {
  validatePacket(packet, binding);
  const request = await readRequest(binding.requestId);
  assertSyntheticRequest(request, packet);
  const rawPair = request[J27_INTAKE_FIT_COMPARISON_FIELD];
  if (rawPair) {
    const snapshot = parseJ27IntakeFitComparison(rawPair);
    if (snapshot?.materialsVersion !== packet.materialsVersion || snapshot?.ternary.runId !== binding.ternary.runId) {
      throw new Error('The sandbox request already has a different or unreadable Intake fit comparison.');
    }
  } else if (request.wmkf_ai_fitassessment !== binding.ternary.assessment
    || request.wmkf_ai_fitrationale !== binding.ternary.rationale) {
    throw new Error('The ternary receipt does not match the saved sandbox fit fields.');
  }

  const prompts = await Promise.all(INTAKE_PROMPTS.map(async (definition) => {
    const name = definition.PROMPT_NAME;
    const row = await fetchCurrentPrompt(name);
    const version = Number(row.wmkf_promptversion);
    if (!isGuid(row.wmkf_ai_promptid) || !Number.isInteger(version) || version < 1
      || row.wmkf_ai_systemprompt !== definition.SYSTEM_PROMPT
      || row.wmkf_ai_promptbody !== definition.USER_PROMPT_TEMPLATE
      || !isDeepStrictEqual(JSON.parse(row.wmkf_ai_promptvariables), definition.PROMPT_VARIABLES)
      || !isDeepStrictEqual(JSON.parse(row.wmkf_ai_promptoutputschema), definition.PROMPT_OUTPUT_SCHEMA)) {
      throw new Error(`Sandbox prompt ${name} does not match this branch. Publish the reviewed version before rehearsing.`);
    }
    return { name, version };
  }));
  return { request, prompts };
}

/** One sandbox test request. P3–P5 drafts and review signals stay in the receipt. */
export async function runJ27Intake(packet, binding, { onStage = () => {} } = {}) {
  const { request, prompts } = await preflightJ27Intake(packet, binding);
  const { requestId, ternary } = binding;
  const common = { proposal_text: packet.proposalText, summary_fields: packet.summaryFields };
  const results = {};
  const record = (stage, result) => {
    results[stage] = result;
    onStage(stage, result);
    return result;
  };
  const execute = async (definition, overrideVariables, { passThrough = true } = {}) => {
    const result = await executePrompt({
      promptName: definition.PROMPT_NAME, requestId, runSource,
      overrideVariables, requireNoPersistence: passThrough,
    });
    if (result.blocked || !result.parsed || !result.writeResults?.allOk) {
      throw new Error(`${definition.PROMPT_NAME} did not complete successfully. Check the request and its AI run before retrying.`);
    }
    if (!passThrough && !result.writeResults.results.some(({ field, ok }) => field === 'wmkf_ai_summary' && ok)) {
      throw new Error('P2 did not save the Executive Summary.');
    }
    return { output: result.parsed, runId: result.runId, promptVersion: result.meta?.promptVersion };
  };

  if (nonblank(request.wmkf_wmkfprojectdescription)) {
    record('P1', { state: 'preserved', output: request.wmkf_wmkfprojectdescription });
  } else {
    const result = await generateGranteeTitle({
      sourceTitle: packet.applicantTitle, sourceAbstract: packet.layAbstract, runSource,
    });
    if (result.editedTitle.split(/\s+/).length > 12) throw new Error('P1 returned a title longer than 12 words.');
    await updateById(requestId, { wmkf_wmkfprojectdescription: result.editedTitle }, { ifMatch: request._etag });
    record('P1', { state: 'saved', output: result.editedTitle, runId: result.runId, promptVersion: result.promptVersion });
  }

  if (nonblank(request.wmkf_ai_summary)) {
    record('P2', { state: 'preserved', output: { executive_summary: request.wmkf_ai_summary } });
  } else {
    const result = await execute(p2, { ...common, lay_abstract: packet.layAbstract }, { passThrough: false });
    record('P2', { ...result, state: 'saved' });
  }

  const methodology = record('P3', await execute(p3, common)).output;
  const personnel = await execute(p4, {
    proposal_text: packet.proposalText, key_personnel: JSON.stringify(packet.roster),
    biosketches: packet.biosketches, methodology: methodology.methodology,
  });
  if (!isDeepStrictEqual(
    personnel.output.people.map(({ name, role }) => ({ name, role })),
    packet.roster.map(({ name, role }) => ({ name, role })),
  )) throw new Error('P4 returned a roster that differs from the official PI and Co-PI roster.');
  record('P4', personnel);
  record('P5', await execute(p5, {
    ...common, methodology: methodology.methodology, enabling_methods: JSON.stringify(methodology.enabling_methods),
  }));
  record('P6', await recordJ27IntakeFitComparison({
    requestId, materialsVersion: packet.materialsVersion, ternary, runSource,
    inputs: {
      ...common, biosketches: packet.biosketches, other_support: packet.otherSupport,
      keck_abstracts: packet.keckAbstracts, external_awards: packet.externalAwards,
      p2_fit_hint: JSON.stringify(results.P2.output.too_applied_hint ?? null),
    },
  }));

  return { packetId: packet.id, requestId, materialsVersion: packet.materialsVersion, prompts, results };
}
