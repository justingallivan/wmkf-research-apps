/** Synthetic-only task capabilities. No production field mapping is enabled. */
import { parseExecutionSpec } from './profile.js';

// Conservative trial budget. The exact checkpoint byte check still handles
// anomalous provider replies without treating a received response as unknown.
export const SYNTHETIC_MAX_OUTPUT_TOKENS = 1536;

const TASKS = Object.freeze({
  'synthetic.executive-summary': Object.freeze({ outputName: 'summary', destinationField: 'fixture_summary', maxWords: 200 }),
  'synthetic.methodology': Object.freeze({ outputName: 'methodology', destinationField: 'fixture_methodology', maxChars: 12000 }),
});

export function getSyntheticTaskCapabilities() {
  return Object.entries(TASKS).map(([name, {outputName, maxWords, maxChars}]) => ({
    name, outputName, ...(maxWords ? {maxWords} : {}), ...(maxChars ? {maxChars} : {}),
  }));
}

export function validateSyntheticTask(promptRow, scope) {
  const capability = TASKS[promptRow?.wmkf_ai_promptname];
  if (!Object.hasOwn(TASKS, promptRow?.wmkf_ai_promptname) || scope?.environment !== 'test') {
    throw new Error('prompt job task is not enabled for this environment');
  }
  const spec = parseExecutionSpec(promptRow);
  const output = spec?.outputSchema.outputs[0];
  if (!spec || spec.outputSchema.outputs.length !== 1 || output.name !== capability.outputName) {
    throw new Error('prompt job output does not match capability');
  }
  if (!Number.isSafeInteger(promptRow.wmkf_ai_maxtokens) || promptRow.wmkf_ai_maxtokens < 1
    || promptRow.wmkf_ai_maxtokens > SYNTHETIC_MAX_OUTPUT_TOKENS) {
    throw new Error('prompt job output token budget exceeds capability');
  }
  const temperature = promptRow.wmkf_ai_temperature;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    throw new Error('prompt job temperature is outside the supported range');
  }
  for (const key of ['maxWords', 'maxChars']) {
    if (capability[key] && (!Number.isSafeInteger(output[key]) || output[key] > capability[key])) {
      throw new Error('prompt job output limit exceeds capability');
    }
  }
  return { ...capability, spec };
}
