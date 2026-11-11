/** Synthetic-only task capabilities. No production field mapping is enabled. */
import { parseExecutionSpec } from './profile.js';

const TASKS = Object.freeze({
  'synthetic.executive-summary': Object.freeze({ outputName: 'summary', destinationField: 'fixture_summary', maxWords: 200 }),
  'synthetic.methodology': Object.freeze({ outputName: 'methodology', destinationField: 'fixture_methodology', maxChars: 12000 }),
});

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
  for (const key of ['maxWords', 'maxChars']) {
    if (capability[key] && (!Number.isSafeInteger(output[key]) || output[key] > capability[key])) {
      throw new Error('prompt job output limit exceeds capability');
    }
  }
  return capability;
}
