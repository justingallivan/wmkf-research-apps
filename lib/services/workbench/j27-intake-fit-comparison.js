/**
 * Trusted intake caller → existing ternary writeback → P6 → one request memo.
 * The caller supplies the ternary run receipt and a version of its intake materials.
 * First Cut and staff decisions have no write path through this service.
 */
import { getById, updateById } from '../../dataverse/adapters/grant-request.js';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle.js';
import { isGuid } from '../../utils/guid.js';
import { validateAiJson } from '../../utils/ai-output-schema.js';
import { executePrompt } from '../execute-prompt.js';
import { J27_FIT_CONCERNS, J27_INTAKE_FIT_COMPARISON_FIELD, OVERALL_FIT_LABELS } from '../../../shared/config/j27FitComparison.js';
import { FIT_FLAGS_VALIDATION, PROMPT_NAME, PROMPT_VARIABLES } from '../../../shared/config/prompts/j27-fit-concerns.js';

const flagIds = Object.keys(J27_FIT_CONCERNS);
const comparisonSchema = {
  type: 'object',
  fields: {
    version: { type: 'integer', min: 1, max: 1 },
    materialsVersion: { type: 'string', maxLength: 250 },
    ternary: {
      type: 'object',
      fields: {
        assessment: { type: 'integer' },
        rationale: { type: 'string', maxLength: 8000 },
        runId: { type: 'string', maxLength: 36 },
      },
    },
    p6: {
      type: 'object',
      fields: {
        runId: { type: 'string', maxLength: 36 },
        promptVersion: { type: 'integer', min: 1 },
        model: { type: 'string', maxLength: 250 },
        flags: FIT_FLAGS_VALIDATION,
      },
    },
  },
};

const compact = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const words = (value) => value ? value.split(' ').length : 0;
const isOrdered = (flags) => flags.length === flagIds.length && flagIds.every((id, i) => flags[i].id === id);

export function parseJ27IntakeFitComparison(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = validateAiJson(parsed, comparisonSchema);
  if (!result.ok) return null;
  const { ternary, p6, materialsVersion } = result.value;
  return compact(materialsVersion) && Object.hasOwn(OVERALL_FIT_LABELS, ternary.assessment)
    && compact(ternary.rationale) && isGuid(ternary.runId) && isGuid(p6.runId) && compact(p6.model)
    && isOrdered(p6.flags) && p6.flags[5].level !== 'red'
    ? result.value : null;
}

function validateEvidence(flags, inputs) {
  if (!isOrdered(flags)) throw new Error('P6 must return the six concerns in order, exactly once.');
  const sources = { ...inputs, proposal: inputs.proposal_text };
  const proposalPages = new Map(
    [...inputs.proposal_text.matchAll(/\[page (\d+)\]([^]*?)(?=\[page \d+\]|$)/gi)]
      .map((match) => [Number(match[1]), compact(match[2])]),
  );
  // Each award has a title/year heading followed by its abstract. Validate
  // the quote within that award, since the supplied set may contain many.
  const keckAwards = new Map(
    inputs.keck_abstracts.trim().split(/\r?\n[ \t]*\r?\n/)
      .map((award) => {
        const [heading, ...body] = award.split(/\r?\n/);
        return [compact(heading), compact(body.join(' '))];
      }),
  );
  for (const flag of flags) {
    const reason = compact(flag.reason);
    const raised = flag.level === 'red' || flag.level === 'yellow';
    if ((flag.level === 'green' ? reason : !reason || words(reason) > 25)
      || raised !== (flag.evidence.length > 0)) {
      throw new Error(`P6 returned a reason or evidence inconsistent with ${flag.id}.`);
    }
    if (flag.id === 'funding_overlap' && !compact(inputs.other_support) && flag.level !== 'gray') {
      throw new Error('P6 must mark funding overlap gray when Other Support is missing.');
    }
    if (flag.id === 'keck_overlap' && (flag.level === 'red' || (!compact(inputs.keck_abstracts) && flag.level !== 'gray'))) {
      throw new Error('P6 returned an invalid level for Keck overlap.');
    }
    for (const evidence of flag.evidence) {
      const quote = compact(evidence.quote);
      const source = compact(sources[evidence.source]);
      const section = compact(evidence.section);
      const validLocation = evidence.source === 'proposal'
        ? evidence.page != null && section && proposalPages.get(evidence.page)?.includes(quote)
        : evidence.page === null && section;
      if (!quote || words(quote) >= 30 || !validLocation || !source.includes(quote)
        || (flag.id === 'keck_overlap'
          && (evidence.source !== 'keck_abstracts' || !keckAwards.get(section)?.includes(quote)))) {
        throw new Error(`P6 returned unverifiable evidence for ${flag.id}.`);
      }
    }
  }
}

/** Called within a trusted DAL context after the independent ternary flow writes the request. */
export async function recordJ27IntakeFitComparison({
  requestId, materialsVersion, ternary, inputs, actingUserSystemId = null, runSource = 'PowerAutomate Auto',
}) {
  if (!isGuid(requestId) || requestId !== requestId.trim()
    || !compact(materialsVersion) || materialsVersion.length > 250
    || ternary?.materialsVersion !== materialsVersion
    || !isGuid(ternary?.runId) || !Object.hasOwn(OVERALL_FIT_LABELS, ternary?.assessment)
    || !compact(ternary?.rationale) || ternary.rationale.length > 8000) {
    throw new Error('A request, intake materials version, and independent ternary result are required.');
  }
  const request = await getById(requestId, {
    select: `wmkf_ai_fitassessment,wmkf_ai_fitrationale,${J27_INTAKE_FIT_COMPARISON_FIELD}`,
    expand: linkedCycleExpand(),
  });
  if (linkedCycleCode(request) !== 'J27' || !request?._etag) {
    throw new Error('An existing, versioned J27 request is required.');
  }
  const existing = request[J27_INTAKE_FIT_COMPARISON_FIELD];
  if (existing != null && existing !== '') {
    const snapshot = parseJ27IntakeFitComparison(existing);
    if (snapshot?.materialsVersion === materialsVersion && snapshot.ternary.runId === ternary.runId) {
      return { snapshot, reused: true };
    }
    throw new Error('This request already has an Intake fit comparison.');
  }
  if (request.wmkf_ai_fitassessment !== ternary.assessment || request.wmkf_ai_fitrationale !== ternary.rationale) {
    throw new Error('The ternary receipt does not match the saved Fit Assessment and Fit Rationale.');
  }

  const overrides = Object.fromEntries(PROMPT_VARIABLES.variables.map(({ name, maxChars }) => {
    const value = inputs?.[name] ?? '';
    if (typeof value !== 'string' || value.length > maxChars) {
      throw new Error(`Invalid or oversized P6 input: ${name}.`);
    }
    return [name, value];
  }));
  if (!compact(overrides.summary_fields) || !/\[page \d+\]\s*\S/i.test(overrides.proposal_text)) {
    throw new Error('P6 requires Summary answers and page-marked proposal text.');
  }

  const result = await executePrompt({
    promptName: PROMPT_NAME,
    requestId,
    overrideVariables: overrides,
    runSource,
    requireNoPersistence: true,
    actingUserSystemId,
  });
  const { flags } = result.parsed;
  validateEvidence(flags, overrides);
  const snapshot = parseJ27IntakeFitComparison(JSON.stringify({
    version: 1,
    materialsVersion,
    ternary: { assessment: ternary.assessment, rationale: ternary.rationale, runId: ternary.runId },
    p6: { runId: result.runId, promptVersion: result.meta?.promptVersion, model: result.meta?.modelUsed, flags },
  }));
  if (!snapshot) throw new Error('P6 comparison failed snapshot validation.');
  const raw = JSON.stringify(snapshot);
  if (raw.length > 32000) throw new Error('P6 comparison exceeds the Dataverse memo limit.');
  await updateById(requestId, { [J27_INTAKE_FIT_COMPARISON_FIELD]: raw }, {
    ifMatch: request._etag,
    actingUserSystemId,
  });
  return { snapshot, reused: false };
}
