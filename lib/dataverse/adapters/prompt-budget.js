/** PR553 budget coordination adapter — NOT wired to an application route.
 * Requires an existing trusted DAL context and server-derived actor. No context
 * bypass or fallback writes. Reads no prompt content. Control must be seeded
 * explicitly before cutover; absent/duplicate/invalid state fails closed.
 * The atomic commit accepts only a frozen plan prepared in this server process.
 * Unknown commit outcomes must be resolved by existing budget request-ID lookup.
 */
import { DynamicsService } from '../../services/dynamics-service.js';
import { assertTrustedDalContext } from '../../services/dynamics-context.js';
import { parseExecutorBudgetSettings } from '../../services/executor-budget-service.js';
import { entitySet } from '../core/entity-registry.js';
import * as odata from '../core/odata.js';
import { runChangeset } from '../core/changeset.js';
import { parseJson, isObject } from '../../prompt-publication/json-contract.js';
import { CONTROL_KEY, isPreparedBudgetPlan, validateControl } from '../../prompt-publication/budget-coordination.js';

const SETTINGS = entitySet('wmkf_appsystemsettings');
const PROMPTS = entitySet('wmkf_ai_prompts');
function fail(code) { const error = new Error(code); error.code = code; throw error; }
export async function readBudgetControl() {
  assertTrustedDalContext('prompt-budget.readBudgetControl');
  const result = await DynamicsService.queryAllRecords(SETTINGS, {
    select: 'wmkf_settingkey,wmkf_settingvalue', filter: odata.eq('wmkf_settingkey', CONTROL_KEY),
  });
  if (!Array.isArray(result?.records) || result.records.length !== 1) fail('budget_control_missing_or_duplicate');
  const row = result.records[0], value = parseJson(row.wmkf_settingvalue);
  if (!isObject(value)) fail('invalid_budget_control');
  if (Object.prototype.hasOwnProperty.call(value, 'etag')) fail('budget_control_embedded_etag');
  const control = { ...value, etag: row['@odata.etag'] };
  validateControl(control);
  return control;
}
export async function readBudgetState() {
  assertTrustedDalContext('prompt-budget.readBudgetState');
  // Do NOT use the legacy settings client here: it prefers DYNAMICS_SANDBOX_URL
  // whereas control/model/commit use DynamicsService's one explicit target.
  const result = await DynamicsService.queryAllRecords(SETTINGS, {
    select: 'wmkf_settingkey,wmkf_settingvalue',
    filter: `startswith(wmkf_settingkey,'${odata.escape('executor.budgets.v')}')`,
  });
  if (!Array.isArray(result?.records)) fail('invalid_budget_history_read');
  const settings = Object.create(null);
  for (const row of result.records) {
    if (typeof row?.wmkf_settingkey !== 'string' || !row.wmkf_settingkey.startsWith('executor.budgets.v') || typeof row.wmkf_settingvalue !== 'string') fail('invalid_budget_history_read');
    if (Object.prototype.hasOwnProperty.call(settings, row.wmkf_settingkey)) fail('duplicate_budget_revision_key');
    settings[row.wmkf_settingkey] = { value: row.wmkf_settingvalue };
  }
  const config = parseExecutorBudgetSettings(settings);
  return { schemaVersion: config.schemaVersion, currentVersion: config.version, latestRevision: config.latestRevision, budgets: config.budgets, warnings: config.storageWarnings.map(w => ({ code: w.code, version: w.version })) };
}
export async function readCurrentBudgetPrompt(name) {
  assertTrustedDalContext('prompt-budget.readCurrentBudgetPrompt');
  const result = await DynamicsService.queryAllRecords(PROMPTS, {
    select: 'wmkf_ai_promptid,wmkf_ai_promptname,wmkf_promptversion,wmkf_ai_model,wmkf_ai_iscurrent,wmkf_ai_promptstatus',
    filter: `${odata.eq('wmkf_ai_promptname', name)} and ${odata.eqRaw('wmkf_ai_iscurrent', true)}`,
  });
  // Count every current row BEFORE checking status: don't hide a current Draft.
  if (!Array.isArray(result?.records) || result.records.length !== 1) fail('budget_prompt_missing_or_duplicate');
  const row = result.records[0];
  return { name: row.wmkf_ai_promptname, id: row.wmkf_ai_promptid, version: row.wmkf_promptversion, etag: row['@odata.etag'], status: row.wmkf_ai_promptstatus, isCurrent: row.wmkf_ai_iscurrent, model: row.wmkf_ai_model ?? null };
}
export async function commitBudgetPublication(plan) {
  assertTrustedDalContext('prompt-budget.commitBudgetPublication');
  if (!isPreparedBudgetPlan(plan)) fail('unprepared_budget_publication');
  const actorBind = { 'wmkf_UpdatedBy@odata.bind': `/systemusers(${plan.actor.effectiveUserId})` };
  const controlValue = { schemaVersion: 1, revision: plan.control.nextRevision, policyRevision: plan.policyRevision, policyArtifactHash: plan.policyArtifactHash };
  return runChangeset([
    { method: 'PATCH', entitySet: SETTINGS, keyPredicate: `wmkf_settingkey='${odata.escape(CONTROL_KEY)}'`, ifMatch: plan.control.expectedEtag, body: { wmkf_settingvalue: JSON.stringify(controlValue), ...actorBind } },
    { method: 'POST', entitySet: SETTINGS, body: { wmkf_settingkey: plan.publication.key, wmkf_settingvalue: JSON.stringify(plan.publication.envelope), ...actorBind } },
  ], plan.writeOptions);
}
