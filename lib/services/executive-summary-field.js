/** Executive Summary reuses the existing Lay Abstract column. No automatic writer is enabled. */
import { EXECUTIVE_SUMMARY_FIELD } from '../../shared/config/requestNarratives.js';
export { EXECUTIVE_SUMMARY_FIELD };
export const EXECUTIVE_SUMMARY_TASK = 'proposal.executive-summary';

/** Configurable Executor destinations cannot bypass the future initialization contract. */
export function assertNoExecutiveSummaryTarget(outputs) {
  if (outputs == null) return; // Legacy prompts may have no persistence declarations.
  if (!Array.isArray(outputs)) throw new Error('Prompt outputs must be an array.');
  for (const output of outputs) {
    const field = output?.target?.field;
    // Physical column names are case-insensitive. Also reject qualified spellings,
    // even though the current Executor does not support them as valid targets.
    if (typeof field === 'string' && field.trim().toLowerCase().split(/[./]/).pop() === EXECUTIVE_SUMMARY_FIELD
      && output.target.kind !== 'none') {
      throw new Error('Executive Summary requires the dedicated initialization contract; configurable prompt writes are disabled.');
    }
  }
}
